FROM node:12
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm link
EXPOSE 2468
ENV CONFIG_DIR=/config
CMD cross-seed gen-config && cross-seed daemon
