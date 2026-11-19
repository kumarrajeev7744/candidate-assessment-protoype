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

## MongoDB Atlas setup

1. In MongoDB Atlas, create a new project and a cluster dedicated to this app (the free M0 tier is fine for development).
2. **Database Access** → add a database user with *Read and write to any database* (or scoped to `candidate_assessment`). Use a generated password.
3. **Network Access** → add your development IP address. For AWS App Runner, allow its outbound IPs (or `0.0.0.0/0` for the MVP, protected by the strong DB password).
4. **Connect → Drivers** → copy the `mongodb+srv://` connection string, insert the user/password and add the database name `candidate_assessment` before the `?`:
   ```
   MONGODB_URI=mongodb+srv://<user>:<password>@<cluster-host>/candidate_assessment?retryWrites=true&w=majority
   ```
5. Put it in `server/.env` (git-ignored). Never commit the real value. In AWS it will come from Secrets Manager.

The API refuses to start without a reachable database and logs the target host/database only (credentials are never logged). Indexes are created automatically by Mongoose on startup.

### Seeding the 10 questions

The questions live in `server/src/seed/questionSeedData.ts` (currently **placeholders**). Edit the text there, then run:

```bash
npm run seed:questions --workspace server        # development (TypeScript)
npm run seed:questions:prod --workspace server   # after build (compiled JS)
```

The seed is idempotent: it upserts by question number, updates text in place, re-activates questions, and never deletes or duplicates records.

## Data model

| Collection | Key fields | Indexes |
|---|---|---|
| `admins` | email, passwordHash (bcrypt, not selected by default) | email (unique) |
| `candidates` | name, email | email (unique), name |
| `invitations` | candidateId, tokenHash, status, invitedAt, expiresAt (+7 days), completedAt, emailStatus | candidateId (unique), tokenHash (unique) |
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
