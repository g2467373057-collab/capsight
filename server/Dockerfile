# Capsight API — no npm install needed: the server uses only Node built-ins.
FROM node:24-slim
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
ENV NODE_ENV=production PORT=8787 DB_PATH=/data/capsight.db
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 8787
USER node
CMD ["node", "--no-warnings=ExperimentalWarning", "src/main.ts"]
