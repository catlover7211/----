# 使用官方 Node.js 映像作為基礎（選擇 LTS 版本）
FROM node:18

# 設置工作目錄
WORKDIR /app

# 安裝 Puppeteer 所需的系統依賴
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxi6 \
    libxtst6 \
    libnss3 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm-dev \
    && rm -rf /var/lib/apt/lists/*

# 從 npm 安裝 search-engine-tool
RUN npm install search-engine-tool

# 創建一個簡單的測試腳本
RUN echo "const searchEngineTool = require('search-engine-tool');\n\
const query = process.argv[2] || '深圳市天气';\n\
const engine = process.argv[3] || 'bing';\n\
searchEngineTool(query, engine)\n\
  .then(results => {\n\
    console.log('搜索结果:');\n\
    results.forEach(result => {\n\
      console.log('标题:', result.title);\n\
      console.log('链接:', result.href);\n\
      console.log('摘要:', result.abstract);\n\
      console.log('----------------------');\n\
    });\n\
  })\n\
  .catch(error => {\n\
    console.error('发生错误:', error);\n\
  });" > index.js

# 設置環境變數（避免 Puppeteer 下載 Chromium，因為系統已提供）
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# 默認命令：運行測試腳本
CMD ["node", "index.js"]