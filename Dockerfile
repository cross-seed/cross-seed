FROM node:14
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
COPY tsconfig.json tsconfig.json
COPY src src
RUN npm run build
EXPOSE 2468
ENTRYPOINT ["node", "dist/cmd.js"]
