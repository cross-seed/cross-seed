# Dependencies layer: install all workspace deps with maximum cache reuse
FROM node:22-alpine AS deps
WORKDIR /usr/src/app
COPY package*.json tsconfig*.json ./
COPY packages/shared/package*.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/api-types/package*.json packages/api-types/tsconfig.json ./packages/api-types/
COPY packages/webui/package*.json packages/webui/tsconfig*.json ./packages/webui/
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN npm ci --workspaces --include-workspace-root --no-fund --include=dev

# Build layer: use cached node_modules, build everything, drop dev deps
FROM node:22-alpine AS build
WORKDIR /usr/src/app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY --from=deps /usr/src/app/packages/webui/node_modules ./packages/webui/node_modules
COPY --from=deps /usr/src/app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /usr/src/app/packages/api-types/node_modules ./packages/api-types/node_modules
COPY package*.json tsconfig*.json ./
COPY packages/shared packages/shared
COPY packages/api-types packages/api-types
COPY packages/webui packages/webui
COPY src src
RUN npm run build:all && npm prune --omit=dev

# Runtime layer
FROM node:22-alpine
WORKDIR /usr/src/cross-seed
COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/package*.json ./
RUN apk add --no-cache catatonit curl tzdata && \
    npm link
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
EXPOSE 2468
WORKDIR /config
ENTRYPOINT ["/usr/bin/catatonit", "--", "/usr/local/bin/cross-seed"]
