FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --production=false

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

ENV PORT=8787
EXPOSE 8787

CMD ["node", "dist/index.js"]
