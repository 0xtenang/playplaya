FROM node:24-slim
WORKDIR /app
COPY package.json build.mjs ./
COPY src ./src
COPY art ./art
COPY server ./server
RUN node build.mjs
ENV NODE_ENV=production PORT=8080 DB_PATH=/data/trayfarers.db
EXPOSE 8080
# Hosts often mount volumes as root, so fix ownership at start, then drop to the node user.
CMD ["sh", "-c", "mkdir -p /data && chown -R node:node /data && exec setpriv --reuid=node --regid=node --init-groups node --disable-warning=ExperimentalWarning server/index.mjs"]
