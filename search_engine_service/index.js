const express = require('express');
const cors = require('cors');
const searchEngineTool = require('search-engine-tool');
const axios = require('axios');
const NodeCache = require('node-cache');
const { performance } = require('perf_hooks');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const compression = require('compression'); // 增加壓縮中間件
const helmet = require('helmet'); // 增加安全性中間件
const rateLimit = require('express-rate-limit'); // 增加速率限制
const os = require('os'); // 系統資源監控
const cluster = require('cluster'); // 為多核心處理器添加

// 建立快取實例，調整 TTL 並啟用監控
const searchCache = new NodeCache({ 
    stdTTL: 1800, 
    checkperiod: 120,
    useClones: false, // 提高性能
    maxKeys: 1000 // 限制快取大小
});

// 建議快取 - 用於存儲搜索建議
const suggestionsCache = new NodeCache({
    stdTTL: 86400, // 24小時
    checkperiod: 600,
    useClones: false,
    maxKeys: 500
});

// 建立更強大的日誌系統
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: { service: 'search-engine-service' },
    transports: [
        new winston.transports.File({ 
            filename: path.join(__dirname, 'search_service_error.log'), 
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        new winston.transports.File({ 
            filename: path.join(__dirname, 'search_service.log'),
            maxsize: 10485760, // 10MB
            maxFiles: 10
        })
    ]
});

// 開發環境下也輸出到控制台
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

// 檢查是否使用多核心處理
const enableCluster = process.env.ENABLE_CLUSTER === 'true';
const numCPUs = os.cpus().length;

