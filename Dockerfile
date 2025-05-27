# Frontend Build Stage
FROM node:20-alpine AS frontend-build
WORKDIR /usr/src/frontend
COPY packages/webui/package*.json ./
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN npm ci --no-fund
COPY packages/webui ./
RUN npm run build

# Backend Build Stage  
FROM node:20-alpine AS backend-build
WORKDIR /usr/src/backend
COPY package*.json tsconfig*.json ./
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
RUN npm ci --no-fund
COPY src src
RUN npm run build && npm prune --omit=dev

# Production Assembly Stage
FROM node:20-alpine AS production-stage
WORKDIR /usr/src/cross-seed
# Copy backend build and dependencies
COPY --from=backend-build /usr/src/backend/dist ./dist
COPY --from=backend-build /usr/src/backend/node_modules ./node_modules
COPY --from=backend-build /usr/src/backend/package*.json ./
# Copy frontend build to correct location
COPY --from=frontend-build /usr/src/frontend/dist ./dist/webui

# Final Production Stage
FROM node:20-alpine
WORKDIR /usr/src/cross-seed
COPY --from=production-stage /usr/src/cross-seed ./
RUN apk add --no-cache catatonit curl tzdata && \
    npm link
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
EXPOSE 2468
WORKDIR /config
ENTRYPOINT ["/usr/bin/catatonit", "--", "/usr/local/bin/cross-seed"]
