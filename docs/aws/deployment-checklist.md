# Production deployment checklist

Work through this in order. Values such as `<CLOUDFRONT_DOMAIN>` are placeholders for values that only exist once the resource is created. Never paste secrets into tickets, chat or git.

## 0. Decisions and content (before touching AWS)

- [ ] **App Runner availability**: confirm your AWS account can create App Runner services. AWS closed App Runner to new customers on April 30, 2026. If you can't, decide on an alternative host before continuing.
- [ ] **AWS region** for App Runner, both S3 buckets and Secrets Manager (keep them in one region, ideally close to the Atlas cluster).
- [ ] **Final assessment questions**: all 10 questions in Atlas are still `[PLACEHOLDER]` text. Put the real text in `server/src/seed/questionSeedData.ts`.
- [ ] **Atlas network option** for App Runner (`0.0.0.0/0` vs NAT/Elastic IP vs PrivateLink). See [app-runner.md](app-runner.md#mongodb-atlas-network-access).
- [ ] **Production database**: separate cluster or separate database on the current cluster.
- [ ] **Video bucket**: reuse the current bucket or create a dedicated production bucket. See [s3-configuration.md](s3-configuration.md#production-bucket-choice).
- [ ] **Test data**: delete development test candidates (for example the one with legacy video keys) from the dashboard before go-live, if production reuses the current database and bucket.

## 1. MongoDB Atlas

- [ ] **Tier with backups**: M0 (free) has no backups. Use Flex (daily snapshots) or a dedicated tier (M10+, continuous backup / point-in-time restore) for production.
- [ ] **Replica set / transactions**: every Atlas tier is a replica set, so the transactions the app uses work. No action needed.
- [ ] **Dedicated database user** for production, e.g. `assessment-api`, with the built-in role **`readWrite` on the production database only** (not `atlasAdmin`, not "read and write to any database"). `readWrite` includes the index creation Mongoose performs at startup.
- [ ] **Strong password**: generated, at least 24 random characters. Store it only in Secrets Manager (inside `MONGODB_URI`).
- [ ] **Network access** set according to the decision in step 0.
- [ ] **Connection string**: `mongodb+srv://<user>:<password>@<cluster-host>/<prod-database>?retryWrites=true&w=majority`. Store it as the `MONGODB_URI` secret.
- [ ] **Backups**: enable the backup policy; test a restore once into a temporary cluster or database. Never restore over the live database.
- [ ] **Indexes**: created automatically by Mongoose when the API starts (unique email, token hashes, candidate+question, …; see the README data model). Nothing to do manually. Existing data is not modified.
- [ ] **Seed** from your machine (see [app-runner.md](app-runner.md#seeding-the-production-database-from-your-machine-not-from-app-runner)). Both seeds are idempotent: questions are upserted by number, the admin is only created if missing, and nothing is deleted.
- [ ] Pool / timeouts: the app uses `maxPoolSize` 10 per instance, 10 s server selection, 45 s socket timeout. No change needed.

## 2. Secrets Manager

Create three secrets of type "Other type of secret" → **Plaintext** (one value each):

- [ ] `MONGODB_URI` → production connection string
- [ ] `JWT_SECRET` → new random value (`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`); do not reuse the development value
- [ ] `SMTP_PASS` → Google App Password
- [ ] Copy the three secret ARNs into `docs/aws/iam-policy.json` **locally**, for creating the IAM policy only. Don't commit the real ARNs.

## 3. S3 video bucket

- [ ] Block Public Access: all on. Object ownership: bucket owner enforced. Default encryption: SSE-S3.
- [ ] Bucket policy [`s3-video-bucket-policy.json`](s3-video-bucket-policy.json) (deny non-HTTPS).
- [ ] Lifecycle [`s3-video-lifecycle.json`](s3-video-lifecycle.json) (optional).
- [ ] CORS [`s3-cors.json`](s3-cors.json): set after step 5, once `<CLOUDFRONT_DOMAIN>` is known.

## 4. IAM instance role for App Runner

- [ ] Role with trust policy [`apprunner-instance-role-trust.json`](apprunner-instance-role-trust.json).
- [ ] Inline policy from [`iam-policy.json`](iam-policy.json), with the bucket name and secret ARNs filled in.
- [ ] Deactivate the local-development IAM user's access keys for this bucket if production uses the same bucket and those keys are no longer needed, or at least never put them on App Runner.

## 5. Frontend bucket + CloudFront (creates `<CLOUDFRONT_DOMAIN>`)

- [ ] Private frontend bucket, OAC, CloudFront Function, cache and headers policies. See [frontend-cloudfront.md](frontend-cloudfront.md).
- [ ] Note the distribution domain `https://<CLOUDFRONT_DOMAIN>`.
- [ ] Update the video bucket CORS with this origin.

## 6. App Runner service

- [ ] Connect GitHub and choose the repository and branch; source directory `/`; runtime Node.js 22.
- [ ] Build / start commands, port 8080, health check `/api/health`, instance role, env vars and secrets exactly as in [app-runner.md](app-runner.md).
- [ ] `CLIENT_URL=https://<CLOUDFRONT_DOMAIN>`, `TRUST_PROXY=1`, `NODE_ENV=production`.
- [ ] Deploy. Logs must show `MongoDB connected` and `API listening on port 8080`, and no `Configuration warning` lines.
- [ ] `curl https://<APP_RUNNER_SERVICE_DOMAIN>/api/health` → 200; `…/api/health/ready` → `"database":"connected"`.

## 7. Frontend build and upload

- [ ] `VITE_API_BASE_URL=https://<APP_RUNNER_SERVICE_DOMAIN>/api npm run build:client`
- [ ] Upload with the cache headers and invalidate `/index.html` (commands in [frontend-cloudfront.md](frontend-cloudfront.md#3-build-and-upload)).

## 8. Gmail SMTP

- [ ] The Gmail account has 2-Step Verification and an **App Password** (stored as `SMTP_PASS`).
- [ ] `SMTP_FROM` uses the same address (or a verified "Send mail as" alias).
- [ ] Optional: run `npm run email:verify --workspace server` from your machine with the production SMTP values to check the login.
- [ ] Note the Gmail limits (about 500 recipients/day for a personal account). That's enough for about 100 candidates. Use Google Workspace or a transactional email service if volume grows.

## 9. Smoke test on the production URLs

- [ ] Open `https://<CLOUDFRONT_DOMAIN>/admin/login`, log in, refresh the page on `/admin/dashboard` (tests the SPA rewrite), sign out.
- [ ] Invite a test candidate with your own email. The email link must start with `https://<CLOUDFRONT_DOMAIN>/assessment/`.
- [ ] As the candidate: start, write an answer, record and upload a video (tests camera on HTTPS, presigned PUT and S3 CORS), play it back, submit, and receive the confirmation email.
- [ ] As the recruiter: open the report, play the video, share one response and the full report, open the shared links in a private window.
- [ ] Trigger one failed login and check that the CloudWatch log line shows your real IP (`TRUST_PROXY`).
- [ ] Delete the test candidate and check that its videos are gone from the bucket.
- [ ] CloudWatch: no `"level":"error"` lines; set up the alarms from [app-runner.md](app-runner.md#cloudwatch-monitoring-suggested).

## Rollback

- API: App Runner keeps the previous version running if a deployment fails its health check. For a bad but healthy release, redeploy the previous commit.
- Frontend: re-upload the previous `client/dist` (or rebuild the previous commit) and invalidate `/index.html`.
- Database: changes in this project are additive only (no migrations). Restore from Atlas backups only in an emergency, into a new cluster or database first.
