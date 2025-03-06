# Build Stage
FROM node:20-alpine AS build-stage
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
FROM node:20-alpine
WORKDIR /usr/src/cross-seed
COPY --from=build-stage /usr/src/cross-seed ./
LABEL org.opencontainers.image.title="cross-seed" \
      org.opencontainers.image.description="Fully-automatic cross-seeding with Torznab" \
      org.opencontainers.image.vendor="cross-seed" \
      org.opencontainers.image.url="https://github.com/cross-seed/cross-seed" \
      org.opencontainers.image.source="https://github.com/cross-seed/cross-seed" \
      org.opencontainers.image.documentation="https://www.cross-seed.org"
RUN apk add --no-cache catatonit curl tzdata && \
    npm link
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
EXPOSE 2468
WORKDIR /config
ENTRYPOINT ["/usr/bin/catatonit", "--", "/usr/local/bin/cross-seed"]
