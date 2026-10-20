FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production PORT=3000 CTAI_DATA_DIR=/dados
RUN mkdir -p /dados && chown node:node /dados
VOLUME ["/dados"]
EXPOSE 3000
USER node
CMD ["node", "--no-warnings", "server/index.js"]
