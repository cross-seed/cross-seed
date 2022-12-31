FROM node:18
WORKDIR /usr/src/app
RUN npm install -g npm@9
COPY package*.json ./
RUN npm ci --ignore-scripts
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
COPY tsconfig.json tsconfig.json
COPY src src
RUN npm run build
RUN npm link
EXPOSE 2468
ENTRYPOINT ["cross-seed"]
