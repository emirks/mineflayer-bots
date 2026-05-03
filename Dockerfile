# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM node:20-slim AS frontend

RUN npm install -g pnpm@9
WORKDIR /app/gui/client

COPY gui/client/package.json gui/client/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

COPY gui/client .
RUN pnpm build

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:20-slim

# Native build tools needed for better-sqlite3
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@9

WORKDIR /app

# Install backend dependencies (compiles better-sqlite3 natively on Linux)
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod

# Copy source
COPY . .

# Drop dev-only dirs we don't need at runtime
RUN rm -rf gui/client/node_modules scripts

# Copy built frontend from stage 1
COPY --from=frontend /app/gui/client/dist ./gui/client/dist

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN sed -i 's/\r//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh

EXPOSE 3030

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "gui/server.js"]
