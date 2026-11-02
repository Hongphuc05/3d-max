# P6 dien tap: dong goi store-api nhu tren VPS (khong dev dependency, khong .env, chay bang user thuong).
FROM node:26-slim
WORKDIR /opt/3dsmood/apps/store-api
COPY apps/store-api/package.json apps/store-api/package-lock.json ./
RUN npm ci --omit=dev
COPY apps/store-api/ ./
# STORAGE_DIR giong VPS; tao san + chown de volume duoc gan vao thua huong quyen cua user node.
RUN mkdir -p /var/lib/3dsmood && chown -R node:node /var/lib/3dsmood
USER node
ENV NODE_ENV=production
