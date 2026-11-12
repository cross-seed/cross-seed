# Build Stage
FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build-stage
WORKDIR /usr/src/cross-seed
COPY package*.json ./
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN npm ci --no-fund
COPY tsconfig.json ./
COPY src src
RUN npm run build && \
    npm prune --omit=dev && \
    rm -rf src tsconfig.json

# Production Stage
FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
WORKDIR /usr/src/cross-seed
COPY --from=build-stage /usr/src/cross-seed ./
RUN apk add --no-cache catatonit curl tzdata && \
    npm link
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
EXPOSE 2468
WORKDIR /config
ENTRYPOINT ["/usr/bin/catatonit", "--", "/usr/local/bin/cross-seed"]
