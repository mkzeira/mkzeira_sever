FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY lib ./lib

ENV PORT=10000
ENV HOST=0.0.0.0
ENV PUBLIC_URL=http://localhost:4000
ENV DATA_DIR=/app/data

RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 10000

CMD ["npm", "start"]
