# Build Stage
FROM node:18-alpine AS build-stage
WORKDIR /usr/src/cross-seed
COPY package*.json ./
RUN npm install -g npm@9 \
    && npm ci
COPY tsconfig.json tsconfig.json
COPY src src
RUN npm run build \
    && rm -rf src tsconfig.json

# Production Stage
FROM node:18-alpine
WORKDIR /usr/src/cross-seed
COPY --from=build-stage /usr/src/cross-seed .
RUN npm link
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
EXPOSE 2468
WORKDIR /config
ENTRYPOINT ["cross-seed"]