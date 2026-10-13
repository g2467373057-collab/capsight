# Capsight — one container serving the web app and the API (same origin, API under /api).
# Build:  docker build -t capsight .      Run: docker run -p 8787:8787 --env-file server/keys.env capsight

FROM node:24-slim AS web
WORKDIR /app/web
COPY web/package.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
ENV VITE_API_BASE=/api
RUN npx vite build

FROM node:24-slim
WORKDIR /app/server
COPY server/package.json server/tsconfig.json ./
COPY server/src ./src
COPY --from=web /app/web/dist /app/web/dist
ENV NODE_ENV=production PORT=8787 DB_PATH=/data/capsight.db STATIC_DIR=/app/web/dist TRUST_PROXY=1
RUN mkdir -p /data && chown node:node /data
EXPOSE 8787
USER node
CMD ["node", "--no-warnings=ExperimentalWarning", "src/main.ts"]
