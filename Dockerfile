FROM node:6.2.2
RUN npm install -g pm2
ADD . /src
WORKDIR /src
RUN npm install

