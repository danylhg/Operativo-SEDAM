FROM node:20-alpine

WORKDIR /app/api

COPY api/package*.json ./
RUN npm ci --omit=dev

COPY . /app

EXPOSE 3001

CMD ["node", "server.js"]
