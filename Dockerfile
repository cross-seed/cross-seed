FROM node:16
WORKDIR /usr/src/cross-seed
RUN npm install -g npm@9
COPY package*.json ./
RUN npm ci
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
COPY tsconfig.json tsconfig.json
COPY src src
RUN npm run build
RUN npm link
EXPOSE 2468
WORKDIR /config
ENTRYPOINT ["node", "--prof", "/usr/src/cross-seed/dist/cmd.js"]
