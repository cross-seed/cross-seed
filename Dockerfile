# Build layer
FROM node:24-alpine AS build
WORKDIR /usr/src/app
ENV HUSKY=0
COPY package*.json tsconfig.json ./
COPY packages/shared/package*.json packages/shared/tsconfig.json ./packages/shared/
COPY packages/api-types/package*.json packages/api-types/tsconfig.json ./packages/api-types/
COPY packages/webui/package*.json packages/webui/tsconfig*.json ./packages/webui/
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN npm ci --workspaces --include-workspace-root --no-fund
COPY packages/shared packages/shared
COPY packages/api-types packages/api-types
COPY packages/webui packages/webui
COPY src src
RUN npm run build:all && npm prune --omit=dev

# Runtime layer
FROM node:24-alpine
WORKDIR /usr/src/cross-seed
RUN apk add catatonit curl tzdata
COPY --from=build /usr/src/app/package*.json ./
# Bring along pruned production deps and the workspace packages they link to.
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/packages/shared ./packages/shared
COPY --from=build /usr/src/app/packages/api-types ./packages/api-types
COPY --from=build /usr/src/app/dist ./dist
ENV HUSKY=0
RUN npm link
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
EXPOSE 2468
WORKDIR /config
ENTRYPOINT ["/usr/bin/catatonit", "--", "/usr/local/bin/cross-seed"]
