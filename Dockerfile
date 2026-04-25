# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production stage
FROM node:20-slim

WORKDIR /app

# We need some runtime deps for better-sqlite3 if it uses native bindings
# but usually slim is enough if we copy the node_modules correctly.
# However, sometimes better-sqlite3 needs specific libs.

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3000

ENV PORT=3000
ENV DATABASE_PATH=/app/data/aggregator.db
ENV NODE_ENV=production

CMD ["node", "dist/server.js"]
