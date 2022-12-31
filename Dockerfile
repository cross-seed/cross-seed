FROM node:18-alpine
WORKDIR /usr/src/cross-seed
RUN npm i -g npm@9
RUN npm --version
COPY package*.json ./
RUN npm ci
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
COPY tsconfig.json tsconfig.json
COPY src src
RUN npm run build
RUN npm link
EXPOSE 2468
ENTRYPOINT ["cross-seed"]
