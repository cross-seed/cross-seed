# Build Stage
FROM node:20-alpine AS build-stage
WORKDIR /usr/src/cross-seed
COPY package*.json ./
RUN npm ci
COPY tsconfig.json tsconfig.json
COPY src src
RUN npm run build \
    && npm prune --production \
    && rm -rf src tsconfig.json

# Production Stage
FROM node:20-alpine
WORKDIR /usr/src/cross-seed
COPY --from=build-stage /usr/src/cross-seed .
RUN npm link
RUN apk add --no-cache curl
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
EXPOSE 2468
WORKDIR /config
ENTRYPOINT ["cross-seed"]
