FROM node:22-bookworm-slim

WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable \
  && corepack prepare pnpm@11.19.0 --activate

COPY . .

# Install this worker and its workspace dependencies. Keep tsx because the
# worker currently starts directly from TypeScript.
RUN pnpm install --frozen-lockfile --filter @langreport/render-worker... \
  && rm -rf /root/.local/share/pnpm/store

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@langreport/render-worker", "start"]
