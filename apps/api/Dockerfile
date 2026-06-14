# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@9.4.0 --activate

WORKDIR /workspace

FROM base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/prisma/package.json packages/prisma/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --filter @zestchat/api... --filter @zestchat/prisma --frozen-lockfile

COPY . .

RUN pnpm --filter @zestchat/api run db:generate
RUN pnpm --filter @zestchat/api... run build

FROM build AS migration

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@zestchat/prisma", "run", "db:migrate:prod"]

FROM build AS deployed

RUN pnpm --filter @zestchat/api --prod deploy /prod/api

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=4000

WORKDIR /app

COPY --from=deployed --chown=node:node /prod/api ./

RUN mkdir -p /app/uploads && chown node:node /app/uploads

USER node

EXPOSE 4000

CMD ["node", "dist/server.js"]
