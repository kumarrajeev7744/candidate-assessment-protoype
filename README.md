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

## Running in development

```bash
npm run dev:server   # API on http://localhost:4000 (auto-reload)
npm run dev:client   # Frontend on http://localhost:5173
```

Health check: `GET http://localhost:4000/api/health`

## Tests

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
