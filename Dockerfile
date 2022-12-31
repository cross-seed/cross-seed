FROM node:16
WORKDIR /usr/src/cross-seed
RUN npm install -g npm@9
COPY package*.json ./
RUN npm ci --ignore-scripts
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
COPY tsconfig.json tsconfig.json
COPY src src
RUN npm run build
EXPOSE 2468
ENTRYPOINT ["node", "dist/cmd.js"]
