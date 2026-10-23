# Build Stage
FROM node:26.12.1-alpine AS build-stage
WORKDIR /usr/src/cross-seed
RUN apk upgrade --no-cache && \
    apk add --no-cache ca-certificates && \
    update-ca-certificates
ENV NODE_USE_SYSTEM_CA=1
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ENV SSL_CERT_DIR=/etc/ssl/certs
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
COPY package*.json ./
RUN npm ci --no-fund
COPY tsconfig.json ./
COPY src src
RUN npm run build && \
    npm prune --omit=dev && \
    rm -rf src tsconfig.json

# Production Stage
FROM node:26.12.1-alpine
WORKDIR /usr/src/cross-seed
COPY --from=build-stage /usr/src/cross-seed ./
RUN apk upgrade --no-cache && \
    apk add --no-cache ca-certificates catatonit curl tzdata && \
    mkdir -p /usr/local/share/ca-certificates && \
    update-ca-certificates && \
    npm link
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
ENV NODE_USE_SYSTEM_CA=1
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ENV SSL_CERT_DIR=/etc/ssl/certs
EXPOSE 2468
WORKDIR /config
ENTRYPOINT ["/usr/bin/catatonit", "--", "/usr/local/bin/cross-seed"]
