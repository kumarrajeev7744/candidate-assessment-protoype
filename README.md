# Candidate Assessment Platform

MVP platform for assessing sales candidates with written and video responses.

- **client/** – React + Vite + TypeScript frontend (React Router, Vitest, React Testing Library)
- **server/** – Node.js + Express + TypeScript REST API (Vitest, Supertest)

Each package builds and runs independently. The root `package.json` uses npm workspaces for convenience scripts.

## Prerequisites

- Node.js 20 or newer (developed on Node 22)
- npm 10 or newer

## Setup

```bash
# Install dependencies for root, client and server
npm install

# Create local environment files (never commit .env files)
cp client/.env.example client/.env
cp server/.env.example server/.env
```

### Environment variables

| Package | Variable | Description | Default |
|---|---|---|---|
| client | `VITE_API_BASE_URL` | Base URL of the backend API | `http://localhost:4000/api` |
| server | `PORT` | Port the API listens on | `4000` |
| server | `NODE_ENV` | `development`, `test` or `production` | `development` |
| server | `CLIENT_URL` | Allowed CORS origin(s), comma-separated | `http://localhost:5173` |
| server | `MONGODB_URI` | MongoDB Atlas connection string (**required** to start the API) | – |
| server | `JWT_SECRET` | Random secret, ≥ 32 characters (**required** to start the API) | – |
| server | `JWT_EXPIRES_IN` | Admin token lifetime (`3600`, `30m`, `1h`, …) | `1h` |
| server | `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Admin account created by `seed:admin` (password ≥ 12 chars) | – |
| server | `LOGIN_RATE_LIMIT_MAX` | Failed logins allowed per IP per 15 minutes | `10` |
| server | `TRUST_PROXY` | Proxy hops to trust for client IPs (`1` on App Runner) | `0` |
| server | `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | SMTP server | `smtp.gmail.com` / `587` / `false` |
| server | `SMTP_USER` / `SMTP_PASS` | Gmail address and Google App Password | – (email disabled) |
| server | `SMTP_FROM` | Sender shown to recipients | `"Candidate Assessment" <SMTP_USER>` |
| server | `EMAIL_TIMEZONE` | IANA time zone for dates in emails (e.g. `Asia/Kolkata`) | `UTC` |
| server | `AWS_REGION` / `S3_VIDEO_BUCKET` | Region and name of the **private** video bucket | – (video disabled) |
| server | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Local development only (or `AWS_PROFILE`). On App Runner use an IAM role | – |
| server | `VIDEO_MAX_MB` | Maximum video size accepted | `200` |
| server | `VIDEO_URL_EXPIRES_IN` | Lifetime of presigned upload/playback URLs | `15m` |
| server | `COMPANY_NAME` | Optional employer name used in the submission confirmation email | – (omitted) |
| server | `S3_ENDPOINT` | Optional S3-compatible endpoint for local testing (MinIO, LocalStack). Leave unset for AWS | – |

`CLIENT_URL` (first entry) is also used to build links in emails, e.g. `{CLIENT_URL}/assessment/{token}`.

Secrets are only ever server-side; nothing secret goes into `VITE_*` variables (those are bundled into the public frontend).

Generate a JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## MongoDB Atlas setup

1. In MongoDB Atlas, create a new project and a cluster dedicated to this app (the free M0 tier is fine for development).
2. **Database Access** → add a database user with *Read and write to any database* (or scoped to `candidate_assessment`). Use a generated password.
3. **Network Access** → add your development IP address. For AWS App Runner, allow its outbound IPs (or `0.0.0.0/0` for the MVP, protected by the strong DB password).
4. **Connect → Drivers** → copy the `mongodb+srv://` connection string, insert the user/password and add the database name `candidate_assessment` before the `?`:
   ```
   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster-host>/candidate_assessment?retryWrites=true&w=majority
   ```
5. Put it in `server/.env` (git-ignored). Never commit the real value. In AWS it will come from Secrets Manager.

MongoDB must run as a **replica set** (every Atlas cluster does) because submission and response saves use transactions. A standalone local `mongod` will not work; use Atlas or a single-node replica set.

The API refuses to start without a reachable database and logs the target host/database only (credentials are never logged). Indexes are created automatically by Mongoose on startup.

### Seeding the 10 questions

The questions live in `server/src/seed/questionSeedData.ts` (currently **placeholders**). Edit the text there, then run:

```bash
npm run seed:questions --workspace server        # development (TypeScript)
npm run seed:questions:prod --workspace server   # after build (compiled JS)
```

The seed is idempotent: it upserts by question number, updates text in place, re-activates questions, and never deletes or duplicates records.

## Admin account and authentication

There is a single seeded admin account (no registration). Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `server/.env`, then:

```bash
npm run seed:admin --workspace server        # development
npm run seed:admin:prod --workspace server   # after build
```

The seed is idempotent: if the admin already exists it is left unchanged (the password is **not** overwritten). The password and hash are never logged. You can remove `ADMIN_PASSWORD` from `.env` after seeding.

Log in at `http://localhost:5173/admin/login`.

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/auth/login` | – | `{ email, password }` → `{ token, expiresAt, admin }`. 400 invalid body, 401 bad credentials, 429 rate limited |
| `GET /api/auth/me` | Bearer JWT | `{ admin: { id, email, createdAt } }` |
| `POST /api/auth/logout` | – | `{ message }`; the client discards its token |

Recruiter APIs are protected with the reusable `requireAuth` middleware (`Authorization: Bearer <token>`).

## Email (Gmail SMTP)

1. The Gmail account needs 2-Step Verification and a Google **App Password** (Google Account → Security → App passwords). Reuse an existing one if you have it.
2. In `server/.env` set `SMTP_USER` (the Gmail address), `SMTP_PASS` (the 16-character App Password; spaces are ignored) and optionally `SMTP_FROM`.
3. Verify the settings (and optionally send a test message):

```bash
npm run email:verify --workspace server
npm run email:verify --workspace server -- you@example.com
```

The API starts without SMTP credentials; email operations then report `Email service is not configured`. Credentials, tokens and links are never logged. Automated tests use a fake transport and never send real email.

## Candidate invitations

| Endpoint | Auth | Description |
|---|---|---|
| `POST /api/invitations` | Bearer JWT | `{ name, email }` → 201 `{ candidate, invitation, email: { sent, error? } }`. 400 invalid input, 409 duplicate email. Email failures keep the records with `emailStatus: "Failed"` |
| `POST /api/invitations/:id/resend-confirmation` | Bearer JWT | Retries a **failed** submission confirmation email for a completed assessment. 409 if not completed or already sent. Never changes the completion |
| `POST /api/invitations/:id/resend` | Bearer JWT | New token + email; old link stops working; expiry reset to 7 days. 400 bad ID, 404 not found, 409 already completed, 503 email not configured |
| `GET /api/invitations/validate/:token` | Public | 200 `{ valid, status, expiresAt }`, 404 invalid, 410 expired, 409 completed. Read-only (never changes status) |

Candidates open `{CLIENT_URL}/assessment/{token}`.

## Candidate assessment

Candidate APIs are authenticated with the invitation token in the `X-Assessment-Token` header (`requireCandidate` middleware, separate from recruiter JWTs). The candidate's identity always comes from the token.

| Endpoint | Description |
|---|---|
| `POST /api/assessment/start` | Explicit Start: Invited → In Progress (resumes if already In Progress). 409 completed, 410 expired |
| `GET /api/assessment` | Candidate name/email, status, the 10 active questions in order with the candidate's own saved responses, and progress. Read-only |
| `PUT /api/assessment/questions/:questionId/response` | `{ writtenAnswer }` (≤ 1,000 chars). Upserts the single response for candidate + question. Only while In Progress |

| `POST /api/assessment/questions/:questionId/video-upload-url` | `{ mimeType, sizeBytes }` → `{ uploadUrl, objectKey, method, headers, expiresAt }` (WebM or MP4, ≤ `VIDEO_MAX_MB`) |
| `POST /api/assessment/questions/:questionId/video-confirm` | `{ objectKey }` → verifies the S3 object and marks the video Uploaded (replacing any previous one) |
| `GET /api/assessment/questions/:questionId/video-url` | Presigned playback URL for the candidate's own uploaded video |

Errors: 401 missing/invalid token, 409 not started or already completed, 410 expired, 400 invalid question ID, answer or video, 403 foreign object key, 404 unknown question or no video, 503 storage not configured.

| `POST /api/assessment/submit` | Validates all 10 questions on the server (non-empty written answer + video `Uploaded`), then completes the assessment and emails a confirmation. 400 `ASSESSMENT_INCOMPLETE` with `details.missing[]` (`questionNumber`, `writtenMissing`, `videoMissing`), 409 already submitted, 410 expired |

A question is complete when it has a saved written answer **and** a confirmed video; the candidate can only move forward from a complete question.

**Submission and locking.** Validation and the status change (`In Progress` → `Completed`, `completedAt`) happen in one MongoDB transaction that also writes the invitation. Every written-answer save and video confirmation runs in a transaction that first checks the invitation is still `In Progress` and bumps its `responseVersion`. Because both always write the invitation document, they serialize: concurrent submissions produce exactly one completion, and a late autosave either lands before completion or is rejected with 409. After completion every candidate API (save, video upload/confirm, start, submit, load) returns 409.

**Confirmation email.** Sent after the transaction commits; its result is stored separately from the invitation email (`confirmationEmailStatus`, `confirmationEmailSentAt`, `confirmationEmailLastAttemptAt`). A failed email never undoes the submission; recruiters can retry it with `resend-confirmation`.

Frontend routes:

- `/assessment/:token` – start screen (or resume where the candidate left off)
- `/assessment/:token/questions/:number` – one question at a time: written answer with autosave (1 s debounce, saved before navigating, flushed when the tab is hidden/closed) and video recording (camera preview, 2-minute limit, preview, accept/re-record, upload with progress and retries)
- `/assessment/:token/review` – review of all answers, video status and playback, Edit links, questions needing attention, and **Submit Assessment** (with a confirmation dialog)
- `/assessment/:token/submitted` – confirmation screen (name, submission time, email status); no way back into editing

## Video storage (Amazon S3)

Videos go **directly from the browser to a private S3 bucket** using short-lived presigned URLs; the API never handles video bytes. Only metadata (object key, MIME type, size, status, upload time) is stored in MongoDB.

1. **Create the bucket** (e.g. in `ap-south-1`): keep **Block all public access** on, default encryption SSE-S3, no bucket policy granting public access.
2. **CORS** (Bucket → Permissions → CORS): paste [`docs/aws/s3-cors.json`](docs/aws/s3-cors.json) and add the CloudFront origin when deployed.
3. **IAM**: create a policy from [`docs/aws/s3-app-policy.json`](docs/aws/s3-app-policy.json) (replace the bucket name). Locally, attach it to a dedicated IAM user and put its access keys in `server/.env` (or use `AWS_PROFILE`). On App Runner, attach it to the instance role instead of using keys.
4. Set `AWS_REGION` and `S3_VIDEO_BUCKET` in `server/.env`.

Flow per question: `POST …/video-upload-url` → browser `PUT` to S3 (with progress; 1 attempt + 2 automatic retries) → `POST …/video-confirm` (server checks the object exists in S3, its type and size, then saves the metadata and deletes the replaced video). Playback uses `GET …/video-url` (presigned GET, 15 minutes).

The presigned PUT signs `Content-Type` and `Content-Length`, so S3 rejects uploads of another type or size. Object keys are generated by the server as `videos/{candidateId}/{questionId}/{timestamp}-{random}.{webm|mp4}`; confirm only accepts keys for the calling candidate and question.

## Data model

| Collection | Key fields | Indexes |
|---|---|---|
| `admins` | email, passwordHash (bcrypt, not selected by default) | email (unique) |
| `candidates` | name, email | email (unique), name |
| `invitations` | candidateId, tokenHash, status, invitedAt, expiresAt (+7 days), completedAt, emailStatus, confirmationEmailStatus / SentAt / LastAttemptAt, responseVersion | candidateId (unique), tokenHash (unique) |
| `questions` | questionNumber (1–10), questionText, isActive | questionNumber (unique) |
| `responses` | candidateId, questionId, writtenAnswer (≤1,000 chars), video {objectKey, mimeType, sizeBytes, uploadStatus, uploadedAt} | candidateId + questionId (unique) |
| `sharelinks` | responseId, tokenHash, recipientEmail, createdAt, expiresAt (+7 days) | responseId, tokenHash (unique) |

Only SHA-256 hashes of invitation/share tokens are stored. There are no TTL indexes: expired invitations and share links are kept for history and checked at access time.

## Running in development

```bash
npm run dev:server   # API on http://localhost:4000 (auto-reload)
npm run dev:client   # Frontend on http://localhost:5173
```

Health check: `GET http://localhost:4000/api/health`

## Tests

Backend tests use `mongodb-memory-server` (an isolated in-memory MongoDB); no Atlas connection is needed. The first run downloads a MongoDB binary from `fastdl.mongodb.org`.

```bash
npm test             # all tests
npm run test:client  # frontend tests
npm run test:server  # backend tests
```

## Build

```bash
npm run build          # both packages
npm run build:client   # -> client/dist (static files for S3/CloudFront)
npm run build:server   # -> server/dist
npm start --workspace server   # run the compiled API
```

## Code quality

```bash
npm run typecheck   # strict TypeScript checks for both packages
npm run lint        # ESLint
```

## Project structure

```
client/
  src/{components,pages,routes,context,services,hooks,types,utils}
  tests/
server/
  src/{config,controllers,routes,services,models,middleware,utils,types}
  src/app.ts      # Express app (no listen; used by tests)
  src/server.ts   # Startup entry point
  tests/
```
