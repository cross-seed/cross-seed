# Build Stage
FROM node:20-alpine AS build-stage
WORKDIR /usr/src/cross-seed
COPY package*.json ./
RUN apk add --no-cache build-base python3 && \
    npm ci
COPY tsconfig.json ./
COPY src src
RUN npm run build && \
    npm prune --production && \
    rm -rf src tsconfig.json

# Production Stage
FROM node:20-alpine
WORKDIR /usr/src/cross-seed
COPY --from=build-stage /usr/src/cross-seed ./
RUN apk add --no-cache curl && \
    npm link
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
EXPOSE 2468
WORKDIR /config
ENTRYPOINT ["cross-seed"]
