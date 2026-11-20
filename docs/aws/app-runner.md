# Backend on AWS App Runner

> **Check availability first:** AWS stopped onboarding **new** App Runner customers on April 30, 2026. Existing customers can still create services. Open the App Runner console in your account: if you cannot create a service, stop and choose another host (see [architecture.md](architecture.md)).

## Recommended deployment method: source code, managed Node.js 22 runtime

The API is plain Node.js with no native dependencies and no local file storage, so App Runner can build it straight from the GitHub repository with the managed **Node.js 22** runtime. A Dockerfile or container registry is not needed. The only special point is that this is an npm-workspaces monorepo: the lockfile is at the repository root, so the build runs from the root and installs only the `server` workspace.

The build and start commands below were run locally against a copy of the repository: compile, reinstall production dependencies only, then start with `NODE_ENV=production`.

| Setting | Value |
|---|---|
| Repository / branch | this repository, a release branch (e.g. `main`), **automatic deployment off** at first |
| Source directory | `/` (repository root) |
| Configuration | Configure all settings in the console (no `apprunner.yaml` committed, so no ARNs end up in git) |
| Runtime | Node.js 22 |
| Build command | `npm ci --workspace server --no-audit --no-fund && npm run build --workspace server && npm ci --workspace server --omit=dev --no-audit --no-fund` |
| Start command | `node server/dist/server.js` |
| Port | `8080` (and set `PORT=8080`) |
| CPU / memory | 1 vCPU / 2 GB (bcrypt hashing and S3 signing are CPU-bound; 0.25 vCPU is too small) |
| Auto scaling | min 1, max 2–3 instances, concurrency 100 (default) |
| Instance role | the role described below (required for S3 and Secrets Manager) |
| Health check | HTTP, path `/api/health`, interval 10 s, timeout 5 s, healthy threshold 1, unhealthy threshold 5 |
| Networking | Public endpoint; outgoing traffic: public internet (see "MongoDB Atlas network access" below) |
| Observability | Optional: enable AWS X-Ray tracing (not required) |

The first build log should show `tsc -p tsconfig.build.json` succeeding and the second `npm ci` adding only production packages. If the start fails with `Cannot find module`, the build output was not carried into the runtime image. Report it before trying workarounds.

## Environment variables

Plain environment variables (not secret):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `8080` |
| `CLIENT_URL` | `https://<CLOUDFRONT_DOMAIN>` |
| `TRUST_PROXY` | `1` |
| `JWT_EXPIRES_IN` | `1h` |
| `LOGIN_RATE_LIMIT_MAX` | `10` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | `smtp.gmail.com` / `587` / `false` |
| `SMTP_USER` | sender Gmail address |
| `SMTP_FROM` | `"<Display Name> <sender Gmail address>"` |
| `EMAIL_TIMEZONE` | e.g. `Asia/Kolkata` |
| `AWS_REGION` | region of the video bucket |
| `S3_VIDEO_BUCKET` | video bucket name |
| `VIDEO_MAX_MB` / `VIDEO_URL_EXPIRES_IN` | `200` / `15m` |
| `COMPANY_NAME` | optional |

Secrets: reference a **Secrets Manager secret ARN** for each of these (one plain-text secret per value):

| Variable | Secret content |
|---|---|
| `MONGODB_URI` | production Atlas connection string |
| `JWT_SECRET` | new random value: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `SMTP_PASS` | Google App Password |

Never set `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT` or `ADMIN_PASSWORD` on the service. The API logs a warning at startup if any of them is present.

### What the API checks at startup (`NODE_ENV=production`)

- **Refuses to start** if `JWT_SECRET` is missing, shorter than 32 characters or a placeholder; if `MONGODB_URI` is missing or MongoDB cannot be reached within 10 s; or if `CLIENT_URL` is missing, not `https://`, points to localhost or contains a path. App Runner then marks the deployment as failed and keeps the previous version running.
- **Warns** (CloudWatch, `"message":"Configuration warning"`) if `TRUST_PROXY=0`, SMTP or S3 settings are missing, `S3_ENDPOINT` is set, AWS keys are set, or `ADMIN_PASSWORD` is set.

## Instance role (IAM)

