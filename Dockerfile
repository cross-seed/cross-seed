FROM node:12
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm link
RUN mkdir -p /config /torrents /output
ENV CONFIG_DIR=/config
EXPOSE 2468
ENTRYPOINT cross-seed gen-config --docker; cross-seed
CMD ["daemon"]
