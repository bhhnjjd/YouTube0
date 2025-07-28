FROM node:18-alpine

# 安装系统依赖
RUN apk add --no-cache \
    chromium \
    ffmpeg \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# 设置工作目录
WORKDIR /app

# 设置Puppeteer使用系统安装的Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# 复制package文件
COPY package*.json ./

# 安装Node.js依赖
RUN npm ci --only=production && npm cache clean --force

# 复制应用代码
COPY . .

# 创建必要的目录
RUN mkdir -p videos/input videos/output temp logs

# 设置权限
RUN chown -R node:node /app

# 切换到非root用户
USER node

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); })"

# 启动命令
CMD ["npm", "start"]