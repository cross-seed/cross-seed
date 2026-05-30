# Build layer
FROM node:26-alpine AS build
WORKDIR /usr/src/app
COPY package*.json ./
COPY cross-seed/package*.json cross-seed/tsconfig*.json ./cross-seed/
COPY shared/package*.json shared/tsconfig.json ./shared/
COPY api-types/package*.json api-types/tsconfig.json ./api-types/
COPY webui/package*.json webui/tsconfig*.json ./webui/
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN npm ci --workspaces --no-fund
COPY shared shared
COPY api-types api-types
COPY webui webui
COPY cross-seed cross-seed
COPY scripts/copy-webui.js scripts/copy-webui.js
RUN npm run build:all && npm prune --omit=dev

# Runtime layer
FROM node:26-alpine
WORKDIR /usr/src/cross-seed
ARG BUILD_COMMIT_SHA
ARG BUILD_BRANCH
ARG BUILD_TAG
ARG BUILD_MESSAGE
ARG BUILD_DATE
ENV BUILD_COMMIT_SHA=$BUILD_COMMIT_SHA \
    BUILD_BRANCH=$BUILD_BRANCH \
    BUILD_TAG=$BUILD_TAG \
    BUILD_MESSAGE=$BUILD_MESSAGE \
    BUILD_DATE=$BUILD_DATE
RUN apk add catatonit curl tzdata
COPY --from=build /usr/src/app/package*.json ./
# Bring along pruned production deps and the workspace packages they link to.
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/shared ./shared
COPY --from=build /usr/src/app/api-types ./api-types
COPY --from=build /usr/src/app/webui ./webui
COPY --from=build /usr/src/app/cross-seed ./cross-seed
RUN npm link ./cross-seed
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
EXPOSE 2468
WORKDIR /config
ENTRYPOINT ["/usr/bin/catatonit", "--", "/usr/local/bin/cross-seed"]
