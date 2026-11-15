FROM node:26-alpine AS build
RUN apk upgrade --no-cache
WORKDIR /app
COPY . .
RUN npm install
# The build needs dev dependencies; they are removed before the copy below.
RUN npm run build && npm prune --omit=dev
FROM node:26-alpine
# The date keys the build cache so this layer installs today's OS fixes; AppJet keeps it current on deploy.
RUN echo "os-refresh 2026-11-15" && apk upgrade --no-cache
WORKDIR /app
# Only the runtime files are copied: build tooling (vite/esbuild) stays in the build stage.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server ./server
COPY --from=build /app/web/dist ./web/dist
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
# IMPORTANT: your server MUST listen on 0.0.0.0 and process.env.PORT.
RUN mkdir -p /app/data /home/appjet && chown -R 10001:10001 /app /home/appjet
ENV HOME=/home/appjet
USER 10001:10001
CMD ["npm","start"]
