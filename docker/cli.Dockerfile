# syntax=docker/dockerfile:1.7
# OpenAnalytics CLI image — runs `oa daemon` against a mounted ~/.claude/projects.

FROM oven/bun:1.3-alpine AS build
WORKDIR /app
RUN apk add --no-cache nodejs npm && npm i -g pnpm@10
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/cli/package.json apps/cli/package.json
COPY packages/parser/package.json packages/parser/package.json
COPY packages/schema/package.json packages/schema/package.json
RUN pnpm install --filter @oa/cli... --frozen-lockfile=false
COPY apps/cli apps/cli
COPY packages/parser packages/parser
COPY packages/schema packages/schema
WORKDIR /app/apps/cli
RUN bun build src/index.ts --compile --target=bun-linux-x64 --outfile=/oa

FROM alpine:3.20
RUN apk add --no-cache libstdc++ libgcc
COPY --from=build /oa /usr/local/bin/oa
WORKDIR /data
ENV OA_API_URL=http://api:3001
ENTRYPOINT ["/usr/local/bin/oa"]
CMD ["daemon"]
