# syntax=docker/dockerfile:1
#
# Backend API image for AWS ECS (Fargate). Build context = repository root (npm workspaces monorepo).
#
#   docker build --platform linux/amd64 -f server/Dockerfile -t candidate-assessment-backend:local .
#
# Configuration is read ONLY from environment variables at runtime (ECS env vars + Secrets Manager);
# no .env file is copied into the image. AWS credentials come from the ECS task role.

# package.json "engines" says node >=20 and there is no .nvmrc, so Node 22 LTS is used.
ARG NODE_VERSION=22

# ---------- build: install all server deps (incl. TypeScript) and compile ----------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app

# Manifests first so the dependency layer is cached until they change.
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --workspace server --no-audit --no-fund

COPY server/tsconfig.json server/tsconfig.build.json server/
COPY server/src server/src
RUN npm run build --workspace server

# ---------- runtime: production dependencies + compiled output only ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --workspace server --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY --from=build /app/server/dist server/dist

# Files stay owned by root (read-only for the app); the process runs as the unprivileged "node" user.
USER node
WORKDIR /app/server
EXPOSE 4000

# Seed scripts also work in this image, e.g.:
#   docker run --rm -e MONGODB_URI=... <image> npm run seed:questions:prod
CMD ["node", "dist/server.js"]
