FROM node:24-bookworm-slim AS build

RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build
RUN pnpm prune --prod

FROM node:24-bookworm-slim AS runtime

ARG CODEX_VERSION=0.169.0
RUN npm install --global @openai/codex@${CODEX_VERSION}

ENV CODEX_HOME=/data/codex
ENV REDEEM_BEFORE_MINUTES=360

WORKDIR /app
COPY package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

VOLUME ["/data/codex"]
CMD ["node", "dist/main.js"]
