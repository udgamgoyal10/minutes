FROM oven/bun:1.3.10-debian AS deps
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

FROM oven/bun:1.3.10-debian AS runtime
WORKDIR /app

# OCR/PDF tooling
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice \
      poppler-utils \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules /app/node_modules
COPY . .

EXPOSE 8787
ENV NODE_ENV=production
CMD ["bun", "run", "src/index.ts"]
