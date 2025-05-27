# Build Stage
FROM node:20-alpine AS build-stage
WORKDIR /usr/src/cross-seed
COPY package*.json ./
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN npm ci --no-fund
COPY tsconfig.json tsconfig.eslint.json ./
COPY packages packages
COPY src src
RUN npm run build:all && \
    npm prune --omit=dev && \
    rm -rf src tsconfig.json tsconfig.eslint.json packages

# Production Stage
FROM node:20-alpine
WORKDIR /usr/src/cross-seed
COPY --from=build-stage /usr/src/cross-seed ./
RUN apk add --no-cache catatonit curl tzdata && \
    npm link
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
EXPOSE 2468
WORKDIR /config
ENTRYPOINT ["/usr/bin/catatonit", "--", "/usr/local/bin/cross-seed"]
