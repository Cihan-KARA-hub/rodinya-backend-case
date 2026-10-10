# syntax=docker/dockerfile:1

# ---- build: all dependencies, compile TypeScript to dist/ ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- prod-deps: production dependencies only ----
# bcrypt ships a prebuilt musl binary, so no compiler toolchain is needed.
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- runtime: compiled app + production node_modules, non-root ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    UPLOAD_DIR=/app/uploads
WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
# Owned by `node` so the mounted volume is writable by the non-root user.
RUN mkdir -p /app/uploads && chown node:node /app/uploads

USER node
EXPOSE 3000

# /health is public and never rate limited; busybox wget ships with alpine.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1

# node directly (not npm), so SIGTERM reaches Nest's shutdown hooks.
CMD ["node", "dist/main.js"]
