# Backend image: the API and the background worker are the same image with different commands.
# Build context is the repository root:  docker build -f backend/Dockerfile .
FROM node:22-slim
RUN corepack enable
WORKDIR /app

# Install dependencies first so this layer is cached until a package.json or the lockfile changes
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY shared/package.json shared/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile --filter @opsflow/backend...

COPY tsconfig.base.json ./
COPY shared shared
COPY backend backend

ENV NODE_ENV=production
EXPOSE 4100
# Do not run as root
RUN chown -R node:node /app
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4100)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Default: the API. The worker overrides this with `pnpm --filter @opsflow/backend start:worker`.
CMD ["pnpm", "--filter", "@opsflow/backend", "start"]
