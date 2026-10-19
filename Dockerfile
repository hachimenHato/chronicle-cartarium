FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3001 DATA_DIR=/app/data
LABEL io.worldloom.application="worldloom" io.worldloom.mysql-schema="5" io.worldloom.sqlite-schema="1"
LABEL io.chronicle-cartarium.application="chronicle-cartarium" io.chronicle-cartarium.mysql-schema="5" io.chronicle-cartarium.sqlite-schema="1"
COPY package.json package-lock.json ./
# tsx is needed by the TypeScript runtime entrypoint.
RUN npm ci && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
# The server's Markdown exporter imports pure helpers from src/lib.
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/scripts ./scripts
COPY LICENSE THIRD_PARTY_NOTICES.md DEPENDENCY_LICENSES.md DEPENDENCIES.json ./
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["npm","start"]
