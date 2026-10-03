# Build context is the repository root: docker build -f backend/Dockerfile .
FROM node:22-slim
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY shared/package.json shared/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile --filter @opsflow/backend...

COPY shared shared
COPY backend backend

ENV NODE_ENV=production
# The API and the worker are the same image with different commands (see docker-compose.yml)
CMD ["pnpm", "--filter", "@opsflow/backend", "start"]
