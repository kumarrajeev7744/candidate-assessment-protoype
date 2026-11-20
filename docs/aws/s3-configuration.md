# S3 video storage

Candidate videos are stored in a **private** S3 bucket. Browsers upload and play them with short-lived presigned URLs created by the API. The API itself only signs URLs, checks uploads (`HeadObject`) and deletes objects.

## Bucket settings

| Setting | Value | Why |
|---|---|---|
| Block Public Access | all four options **on** | No object is ever public; access only via presigned URLs or the instance role |
| Object ownership | Bucket owner enforced (ACLs disabled) | No ACL-based access |
| Default encryption | SSE-S3 (AES-256) | Encryption at rest without extra KMS permissions or headers. SSE-KMS would require `kms:GenerateDataKey`/`kms:Decrypt` for the role and changes to presigned uploads, so it is not recommended here. |
| Bucket policy | [`s3-video-bucket-policy.json`](s3-video-bucket-policy.json) | Denies any non-HTTPS access |
| CORS | [`s3-cors.json`](s3-cors.json) | See below |
| Versioning | Off | A candidate deletion must really delete the videos. If you turn it on, add a lifecycle rule that expires noncurrent versions. |
| Lifecycle | [`s3-video-lifecycle.json`](s3-video-lifecycle.json) (optional) | Only aborts incomplete multipart uploads after 7 days. The app uses single `PUT` uploads and already deletes replaced videos, so no expiry rule is justified; videos must stay as long as the candidate record exists. |
| Region | the value of `AWS_REGION` | The API signs URLs for this region |

## CORS

Browsers upload with a cross-origin `PUT` from the frontend origin, so the bucket must allow that origin:

```json
"AllowedOrigins": ["https://<CLOUDFRONT_DOMAIN>", "http://localhost:5173"]
```

Replace `<CLOUDFRONT_DOMAIN>`. Remove `http://localhost:5173` from the production bucket once you no longer develop against it, or use a separate development bucket. Only `PUT`, `GET` and `HEAD` with the `Content-Type` header are allowed.

## Presigned URLs (current implementation, reviewed)

| | Upload (PUT) | Playback (GET) |
|---|---|---|
| Created by | `POST /api/assessment/questions/:questionId/video-upload-url` (candidate token) | report / shared link / candidate review (`VideoPlaybackDto`) |
| Lifetime | `VIDEO_URL_EXPIRES_IN` (15 min) | 15 min; the UI requests a fresh URL when one expires |
| Signed constraints | `Content-Type` (`video/webm` or `video/mp4`) and exact `Content-Length` (≤ `VIDEO_MAX_MB`, 200 MB) | `ResponseContentType` |
| Server-side check | `video-confirm` accepts only keys generated for that candidate and question, then `HeadObject` verifies size and type; invalid objects are deleted | – |
| Checksums | SDK configured with `requestChecksumCalculation: 'WHEN_REQUIRED'`, so browser uploads are not rejected for an empty-body checksum | – |

Credentials come from the AWS SDK default chain: locally from `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` or `AWS_PROFILE`, and on App Runner from the instance role. No access keys exist in the code.

## IAM

[`iam-policy.json`](iam-policy.json): `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on `arn:aws:s3:::<VIDEO_BUCKET_NAME>/videos/*`, plus `s3:ListBucket` restricted to the `videos/` prefix. Presigned URLs carry the permissions of the role that signed them, so this policy is also the upper limit of what any presigned URL can do.

## Object keys and existing videos

| Format | Example | Used by |
|---|---|---|
| **Current (opaque)** | `videos/<hmac-32-hex>/<timestamp>-<random>.webm` | all uploads since the "opaque video keys" change. The folder is `HMAC-SHA256(JWT_SECRET, "video-key:<candidateId>:<questionId>")`, so presigned URLs reveal no internal IDs. |
| **Legacy** | `videos/<candidateId>/<questionId>/<timestamp>-<random>.webm` | videos uploaded before that change |

Read-only check of the current Atlas database (`assessment`): **10 responses** reference legacy keys and **none** use the opaque format.

**Existing videos keep working**:
- Playback signs whatever key is stored in `responses.video.objectKey`, so legacy keys play normally. A test covers this.
- Candidate deletion now also lists the legacy folder `videos/<candidateId>/` and removes those files (fixed in this stage; before, only referenced legacy files were removed).
- Nothing is renamed or deleted automatically.

**Caveats**:
- Presigned URLs for legacy videos contain the candidate's and question's MongoDB IDs. Anyone holding a share link could see these IDs, but the IDs alone don't grant access to anything.
- The opaque folder name depends on `JWT_SECRET`. Production will use a new secret, so videos already uploaded with the development secret keep playing (their key is stored), but orphaned files from before a secret change are no longer found by candidate deletion. Referenced files are always deleted.

**Migration recommendation**: the 10 legacy videos belong to 1 candidate, most likely test data from development. The simplest and cleanest option is to **delete that test candidate from the dashboard before go-live**, which removes its database records and legacy files. If those videos must be kept, a one-off script can copy each object to an opaque key, verify it, update `objectKey`, and only then remove the old object. That script is not written yet; ask for it if you need it.

## Production bucket choice

Either keep the existing bucket (existing videos stay available) and add the CloudFront origin to its CORS, or create a new production bucket and keep the current one for development. A separate production bucket is cleaner (dev keys and test data stay out of production). Existing development videos would then not be reachable from production, which is fine if they are test data.
