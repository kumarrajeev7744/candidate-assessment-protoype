# AWS architecture

Production target for the Candidate Assessment Platform. Nothing here has been created yet; placeholders such as `<CLOUDFRONT_DOMAIN>` stand for values that only exist once the resources are created.

```
                         HTTPS                                   HTTPS (JSON API)
 Recruiter / candidate ─────────► CloudFront ──(OAC)──► S3: frontend bucket (private, static React build)
 / hiring manager browser
        │  fetch https://<APP_RUNNER_SERVICE_DOMAIN>/api/...            ┌──────────────► MongoDB Atlas (TLS, replica set)
        └──────────────────────────────────────────► App Runner (Node 22, server/dist/server.js)
        │                                                   │  IAM instance role ─────► S3: video bucket (private)
        │  presigned PUT / GET (15 min)                     │                     └──► Secrets Manager (3 secrets)
        └──────────────────────────────────────────► S3: video bucket          ├──────────────► Gmail SMTP (587, STARTTLS)
                                                                                └── stdout/stderr ► CloudWatch Logs
```

## Components

| Component | AWS / external service | Notes |
|---|---|---|
| Frontend | S3 bucket (private) + CloudFront distribution | Static output of `npm run build:client` (`client/dist`). CloudFront reaches the bucket through Origin Access Control; the bucket is not public. A CloudFront Function serves `index.html` for client-side routes. See [frontend-cloudfront.md](frontend-cloudfront.md). |
| API | AWS App Runner, managed Node.js 22 runtime, deployed from source | Build `server/dist`, start `node server/dist/server.js`, port 8080, health check `GET /api/health`. See [app-runner.md](app-runner.md). |
| Database | MongoDB Atlas | Replica set (all Atlas tiers), needed for the transactions used by submission, video writes and deletion. |
| Video storage | S3 bucket (private, SSE-S3, Block Public Access) | Browsers upload and play videos directly with presigned URLs; the API never handles video bytes. See [s3-configuration.md](s3-configuration.md). |
| Email | Gmail SMTP with a Google App Password | Invitation, confirmation and share emails. |
| Secrets | AWS Secrets Manager | `MONGODB_URI`, `JWT_SECRET`, `SMTP_PASS`, read by App Runner through the instance role. |
| Logs / monitoring | CloudWatch Logs (App Runner application log group), App Runner metrics | The API writes one JSON line per event and per request to stdout/stderr. |

## Request flows

- **Recruiter**: browser → CloudFront (SPA) → `POST /api/auth/login` on App Runner → JWT (1 h) kept in `sessionStorage` → bearer token on every recruiter call.
- **Candidate**: email link `https://<CLOUDFRONT_DOMAIN>/assessment/<token>` → SPA → API with `X-Assessment-Token`. Videos: `POST …/video-upload-url` → browser `PUT` to S3 → `POST …/video-confirm` (API checks the object with `HeadObject`).
- **Hiring manager**: share link `https://<CLOUDFRONT_DOMAIN>/shared-response/<token>` → `GET /api/shared-responses/<token>` (public, rate limited) → presigned GET URLs for videos.

## Origins that must agree

| Setting | Value |
|---|---|
| API `CLIENT_URL` | `https://<CLOUDFRONT_DOMAIN>` (CORS allowlist and the base for links in emails) |
| Video bucket CORS `AllowedOrigins` | `https://<CLOUDFRONT_DOMAIN>` |
| Frontend build `VITE_API_BASE_URL` | `https://<APP_RUNNER_SERVICE_DOMAIN>/api` |

Because each value depends on another resource, create them in this order: CloudFront distribution (gives the domain) → App Runner service → frontend build and upload. [deployment-checklist.md](deployment-checklist.md) has the full sequence.

## Deliberately not used

No Docker image, ECS, Kubernetes, Redis, API Gateway or separate microservices. Login and public-endpoint rate limits are kept in memory per App Runner instance, which is acceptable at this scale (about 100 candidates). With N instances the effective limit is N times the configured value.

## Important: App Runner availability

AWS has announced that **App Runner is no longer open to new customers from April 30, 2026**. Existing customers can keep creating services. If your AWS account has never used App Runner, you may not be able to create the service. AWS recommends Amazon ECS Express Mode for new workloads. That would need a container image and is a different architecture, so it needs your decision before Stage 2. The backend preparation in this branch (health checks, graceful shutdown, environment config, logging) applies to either option.