// 在主進程中，創建工作進程
if (enableCluster && cluster.isMaster) {
    logger.info(`主進程 ${process.pid} 正在運行`);
    logger.info(`啟動 ${numCPUs} 個工作進程...`);
    
    // 為每個CPU生成一個工作進程
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }
    
    cluster.on('exit', (worker, code, signal) => {
        logger.warn(`工作進程 ${worker.process.pid} 已退出，狀態碼: ${code}, 信號: ${signal}`);
        logger.info('啟動新的工作進程...');
        cluster.fork();
    });
    
    // 主進程不需要導出 app，因為它不處理請求
} else {
    const app = express();
    const PORT = process.env.PORT || 3001;
    const VERSION = '1.4.0'; // 更新版本號
    
    // 設定 API 限流 - 防止濫用
    const apiLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15分鐘
        max: 100, // 限制每個 IP 15分鐘內最多 100 個請求
        standardHeaders: true,
        legacyHeaders: false,
        message: '請求過於頻繁，請稍後再試'
    });
    
    // 啟用 CORS 與安全性中間件
    app.use(cors());
    app.use(helmet()); // 增加 HTTP 標頭安全性
    app.use(compression()); // 壓縮所有回應
    app.use(express.json({limit: '1mb'})); // 增加請求體大小限制
    app.use(express.urlencoded({extended: true, limit: '1mb'}));
    
    // 設定 API 請求日誌
    const accessLogStream = fs.createWriteStream(
        path.join(__dirname, 'access.log'), 
        { flags: 'a' }
    );
    app.use(morgan('combined', { stream: accessLogStream }));
    
    // 為 API 端點啟用限流
    app.use('/search', apiLimiter);
    
    // 請求計數器與性能指標
    let requestsServed = 0;
    let searchesPerformed = 0;
    let lastRestart = Date.now();
    let avgResponseTime = 0;
    
    // 每小時記錄系統資源使用情況
    setInterval(() => {
        const memoryUsage = process.memoryUsage();
        const freeMem = os.freemem();
        const totalMem = os.totalmem();
        const cpuUsage = os.loadavg()[0];
        
        logger.info('系統資源使用情況', {
            memory: {
                free: formatBytes(freeMem),
                total: formatBytes(totalMem),
                heap_used: formatBytes(memoryUsage.heapUsed),
                heap_total: formatBytes(memoryUsage.heapTotal),
                rss: formatBytes(memoryUsage.rss)
            },
            cpu: {
                load_avg: cpuUsage,
                cores: numCPUs
            },
            uptime: formatUptime(process.uptime()),
            cache: {
                size: searchCache.keys().length,
                suggestion_cache_size: suggestionsCache.keys().length,
                hit_ratio: searchCache.stats.hits > 0 
                    ? Math.round((searchCache.stats.hits / (searchCache.stats.hits + searchCache.stats.misses)) * 100) 
                    : 0
            }
        });
    }, 3600000); // 每小時執行一次
    
    // 處理全域未捕獲的錯誤
    process.on('uncaughtException', (error) => {
        logger.error(`未捕獲的異常: ${error.message}`, { stack: error.stack });
        // 在生產環境中考慮優雅地重啟
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        logger.error('未處理的 Promise 拒絕', { promise, reason });
    });
    
    // 優化的輔助函數
    const extractSourceFromUrl = (url) => {
        try {
            if (!url) return '未知來源';
            const hostname = new URL(url).hostname;
            return hostname.replace(/^www\./, '').split('.')[0];
        } catch (e) {
            logger.warn(`無法從 URL 解析來源: ${url}`);
            return '未知來源';
        }
    };
    
    const getCountryFromLang = (lang) => {
        const langMap = {
            'zh-TW': 'tw',
            'zh-CN': 'cn',
            'en-US': 'us',
            'en-GB': 'uk',
            'ja': 'jp',
            'ko': 'kr',
            'fr': 'fr',
            'de': 'de',
            'es': 'es',
            'ru': 'ru'
        };
        return langMap[lang] || 'global';
    };
    
    // 優化圖片獲取功能，加入錯誤處理和超時設定
    const fetchImageForArticle = async (url) => {
        try {
            if (!url) return null;
            
            const cacheKey = `image:${url}`;
            const cachedImage = searchCache.get(cacheKey);
            if (cachedImage) return cachedImage;
            
            const response = await axios.get(`https://api.microlink.io?url=${encodeURIComponent(url)}&meta=false`, {
                timeout: 3000 // 3秒超時
            });
            
            const imageUrl = response.data?.data?.image?.url || null;
            if (imageUrl) {
                searchCache.set(cacheKey, imageUrl, 86400); // 快取 24 小時
            }
            return imageUrl;
        } catch (error) {
            logger.debug(`無法獲取文章圖片 (${url}): ${error.message}`);
            return null;
        }
    };
    
    // 新增功能：獲取相關搜索建議
    const fetchSearchSuggestions = async (keyword, engine = 'google') => {
        try {
            if (!keyword || keyword.trim().length < 2) return [];
            
            const cacheKey = `suggestions:${engine}:${keyword}`;
            const cachedSuggestions = suggestionsCache.get(cacheKey);
            if (cachedSuggestions) return cachedSuggestions;
            
            // 從 Google 搜索建議 API 獲取
            const response = await axios.get(
                `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(keyword)}`,
                { timeout: 2000 }
            );
            
            if (response.data && Array.isArray(response.data[1])) {
                const suggestions = response.data[1].slice(0, 10);
                suggestionsCache.set(cacheKey, suggestions, 86400); // 快取一天
                return suggestions;
            }
            
            return [];
        } catch (error) {
            logger.debug(`無法獲取搜索建議 (${keyword}): ${error.message}`);
            return [];
        }
    };
    
    // 健康檢查端點 - 改進版
    app.get('/healthcheck', (req, res) => {
        const uptime = Math.floor((Date.now() - lastRestart) / 1000);
        const uptimeMinutes = Math.floor(uptime / 60);
        const uptimeHours = Math.floor(uptimeMinutes / 60);
        
        res.status(200).json({ 
            status: 'ok', 
            message: '搜索引擎服務正常運行中',
            version: VERSION,
            uptime: `${uptimeHours}小時${uptimeMinutes % 60}分鐘${uptime % 60}秒`,
            server_info: {
                processor_id: process.pid,
                platform: process.platform,
                node_version: process.version,
                cpu_cores: numCPUs,
                cpu_usage: os.loadavg()[0],
                memory: {
                    total: formatBytes(os.totalmem()),
                    free: formatBytes(os.freemem()),
                    usage_percent: Math.round((1 - os.freemem() / os.totalmem()) * 100)
                }
            },
            stats: {
                requests: requestsServed,
                searches: searchesPerformed,
                cache_size: searchCache.stats.keys,
                suggestions_cache: suggestionsCache.stats.keys,
                avg_response_time: `${Math.round(avgResponseTime)}ms`
            },
            environment: process.env.NODE_ENV || 'development',
            last_updated: new Date().toISOString()
        });
    });
    
    // 增強的統計 API
    app.get('/api/stats', (req, res) => {
        const stats = {
            uptime: process.uptime(),
            uptime_formatted: formatUptime(process.uptime()),
            requests_served: requestsServed,
            searches_performed: searchesPerformed,
            avg_response_time: `${Math.round(avgResponseTime)}ms`,
            cache: {
                ...searchCache.stats(),
                hit_ratio: searchCache.stats.hits > 0 
                    ? Math.round((searchCache.stats.hits / (searchCache.stats.hits + searchCache.stats.misses)) * 100) 
                    : 0
            },
            suggestions_cache: {
                ...suggestionsCache.stats(),
                size: suggestionsCache.keys().length
            },
            memory_usage: {
                ...process.memoryUsage(),
                formatted: {
                    rss: formatBytes(process.memoryUsage().rss),
                    heapTotal: formatBytes(process.memoryUsage().heapTotal),
                    heapUsed: formatBytes(process.memoryUsage().heapUsed),
                    external: formatBytes(process.memoryUsage().external || 0)
                },
                system: {
                    total: formatBytes(os.totalmem()),
                    free: formatBytes(os.freemem()),
                    usage_percent: Math.round((1 - os.freemem() / os.totalmem()) * 100)
                }
            },
            system: {
                platform: process.platform,
                arch: process.arch,
                cpu_cores: numCPUs,
                cpu_model: os.cpus()[0].model,
                cpu_load: os.loadavg(),
                hostname: os.hostname()
            },
            version: VERSION,
            node_version: process.version,
            last_restart: new Date(lastRestart).toISOString()
        };
        
        res.json(stats);
    });
    
    // 格式化時間輔助函數
    function formatUptime(seconds) {
        const days = Math.floor(seconds / 86400);
        seconds %= 86400;
        const hours = Math.floor(seconds / 3600);
        seconds %= 3600;
        const minutes = Math.floor(seconds / 60);
        seconds = Math.floor(seconds % 60);
        
        return `${days}天 ${hours}小時 ${minutes}分鐘 ${seconds}秒`;
    }
    
    // 格式化位元組輔助函數
    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
    
    // 刷新緩存API - 增強版
    app.post('/api/cache/clear', (req, res) => {
        const clearedKeys = searchCache.keys().length;
        searchCache.flushAll();
        
        logger.info(`已清空緩存，刪除了 ${clearedKeys} 個項目`);
        res.json({ 
            success: true, 
            message: `已清空緩存，刪除了 ${clearedKeys} 個項目`,
            timestamp: new Date().toISOString() 
        });
    });
    
    // 選擇性清除快取 API
    app.post('/api/cache/clear/:engine', (req, res) => {
        const { engine } = req.params;
        if (!engine) {
            return res.status(400).json({ 
                success: false, 
                message: '必須指定搜索引擎' 
            });
        }
        
        let count = 0;
        const keys = searchCache.keys();
        for (const key of keys) {
            if (key.startsWith(`${engine}:`)) {
                searchCache.del(key);
                count++;
            }
        }
        
        logger.info(`已清空 ${engine} 引擎的緩存，刪除了 ${count} 個項目`);
        res.json({ 
            success: true, 
            message: `已清空 ${engine} 引擎的緩存，刪除了 ${count} 個項目`,
            timestamp: new Date().toISOString() 
        });
    });
    
    // 查看快取統計 API
    app.get('/api/cache/stats', (req, res) => {
        const keys = searchCache.keys();
        const engineStats = {};
        
        for (const key of keys) {
            const engine = key.split(':')[0];
            if (!engineStats[engine]) {
                engineStats[engine] = 0;
            }
            engineStats[engine]++;
        }
        
        res.json({
            total_items: keys.length,
            engine_breakdown: engineStats,
            hit_ratio: searchCache.stats.hits > 0 
                ? Math.round((searchCache.stats.hits / (searchCache.stats.hits + searchCache.stats.misses)) * 100) 
                : 0,
            stats: searchCache.stats(),
            suggestions_cache: {
                total_items: suggestionsCache.keys().length,
                hit_ratio: suggestionsCache.stats.hits > 0 
                    ? Math.round((suggestionsCache.stats.hits / (suggestionsCache.stats.hits + suggestionsCache.stats.misses)) * 100) 
                    : 0,
                stats: suggestionsCache.stats()
            }
        });
    });
    
    // 處理 Yahoo 搜索 - 增強版
    app.post('/search/yahoo', async (req, res) => {
        const startTime = performance.now();
        try {
            const { keyword, limit = 10, lang = 'zh-TW' } = req.body;
            
            requestsServed++;
            
            if (!keyword) {
                return res.status(400).json({ 
                    error: '關鍵字不能為空',
                    success: false 
                });
            }
            
            // 檢查快取
            const cacheKey = `yahoo:${keyword}:${lang}:${limit}`;
            const cachedResult = searchCache.get(cacheKey);
            
            if (cachedResult) {
                logger.info(`從快取中返回 Yahoo 搜索結果: ${keyword}`);
                return res.json({
                    ...cachedResult,
                    cache_hit: true,
                    response_time: Math.round(performance.now() - startTime)
                });
            }
            
            logger.info(`執行 Yahoo 搜索: ${keyword}, 語言: ${lang}`);
            searchesPerformed++;
            
            // 使用 searchEngineTool 進行搜索
            const results = await searchEngineTool(keyword, 'yahoo');
            
            if (!results || results.length === 0) {
                const responseTime = performance.now() - startTime;
                updateAvgResponseTime(responseTime);
                
                return res.json({
                    success: true,
                    engine: 'Yahoo',
                    results: [],
                    total_results: 0,
                    message: '沒有找到結果',
                    response_time: Math.round(responseTime)
                });
            }
            
            // 過濾並格式化結果 - 使用並行處理提升效能
            const formattedResults = await Promise.all(results.map(async item => ({
                title: item.title || '無標題',
                link: item.href || '',
                snippet: item.abstract || '',
                source: extractSourceFromUrl(item.href),
                country: getCountryFromLang(lang),
                language: lang,
                image_url: await fetchImageForArticle(item.href),
                is_global: true,
                timestamp: new Date().toISOString()
            })));
            
            const responseTime = performance.now() - startTime;
            updateAvgResponseTime(responseTime);
            
            const responseData = { 
                success: true, 
                engine: 'Yahoo', 
                results: formattedResults,
                total_results: formattedResults.length,
                keyword,
                page: 1,
                per_page: limit,
                total_pages: Math.ceil(formattedResults.length / limit),
                response_time: Math.round(responseTime)
            };
            
            // 存入快取
            searchCache.set(cacheKey, responseData);
            
            res.json(responseData);
        } catch (error) {
            const responseTime = performance.now() - startTime;
            updateAvgResponseTime(responseTime);
            
            logger.error(`Yahoo 搜索錯誤: ${error.message}`, { 
                stack: error.stack,
                keyword: req.body?.keyword,
                lang: req.body?.lang
            });
            
            res.status(500).json({ 
                error: `Yahoo 搜索錯誤: ${error.message}`,
                success: false,
                response_time: Math.round(responseTime)
            });
        }
    });
    
    // 新增對 DuckDuckGo 的支援
    app.post('/search/duckduckgo', async (req, res) => {
        const startTime = performance.now();
        try {
            const { keyword, limit = 10, lang = 'zh-TW' } = req.body;
            
            requestsServed++;
            
            if (!keyword) {
                return res.status(400).json({ 
                    error: '關鍵字不能為空',
                    success: false 
                });
            }
            
            // 檢查快取
            const cacheKey = `duckduckgo:${keyword}:${lang}:${limit}`;
            const cachedResult = searchCache.get(cacheKey);
            
            if (cachedResult) {
                logger.info(`從快取中返回 DuckDuckGo 搜索結果: ${keyword}`);
                return res.json({
                    ...cachedResult,
                    cache_hit: true,
                    response_time: Math.round(performance.now() - startTime)
                });
            }
            
            logger.info(`執行 DuckDuckGo 搜索: ${keyword}, 語言: ${lang}`);
            searchesPerformed++;
            
            // 使用 searchEngineTool 進行搜索
            const results = await searchEngineTool(keyword, 'duckduckgo');
            
            if (!results || results.length === 0) {
                const responseTime = performance.now() - startTime;
                updateAvgResponseTime(responseTime);
                
                return res.json({
                    success: true,
                    engine: 'DuckDuckGo',
                    results: [],
                    total_results: 0,
                    message: '沒有找到結果',
                    response_time: Math.round(responseTime)
                });
            }
            
            // 過濾並格式化結果
            const formattedResults = await Promise.all(results.map(async item => ({
                title: item.title || '無標題',
                link: item.href || '',
                snippet: item.abstract || '',
                source: extractSourceFromUrl(item.href),
                country: getCountryFromLang(lang),
                language: lang,
                image_url: await fetchImageForArticle(item.href),
                is_global: true,
                timestamp: new Date().toISOString()
            })));
            
            const responseTime = performance.now() - startTime;
            updateAvgResponseTime(responseTime);
            
            const responseData = { 
                success: true, 
                engine: 'DuckDuckGo', 
                results: formattedResults,
                total_results: formattedResults.length,
                keyword,
                page: 1,
                per_page: limit,
                total_pages: Math.ceil(formattedResults.length / limit),
                response_time: Math.round(responseTime)
            };
            
            // 存入快取
            searchCache.set(cacheKey, responseData);
            
            res.json(responseData);
        } catch (error) {
            const responseTime = performance.now() - startTime;
            updateAvgResponseTime(responseTime);
            
            logger.error(`DuckDuckGo 搜索錯誤: ${error.message}`, { 
                stack: error.stack,
                keyword: req.body?.keyword,
                lang: req.body?.lang
            });
            
            res.status(500).json({ 
                error: `DuckDuckGo 搜索錯誤: ${error.message}`,
                success: false,
                response_time: Math.round(responseTime)
            });
        }
    });
    
    // 新增對 Google 的支持
    app.post('/search/google', async (req, res) => {
        const startTime = performance.now();
        try {
            const { keyword, limit = 10, lang = 'zh-TW' } = req.body;
            
            requestsServed++;
            
            if (!keyword) {
                return res.status(400).json({ 
                    error: '關鍵字不能為空',
                    success: false 
                });
            }
            
            // 檢查快取
            const cacheKey = `google:${keyword}:${lang}:${limit}`;
            const cachedResult = searchCache.get(cacheKey);
            
            if (cachedResult) {
                logger.info(`從快取中返回 Google 搜索結果: ${keyword}`);
                return res.json({
                    ...cachedResult,
                    cache_hit: true,
                    response_time: Math.round(performance.now() - startTime)
                });
            }
            
            logger.info(`執行 Google 搜索: ${keyword}, 語言: ${lang}`);
            searchesPerformed++;
            
            // 使用 searchEngineTool 進行搜索
            const results = await searchEngineTool(keyword, 'google');
            
            // 同時獲取搜索建議
            const suggestions = await fetchSearchSuggestions(keyword, 'google');
            
            if (!results || results.length === 0) {
                const responseTime = performance.now() - startTime;
                updateAvgResponseTime(responseTime);
                
                return res.json({
                    success: true,
                    engine: 'Google',
                    results: [],
                    total_results: 0,
                    suggestions: suggestions,
                    message: '沒有找到結果',
                    response_time: Math.round(responseTime)
                });
            }
            
            // 過濾並格式化結果 - 使用並行處理提升效能
            const formattedResults = await Promise.all(results.map(async item => ({
                title: item.title || '無標題',
                link: item.href || '',
                snippet: item.abstract || '',
                source: extractSourceFromUrl(item.href),
                country: getCountryFromLang(lang),
                language: lang,
                image_url: await fetchImageForArticle(item.href),
                is_global: true,
                timestamp: new Date().toISOString()
            })));
            
            const responseTime = performance.now() - startTime;
            updateAvgResponseTime(responseTime);
            
            const responseData = { 
                success: true, 
                engine: 'Google', 
                results: formattedResults,
                total_results: formattedResults.length,
                suggestions: suggestions,
                keyword,
                page: 1,
                per_page: limit,
                total_pages: Math.ceil(formattedResults.length / limit),
                response_time: Math.round(responseTime)
            };
            
            // 存入快取
            searchCache.set(cacheKey, responseData);
            
            res.json(responseData);
        } catch (error) {
            const responseTime = performance.now() - startTime;
            updateAvgResponseTime(responseTime);
            
            logger.error(`Google 搜索錯誤: ${error.message}`, { 
                stack: error.stack,
                keyword: req.body?.keyword,
                lang: req.body?.lang
            });
            
            res.status(500).json({ 
                error: `Google 搜索錯誤: ${error.message}`,
                success: false,
                response_time: Math.round(responseTime)
            });
        }
    });
    
    // 處理來自多個引擎的聚合搜索 - 增強版，添加 Google 支持
    app.post('/search/multi', async (req, res) => {
        const startTime = performance.now();
        try {
            const { keyword, engines = ['google', 'bing', 'yahoo'], limit = 10, lang = 'zh-TW' } = req.body;
            
            requestsServed++;
            
            if (!keyword) {
                return res.status(400).json({ 
                    error: '關鍵字不能為空',
                    success: false 
                });
            }
            
            if (!Array.isArray(engines) || engines.length === 0) {
                return res.status(400).json({ 
                    error: '必須指定至少一個搜索引擎',
                    success: false 
                });
            }
            
            // 檢查快取
            const cacheKey = `multi:${engines.sort().join(',')}:${keyword}:${lang}:${limit}`;
            const cachedResult = searchCache.get(cacheKey);
            
            if (cachedResult) {
                logger.info(`從快取中返回多引擎搜索結果: ${keyword}`);
                return res.json({
                    ...cachedResult,
                    cache_hit: true,
                    response_time: Math.round(performance.now() - startTime)
                });
            }
            
            logger.info(`執行多引擎搜索: ${keyword}, 引擎: ${engines.join(', ')}, 語言: ${lang}`);
            searchesPerformed++;
            
            // 使用 Promise.allSettled 並行請求所有引擎
            const searchPromises = engines.map(engine => {
                return searchEngineTool(keyword, engine)
                    .then(results => ({ engine, results, success: true }))
                    .catch(error => ({ 
                        engine, 
                        results: [], 
                        success: false, 
                        error: error.message 
                    }));
            });
            
            // 同時獲取搜索建議
            const suggestionsPromise = fetchSearchSuggestions(keyword);
            
            const [searchResults, suggestions] = await Promise.all([
                Promise.allSettled(searchPromises),
                suggestionsPromise
            ]);
            
            // 整合來自不同引擎的結果
            let allResults = [];
            const engineResults = {};
            
            for (const result of searchResults) {
                if (result.status === 'fulfilled') {
                    const { engine, results, success } = result.value;
                    engineResults[engine] = { 
                        success, 
                        results: results?.length || 0 
                    };
                    
                    if (success && results && results.length > 0) {
                        // 為每個結果標記來源引擎並整合
                        const formattedResults = await Promise.all(results.map(async item => ({
                            title: item.title || '無標題',
                            link: item.href || '',
                            snippet: item.abstract || '',
                            source: extractSourceFromUrl(item.href),
                            country: getCountryFromLang(lang),
                            language: lang,
                            image_url: await fetchImageForArticle(item.href),
                            is_global: true,
                            source_engine: engine,
                            timestamp: new Date().toISOString()
                        })));
                        
                        allResults = [...allResults, ...formattedResults];
                    }
                } else {
                    const engine = result.reason.engine || 'unknown';
                    engineResults[engine] = { 
                        success: false, 
                        error: result.reason.message 
                    };
                }
            }
            
            // 去重，根據 URL 去除相同的結果
            const uniqueResults = [];
            const seenUrls = new Set();
            
            for (const result of allResults) {
                if (!seenUrls.has(result.link)) {
                    seenUrls.add(result.link);
                    uniqueResults.push(result);
                }
            }
            
            // 結果權重排序
            uniqueResults.sort((a, b) => {
                // 如果來源於 Google，優先顯示
                if (a.source_engine === 'google' && b.source_engine !== 'google') return -1;
                if (a.source_engine !== 'google' && b.source_engine === 'google') return 1;
                
                // 如果多個引擎都返回相同結果，優先顯示
                const aWeight = Object.keys(engineResults).filter(engine => 
                    allResults.some(r => r.link === a.link && r.source_engine === engine)
                ).length;
                
                const bWeight = Object.keys(engineResults).filter(engine => 
                    allResults.some(r => r.link === b.link && r.source_engine === engine)
                ).length;
                
                return bWeight - aWeight;
            });
            
            // 限制結果數量
            const limitedResults = uniqueResults.slice(0, limit);
            
            const responseTime = performance.now() - startTime;
            updateAvgResponseTime(responseTime);
            
            const responseData = { 
                success: true, 
                engines: engineResults, 
                results: limitedResults,
                total_results: limitedResults.length,
                total_raw_results: allResults.length,
                suggestions: suggestions,
                keyword,
                page: 1,
                per_page: limit,
                total_pages: Math.ceil(uniqueResults.length / limit),
                response_time: Math.round(responseTime)
            };
            
            // 存入快取
            searchCache.set(cacheKey, responseData);
            
            res.json(responseData);
        } catch (error) {
            const responseTime = performance.now() - startTime;
            updateAvgResponseTime(responseTime);
            
            logger.error(`多引擎搜索錯誤: ${error.message}`, { 
                stack: error.stack,
                keyword: req.body?.keyword,
                engines: req.body?.engines,
                lang: req.body?.lang
            });
            
            res.status(500).json({ 
                error: `多引擎搜索錯誤: ${error.message}`,
                success: false,
                response_time: Math.round(responseTime)
            });
        }
    });
    
    // 新增搜索建議 API 端點
    app.get('/api/suggestions', async (req, res) => {
        const startTime = performance.now();
        try {
            const { keyword, engine = 'google' } = req.query;
            
            if (!keyword || keyword.length < 2) {
                return res.status(400).json({
                    success: false,
                    error: '關鍵字過短或為空',
                    response_time: Math.round(performance.now() - startTime)
                });
            }
            
            const suggestions = await fetchSearchSuggestions(keyword, engine);
            
            res.json({
                success: true,
                keyword,
                suggestions,
                count: suggestions.length,
                engine,
                response_time: Math.round(performance.now() - startTime)
            });
        } catch (error) {
            logger.error(`獲取搜索建議錯誤: ${error.message}`, {
                keyword: req.query?.keyword
            });
            
            res.status(500).json({
                success: false,
                error: `獲取搜索建議錯誤: ${error.message}`,
                response_time: Math.round(performance.now() - startTime)
            });
        }
    });
    
    // 新增多引擎搜索端點
    app.post('/search/all', async (req, res) => {
        const startTime = performance.now();
        try {
            const { keyword, limit = 10, lang = 'zh-TW' } = req.body;
            
            requestsServed++;
            
            if (!keyword) {
                return res.status(400).json({ 
                    error: '關鍵字不能為空',
                    success: false 
                });
            }
            
            // 檢查快取
            const cacheKey = `all:${keyword}:${lang}:${limit}`;
            const cachedResult = searchCache.get(cacheKey);
            
            if (cachedResult) {
                logger.info(`從快取中返回多引擎搜索結果: ${keyword}`);
                return res.json({
                    ...cachedResult,
                    cache_hit: true,
                    response_time: Math.round(performance.now() - startTime)
                });
            }
            
            logger.info(`執行多引擎搜索: ${keyword}, 語言: ${lang}`);
            searchesPerformed++;
            
            // 使用 searchMultipleEngines 進行搜索
            const searchResult = await searchEngineTool.searchMultipleEngines(
                keyword, 
                ['google', 'bing', 'yahoo', 'duckduckgo'], 
                { language: lang, maxResults: limit }
            );
            
            // 合併所有引擎的結果
            let allResults = [];
            let successEngines = [];
            let failedEngines = [];
            
            searchResult.forEach(result => {
                if (result.success && result.results.length > 0) {
                    successEngines.push(result.engine);
                    allResults = allResults.concat(result.results);
                } else {
                    failedEngines.push(result.engine);
                }
            });
            
            // 移除重複結果 (基於 URL)
            const uniqueUrls = new Set();
            allResults = allResults.filter(item => {
                if (!item.href || uniqueUrls.has(item.href)) return false;
                uniqueUrls.add(item.href);
                return true;
            });
            
            if (allResults.length === 0) {
                const responseTime = performance.now() - startTime;
                updateAvgResponseTime(responseTime);
                
                return res.json({
                    success: true,
                    engine: 'All',
                    results: [],
                    total_results: 0,
                    message: '沒有找到結果',
                    response_time: Math.round(responseTime)
                });
            }
            
            // 過濾並格式化結果 - 使用並行處理提升效能
            const formattedResults = await Promise.all(allResults.map(async item => ({
                title: item.title || '無標題',
                link: item.href || '',
                snippet: item.abstract || '',
                source: extractSourceFromUrl(item.href),
                country: getCountryFromLang(lang),
                language: lang,
                engine: item.engine || 'unknown',
                image_url: await fetchImageForArticle(item.href),
                is_global: true,
                timestamp: new Date().toISOString()
            })));
            
            const responseTime = performance.now() - startTime;
            updateAvgResponseTime(responseTime);
            
            const responseData = { 
                success: true, 
                engine: 'All', 
                engines_used: successEngines,
                engines_failed: failedEngines,
                results: formattedResults,
                total_results: formattedResults.length,
                keyword,
                page: 1,
                per_page: limit,
                total_pages: Math.ceil(formattedResults.length / limit),
                response_time: Math.round(responseTime)
            };
            
            // 存入快取
            searchCache.set(cacheKey, responseData);
            
            // 同時獲取相關搜索建議
            const suggestions = await fetchSearchSuggestions(keyword);
            if (suggestions && suggestions.length > 0) {
                responseData.related_searches = suggestions;
            }
            
            res.json(responseData);
        } catch (error) {
            const responseTime = performance.now() - startTime;
            updateAvgResponseTime(responseTime);
            
            logger.error(`多引擎搜索錯誤: ${error.message}`, { 
                stack: error.stack,
                keyword: req.body?.keyword,
                lang: req.body?.lang
            });
            
            res.status(500).json({ 
                error: `多引擎搜索錯誤: ${error.message}`,
                success: false,
                response_time: Math.round(responseTime)
            });
        }
    });
    
    // 更新平均回應時間
    function updateAvgResponseTime(newResponseTime) {
        if (avgResponseTime === 0) {
            avgResponseTime = newResponseTime;
        } else {
            // 使用移動平均值計算
            avgResponseTime = avgResponseTime * 0.9 + newResponseTime * 0.1;
        }
    }
    
    // 全域錯誤處理中間件
    app.use((err, req, res, next) => {
        logger.error(`未處理的錯誤: ${err.message}`, { stack: err.stack });
        
        res.status(500).json({
            success: false,
            error: '伺服器內部錯誤',
            message: process.env.NODE_ENV === 'production' ? '發生了錯誤，請稍後再試' : err.message
        });
    });
    
    // 處理 404 未找到的路由
    app.use((req, res) => {
        res.status(404).json({
            success: false,
            error: '找不到請求的資源',
            endpoint: req.originalUrl
        });
    });
    
    // 啟動伺服器
    app.listen(PORT, () => {
        logger.info(`搜索引擎服務運行在端口 ${PORT}`);
        console.log(`搜索引擎服務已啟動: http://localhost:${PORT}`);
        console.log(`版本: ${VERSION}, 環境: ${process.env.NODE_ENV || 'development'}`);
        console.log(`工作進程 ${process.pid} 已啟動`);
        
        // 記錄系統信息
        logger.info('服務啟動信息', {
            version: VERSION,
            port: PORT,
            pid: process.pid,
            node_version: process.version,
            platform: process.platform,
            memory: formatBytes(os.totalmem()),
            cpu_cores: numCPUs
        });
    });
    
    // 只在工作進程中導出 app
    module.exports = app; // 導出供測試使用
}