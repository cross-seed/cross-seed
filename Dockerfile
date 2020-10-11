FROM node:12
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
VOLUME /config /torrents /output
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
COPY src src
RUN npm link
EXPOSE 2468
ENTRYPOINT ["cross-seed"]
