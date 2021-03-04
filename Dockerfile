FROM node:12
WORKDIR /usr/src/app
COPY package*.json ./
RUN git config --global url."github.com/".insteadOf git@github.com:
RUN git config --global url."https://".insteadOf ssh://
RUN npm ci --only=production
ENV CONFIG_DIR=/config
ENV DOCKER_ENV=true
COPY src src
RUN npm link
EXPOSE 2468
ENTRYPOINT ["cross-seed"]