1. IAM → Roles → Create role → Custom trust policy: [`apprunner-instance-role-trust.json`](apprunner-instance-role-trust.json) (principal `tasks.apprunner.amazonaws.com`).
2. Add an inline policy from [`iam-policy.json`](iam-policy.json). Replace `<VIDEO_BUCKET_NAME>` and the three secret ARNs (copy them from Secrets Manager after creating the secrets).
3. Select the role as the App Runner service's **instance role**. The AWS SDK picks up its credentials automatically through the default credential chain, so no code change is needed.

The policy allows only `PutObject`/`GetObject`/`DeleteObject` on `videos/*`, `ListBucket` limited to the `videos/` prefix (used to find leftover files when a candidate is deleted, and so missing objects return 404 rather than 403), and `GetSecretValue` on the three secrets. If the secrets are encrypted with a customer-managed KMS key, also allow `kms:Decrypt` on that key. With the default `aws/secretsmanager` key nothing extra is needed.

## Health checks

| Endpoint | Purpose | Behaviour |
|---|---|---|
| `GET /api/health` | **App Runner health check** (liveness) | Always 200 while the process serves HTTP. Not logged per request. |
| `GET /api/health/ready` | Monitoring / manual checks (readiness) | 200 when MongoDB is connected, otherwise 503 `{ "database": "disconnected" }`. |

The App Runner health check deliberately does not depend on MongoDB. A short Atlas outage should not make App Runner keep replacing healthy instances, and the MongoDB driver reconnects on its own. A database that is unreachable at startup still fails the deployment, because the process exits.

## Runtime behaviour relevant to App Runner

- **Graceful shutdown**: on `SIGTERM` the server stops accepting connections, closes idle keep-alive connections, waits for in-flight requests, then closes MongoDB. It exits anyway after 10 s.
- **Timeouts**: request 30 s, headers 66 s, keep-alive 65 s. All API calls are short, because videos go straight to S3.
- **Body size**: JSON bodies are limited to 100 KB.
- **No local persistence**: nothing is written to disk; instances can be replaced at any time.
- **Logs**: JSON lines on stdout/stderr → CloudWatch log group `/aws/apprunner/<service-name>/<service-id>/application`. Each request is logged as method, path, status and duration, with invitation/share tokens replaced by `:token`. Passwords, JWTs, SMTP credentials, presigned URLs and S3 keys are never logged.
- **Client IPs**: with `TRUST_PROXY=1`, Express uses the client address from `X-Forwarded-For`. After the first deployment, trigger a failed login and check that the `ip` in the `Admin login failed` log line is your public IP, not an AWS-internal address.

## MongoDB Atlas network access

App Runner's default outbound traffic uses changing AWS IP addresses. Choose one option:

1. **Simplest (MVP)**: Atlas access list `0.0.0.0/0`, protected by a strong, dedicated database user, TLS (always on in Atlas) and least-privilege roles. Atlas shows a warning for this setting.
2. **Fixed IP**: App Runner VPC connector → private subnets → NAT gateway with an Elastic IP; allow only that IP in Atlas. This costs more (NAT gateway hourly + data charges). The same NAT also carries SMTP and S3 traffic.
3. **Private networking**: AWS PrivateLink to Atlas (dedicated M10+ clusters).

This is a cost and security decision for you; the application code works with all three.

## CloudWatch monitoring (suggested)

- Metric filter on the application log group: pattern `{ $.level = "error" }` → metric `ApiErrors`; alarm when ≥ 5 in 5 minutes.
- Alarms on App Runner metrics `5xxStatusResponses` and `RequestLatency` (p95).
- Log retention: 30–90 days (the default is "never expire").
- Useful Logs Insights query: `fields @timestamp, message, path, status | filter level = "error" or status >= 500 | sort @timestamp desc`.

## Seeding the production database (from your machine, not from App Runner)

The seed scripts are idempotent and never delete data:

- `seed:questions` upserts questions 1–10 by number. It **overwrites the text** of existing questions with `server/src/seed/questionSeedData.ts`, so put the final question text in that file first.
- `seed:admin` creates the admin only if it does not exist and never changes an existing password.

```bash
npm run build:server
```

```bash
cd server && MONGODB_URI='<production-uri>' npm run seed:questions:prod
```

```bash
cd server && MONGODB_URI='<production-uri>' ADMIN_EMAIL='<admin-email>' ADMIN_PASSWORD='<strong-password>' npm run seed:admin:prod
```

Your machine's IP must be on the Atlas access list while you run them. Don't save the production URI or admin password in a file; type them only for the command.
