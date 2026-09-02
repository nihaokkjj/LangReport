FROM node:22-bookworm-slim

WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable \
  && corepack prepare pnpm@11.19.0 --activate

COPY . .

# Install the API and the workspace packages it depends on.
# Development dependencies are kept because the API currently starts through tsx.
RUN pnpm install --frozen-lockfile --filter @langreport/api... \
  && rm -rf /root/.local/share/pnpm/store

ENV NODE_ENV=production
ENV API_PORT=4000

EXPOSE 4000

CMD ["pnpm", "--filter", "@langreport/api", "start"]
