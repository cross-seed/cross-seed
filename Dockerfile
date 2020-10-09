FROM node:12
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
VOLUME /config /torrents /output
ENV CONFIG_DIR=/config
COPY . .
RUN npm link
EXPOSE 2468
CMD cross-seed gen-config --docker; cross-seed daemon
