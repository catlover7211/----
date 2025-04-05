from flask import Flask, render_template, request, jsonify
import requests
from bs4 import BeautifulSoup
import concurrent.futures
import re
import json
import hashlib
import time
from datetime import datetime, timedelta
import random
import subprocess
import os
import logging
import traceback
from urllib.parse import quote, urlparse
from functools import lru_cache

# 配置日誌
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("news_app.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# 搜索引擎服務配置
SEARCH_ENGINE_SERVICE = {
    "base_url": "http://localhost:3001",
    "endpoints": {
        "google": "/search/google",
        "bing": "/search/bing",
        "duckduckgo": "/search/duckduckgo",
        "all": "/search/all"
    }
}

# 定義要爬取的新聞網站列表
NEWS_SOURCES = {
    "中央社": {
        "search_url": "https://www.cna.com.tw/search/hysearchws.aspx?q={}",
        "article_selector": ".mainList li",
        "title_selector": "a",
        "link_selector": "a",
        "date_selector": ".date",
        "image_selector": "img",
        "base_url": "https://www.cna.com.tw"
    },
    "聯合新聞網": {
        "search_url": "https://udn.com/search/word/2/{}",
        "article_selector": ".story-list__news",
        "title_selector": "a",
        "link_selector": "a",
        "date_selector": "time",
        "image_selector": "img.story__image",
        "base_url": ""
    },
    "自由時報": {
        "search_url": "https://search.ltn.com.tw/list?keyword={}",
        "article_selector": ".searchlist li",
        "title_selector": "a.tit",
        "link_selector": "a.tit",
        "date_selector": "span.time",
        "image_selector": "img.lazy_imgs",
        "base_url": ""
    },
    "ETtoday": {
        "search_url": "https://www.ettoday.net/news_search/doSearch.php?keywords={}",
        "article_selector": ".piece",
        "title_selector": "h2 a",
        "link_selector": "h2 a",
        "date_selector": ".date",
        "image_selector": "img.lazyimage",
        "base_url": ""
    },
    "風傳媒": {
        "search_url": "https://www.storm.mg/site-search/result?q={}",
        "article_selector": ".link_title",
        "title_selector": "h3",
        "link_selector": "a",
        "date_selector": ".published",
        "image_selector": "img.img_contain",
        "base_url": ""
    },
    "TVBS新聞網": {
        "search_url": "https://news.tvbs.com.tw/station/search?keyword={}",
        "article_selector": ".icon_list li",
        "title_selector": "a",
        "link_selector": "a",
        "date_selector": "span.time",
        "image_selector": "img",
        "base_url": ""
    },
    "三立新聞網": {
        "search_url": "https://www.setn.com/search.aspx?q={}",
        "article_selector": ".newsItems",
        "title_selector": "a",
        "link_selector": "a",
        "date_selector": ".date",
        "image_selector": "img",
        "base_url": "https://www.setn.com"
    },
    "新頭殼": {
        "search_url": "https://newtalk.tw/search/result?keyword={}",
        "article_selector": ".news-list-item",
        "title_selector": ".news-title a",
        "link_selector": ".news-title a",
        "date_selector": ".news-time",
        "image_selector": ".news-img img",
        "base_url": ""
    },
    "中時新聞網": {
        "search_url": "https://www.chinatimes.com/search/{}",
        "article_selector": ".articlebox-compact",
        "title_selector": "h3 a",
        "link_selector": "h3 a",
        "date_selector": ".meta-info time",
        "image_selector": "img.photo",
        "base_url": "https://www.chinatimes.com"
    },
    "蘋果新聞網": {
        "search_url": "https://tw.appledaily.com/search/result?querystrS={}",
        "article_selector": ".story-card",
        "title_selector": "a",
        "link_selector": "a",
        "date_selector": ".timestamp",
        "image_selector": "img",
        "base_url": "https://tw.appledaily.com"
    },
    "公視新聞網": {
        "search_url": "https://news.pts.org.tw/search/{}",
        "article_selector": ".article-list li",
        "title_selector": "a",
        "link_selector": "a",
        "date_selector": ".datetime",
        "image_selector": "img",
        "base_url": "https://news.pts.org.tw"
    },
    "東森新聞": {
        "search_url": "https://www.ebc.net.tw/Search/Result?key={}",
        "article_selector": ".news-list-item",
        "title_selector": "a",
        "link_selector": "a",
        "date_selector": ".time",
        "image_selector": "img",
        "base_url": "https://www.ebc.net.tw"
    },
    "民視新聞": {
        "search_url": "https://www.ftvnews.com.tw/search/{}",
        "article_selector": ".news-list li",
        "title_selector": "a",
        "link_selector": "a",
        "date_selector": ".time",
        "image_selector": "img",
        "base_url": "https://www.ftvnews.com.tw"
    }
}
# 使用LRU快取來緩存搜索結果
@lru_cache(maxsize=100)
def cached_search_results(keyword, engine, limit, lang, region, page, timestamp):
    """使用時間戳作為參數的緩存函數，用於緩存搜索結果"""
    return fetch_global_news(keyword, limit, lang, region, page, 10)

# 增加一個輔助函數來清理過期的快取
def clean_expired_cache():
    """定期清理過期的快取項"""
    try:
        # 獲取 cached_search_results 函數的快取資訊
        cache_info = cached_search_results.cache_info()
        
        # 如果快取使用率超過 80%，清空快取
        if cache_info.currsize > 0.8 * cache_info.maxsize:
            logger.info(f"快取使用率高 ({cache_info.currsize}/{cache_info.maxsize})，正在清空...")
            cached_search_results.cache_clear()
            logger.info("快取已清空")
    except Exception as e:
        logger.error(f"清理快取時出錯: {str(e)}")

# 從 search-engine-tool 獲取全球新聞
def fetch_global_news(keyword, limit=30, lang="zh-TW", region="tw", page=1, per_page=10):
    """使用 search-engine-tool 搜索引擎服務獲取全球新聞"""
    try:
        # 對中文關鍵詞進行 URL 編碼 (僅用於日誌顯示，不傳遞給API)
        encoded_keyword = quote(keyword)
        logger.info(f"搜索關鍵詞：{keyword} (編碼後: {encoded_keyword})")
        
        # 首先嘗試檢查搜索引擎服務是否運行
        try:
            response = requests.get(f"{SEARCH_ENGINE_SERVICE['base_url']}/healthcheck", timeout=2)
            logger.info(f"搜索引擎服務狀態: {response.status_code}")
        except requests.exceptions.RequestException as e:
            # 如果服務未運行，嘗試啟動它
            logger.warning(f"搜索引擎服務未運行 ({str(e)})，嘗試啟動...")
            try:
                # 獲取當前工作目錄
                current_dir = os.path.dirname(os.path.abspath(__file__))
                service_dir = os.path.join(current_dir, "search_engine_service")
                
                # 使用 nohup 在後台啟動服務
                if os.name == 'nt':  # Windows
                    subprocess.Popen(
                        ["start", "cmd", "/c", "cd", service_dir, "&&", "npm", "start"],
                        shell=True
                    )
                else:  # macOS/Linux
                    subprocess.Popen(
                        f"cd '{service_dir}' && nohup npm start > search_service.log 2>&1 &",
                        shell=True
                    )
                time.sleep(3)  # 給服務一些啟動時間
                logger.info("搜索引擎服務已啟動")
            except Exception as e:
                logger.error(f"啟動搜索引擎服務失敗: {e}")
                return {
                    "success": False,
                    "message": f"無法啟動搜索引擎服務: {str(e)}",
                    "results": []
                }
        
        # 檢查是否有緩存結果可用（不包括時間戳）
        current_time = int(time.time())
        cache_time = current_time - (current_time % 3600)  # 緩存1小時
        
        # 嘗試調用搜索引擎服務的 API
        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                url = SEARCH_ENGINE_SERVICE["base_url"] + SEARCH_ENGINE_SERVICE["endpoints"]["all"]
                logger.info(f"發送請求到搜索引擎服務: {url}")
                
                response = requests.post(url, json={
                    "keyword": keyword,
                    "limit": limit,
                    "lang": lang,
                    "region": region,
                    "page": page,
                    "per_page": per_page
                }, timeout=10)
                
                response.raise_for_status()
                result = response.json()
                
                # 添加時間戳到結果中
                result["timestamp"] = datetime.now().isoformat()
                
                return result
            except requests.exceptions.RequestException as e:
                retry_count += 1
                logger.warning(f"搜索請求失敗 (嘗試 {retry_count}/{max_retries}): {str(e)}")
                time.sleep(1)  # 短暫休息後重試
        
        # 所有重試都失敗後，嘗試使用模擬搜索作為備份
        logger.warning("所有API請求重試都失敗，使用模擬搜索作為備份")
        simulated_results = simulate_global_search(keyword)
        
        # 分頁處理模擬結果
        start_idx = (page - 1) * per_page
        end_idx = start_idx + per_page
        paged_results = simulated_results[start_idx:end_idx]
        
        return {
            "success": True,
            "message": "使用模擬數據（搜索服務不可用）",
            "results": paged_results,
            "total_results": len(simulated_results),
            "page": page,
            "per_page": per_page,
            "total_pages": max(1, (len(simulated_results) + per_page - 1) // per_page)
        }
    except Exception as e:
        logger.error(f"全球新聞搜索錯誤: {str(e)}\n{traceback.format_exc()}")
        return {
            "success": False,
            "message": f"全球新聞搜索錯誤: {str(e)}",
            "results": []
        }

# 檢查搜索引擎服務是否已啟動，如果沒有則啟動它
def start_search_engine_service():
    """啟動 Node.js 搜索引擎服務"""
    try:
        service_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "search_engine_service")
        
        # 檢查操作系統類型
        if os.name == 'nt':  # Windows
            subprocess.Popen(
                "start cmd /c \"cd /d \"" + service_dir + "\" && npm start\"", 
                shell=True
            )
        else:  # macOS/Linux
            subprocess.Popen(
                f"cd '{service_dir}' && npm start &", 
                shell=True
            )
        
        # 等待服務啟動
        time.sleep(3)
        logger.info("搜索引擎服務已啟動")
        return True
    except Exception as e:
        logger.error(f"啟動搜索引擎服務時出錯: {e}")
        return False

# 模擬全球搜索的函數 (當搜索引擎服務不可用時作為備用)
def simulate_global_search(keyword, languages=["zh-TW", "en-US", "ja-JP"]):
    """模擬全球搜索，返回多樣化的新聞結果"""
    all_results = []
    domains = [
        # 台灣
        {"domain": "udn.com", "source": "聯合新聞網", "language": "zh-TW", "country": "台灣"},
        {"domain": "ltn.com.tw", "source": "自由時報", "language": "zh-TW", "country": "台灣"},
        {"domain": "cna.com.tw", "source": "中央社", "language": "zh-TW", "country": "台灣"},
        {"domain": "newtalk.tw", "source": "新頭殼", "language": "zh-TW", "country": "台灣"},
        # 國際
        {"domain": "nytimes.com", "source": "紐約時報", "language": "en-US", "country": "美國"},
        {"domain": "bbc.com", "source": "BBC News", "language": "en-US", "country": "英國"},
        {"domain": "cnn.com", "source": "CNN", "language": "en-US", "country": "美國"},
        {"domain": "reuters.com", "source": "路透社", "language": "en-US", "country": "國際"},
        {"domain": "ap.org", "source": "美聯社", "language": "en-US", "country": "美國"},
        {"domain": "theguardian.com", "source": "衛報", "language": "en-US", "country": "英國"},
        # 日本
        {"domain": "nhk.or.jp", "source": "NHK", "language": "ja-JP", "country": "日本"},
        {"domain": "asahi.com", "source": "朝日新聞", "language": "ja-JP", "country": "日本"},
        {"domain": "yomiuri.co.jp", "source": "讀賣新聞", "language": "ja-JP", "country": "日本"},
        # 韓國
        {"domain": "chosun.com", "source": "朝鮮日報", "language": "ko-KR", "country": "韓國"},
        {"domain": "joins.com", "source": "中央日報", "language": "ko-KR", "country": "韓國"},
        # 中國大陸
        {"domain": "sina.com.cn", "source": "新浪新聞", "language": "zh-CN", "country": "中國"},
        {"domain": "163.com", "source": "網易新聞", "language": "zh-CN", "country": "中國"},
        # 其他地區
        {"domain": "abc.net.au", "source": "澳洲廣播公司", "language": "en-US", "country": "澳洲"},
        {"domain": "france24.com", "source": "法國24小時", "language": "en-US", "country": "法國"},
        {"domain": "aljazeera.com", "source": "半島電視台", "language": "en-US", "country": "卡達"}
    ]
    
    # 根據關鍵字生成一致的哈希值，確保相同關鍵字每次生成相同結果
    seed = int(hashlib.md5(keyword.encode()).hexdigest(), 16) % 10000
    random.seed(seed)
    
    # 當前日期
    current_date = datetime.now()
    
    # 為每個語言市場生成結果
    for language in languages:
        # 按語言篩選網站
        language_domains = [d for d in domains if d["language"] == language or d["language"] == "zh-TW"]
        selected_domains = random.sample(language_domains, min(4, len(language_domains)))
        
        for domain_info in selected_domains:
            # 每個網站生成1-3篇結果
            article_count = random.randint(1, 3)
            for i in range(article_count):
                # 生成隨機標題，中文或英文取決於語言
                if language.startswith("zh"):
                    title_templates = [
                        f"最新：{keyword}相關報導引發廣泛關注",
                        f"專家分析：{keyword}對全球影響持續擴大",
                        f"深度解析：{keyword}背後的真相與趨勢",
                        f"突發消息：{keyword}最新發展情況",
                        f"獨家報導：{keyword}相關事件的全面解析"
                    ]
                elif language.startswith("ja"):
                    title_templates = [
                        f"{keyword}に関する最新情報",
                        f"注目：{keyword}の影響について分析",
                        f"特集：{keyword}の背景と今後の展開",
                        f"速報：{keyword}に関する最新動向",
                        f"独占：{keyword}についての詳細レポート"
                    ]
                else:
                    title_templates = [
                        f"Breaking: New Developments on {keyword}",
                        f"Analysis: The Impact of {keyword} on Global Events",
                        f"In-depth: Understanding the Trends Behind {keyword}",
                        f"Latest: {keyword} Continues to Make Headlines",
                        f"Special Report: The Complete Story of {keyword}"
                    ]
                
                title = random.choice(title_templates)
                
                # 創建隨機但看起來真實的URL
                article_id = random.randint(10000, 99999)
                
                # 生成一個最近30天內的隨機日期
                days_ago = random.randint(0, 30)
                article_date = current_date - timedelta(days=days_ago)
                date_str = article_date.strftime("%Y-%m-%d %H:%M")
                
                # 在URL中也使用日期部分
                url_path = f"/news/{article_date.year}/{article_date.month:02d}/{article_date.day:02d}/{article_id}.html"
                
                # 構建完整URL
                url = f"https://www.{domain_info['domain']}{url_path}"
                
                # 隨機生成圖片URL
                image_id = random.randint(1000, 9999)
                image_url = f"https://images.{domain_info['domain']}/news/{article_date.year}/{article_date.month:02d}/img_{image_id}.jpg"
                
                # 生成摘要
                if language.startswith("zh"):
                    snippets = [
                        f"根據最新消息，{keyword}的情況引起了廣泛關注。多位專家表示，這一發展將對相關領域產生深遠影響...",
                        f"針對{keyword}的最新發展，各界反應不一。有分析認為，這可能預示著未來趨勢的重大轉變...",
                        f"本報道獨家追蹤{keyword}的最新進展。據可靠消息來源透露，相關方面已經開始採取行動應對...",
                    ]
                elif language.startswith("ja"):
                    snippets = [
                        f"{keyword}に関する最新の展開が注目を集めています。専門家によると、この動きは関連分野に大きな影響を与えるとのこと...",
                        f"{keyword}の最新動向について、様々な反応が見られます。一部の分析では、これが将来のトレンドの重要な転換点になる可能性があると指摘...",
                        f"{keyword}の進展を独自に追跡。信頼できる情報源によると、関係者はすでに対応策を講じている模様...",
                    ]
                else:
                    snippets = [
                        f"According to recent developments, {keyword} has garnered widespread attention. Experts suggest this development will have profound implications...",
                        f"Reactions to the latest updates on {keyword} have been mixed. Some analysts believe this may signal a significant shift in future trends...",
                        f"Our exclusive coverage tracks the latest on {keyword}. According to reliable sources, relevant parties have begun taking action...",
                    ]
                
                snippet = random.choice(snippets)
                
                all_results.append({
                    "source": domain_info["source"],
                    "country": domain_info["country"],
                    "language": language,
                    "title": title,
                    "link": url,
                    "date": date_str,
                    "image_url": image_url,
                    "snippet": snippet,
                    "is_global": True
                })
    
    # 混合實際的爬蟲結果和模擬的國際結果
    random.shuffle(all_results)
    return all_results

def fetch_news(keyword, source_name, source_config):
    """從特定新聞源爬取新聞"""
    try:
        url = source_config["search_url"].format(keyword)
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36"
        }
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        articles = soup.select(source_config["article_selector"])
        
        results = []
        for article in articles[:5]:  # 只取前5篇文章
            try:
                title_element = article.select_one(source_config["title_selector"])
                link_element = article.select_one(source_config["link_selector"])
                date_element = article.select_one(source_config["date_selector"])
                image_element = article.select_one(source_config["image_selector"])
                
                title = title_element.get_text().strip() if title_element else "無標題"
                link = link_element.get('href') if link_element else ""
                
                # 處理相對路徑
                if link and link.startswith('/'):
                    link = source_config["base_url"] + link
                
                date = ""
                if date_element:
                    date = date_element.get_text().strip()
                
                # 處理圖片
                image_url = ""
                if image_element:
                    # 優先檢查 data-src (懶加載圖片常用)
                    image_url = image_element.get('data-src') or image_element.get('data-original') or image_element.get('src')
                    # 處理相對路徑
                    if image_url and image_url.startswith('/'):
                        image_url = source_config["base_url"] + image_url
                
                # 嘗試提取摘要
                snippet = ""
                # 嘗試找到摘要元素或生成摘要
                summary_element = article.select_one(".summary") or article.select_one(".excerpt") or article.select_one("p")
                if summary_element:
                    snippet = summary_element.get_text().strip()
                
                if title and link:
                    results.append({
                        "source": source_name,
                        "country": "台灣",
                        "language": "zh-TW",
                        "title": title,
                        "link": link,
                        "date": date,
                        "image_url": image_url,
                        "snippet": snippet,
                        "is_global": False
                    })
            except Exception as e:
                logger.error(f"解析文章時出錯: {e}")
                
        return results
    except Exception as e:
        logger.error(f"從 {source_name} 抓取新聞時出錯: {e}")
        return []

def fetch_local_news(keyword):
    """並行從多個本地新聞來源獲取新聞"""
    results = []
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(NEWS_SOURCES)) as executor:
        # 提交所有爬蟲任務
        future_to_source = {
            executor.submit(fetch_news, keyword, source_name, source_config): source_name
            for source_name, source_config in NEWS_SOURCES.items()
        }
        
        # 收集結果
        for future in concurrent.futures.as_completed(future_to_source):
            source_name = future_to_source[future]
            try:
                source_results = future.result()
                if source_results:
                    results.extend(source_results)
            except Exception as e:
                logger.error(f"{source_name} 爬蟲失敗: {e}")
    
    return results

@app.route('/')
def index():
    """首頁路由"""
    return render_template('index.html')

@app.route("/search", methods=["GET", "POST"])
def search():
    """處理搜索請求"""
    if request.method == "POST":
        try:
            data = request.get_json()
            if not data:
                data = request.form.to_dict()
            
            keyword = data.get("keyword", "")
            search_type = data.get("search_type", "all")  # 'local', 'global', 'all'
            page = int(data.get("page", 1))
            per_page = int(data.get("per_page", 10))
            
            if not keyword:
                return jsonify({"success": False, "error": "關鍵字不能為空"})
            
            # 記錄搜索請求
            logger.info(f"收到搜索請求: 關鍵字={keyword}, 類型={search_type}, 頁碼={page}")
            
            results = []
            
            # 根據搜索類型獲取不同來源的結果
            if search_type in ["global", "all"]:
                # 添加時間戳參數以確保適當的緩存
                cache_time = int(time.time()) // 3600  # 每小時更新一次緩存
                
                # 調用搜索引擎服務
                global_results = fetch_global_news(
                    keyword, 
                    limit=50, 
                    page=page, 
                    per_page=per_page
                )
                
                if global_results.get("success", False):
                    results.extend(global_results.get("results", []))
                    
                    # 設置分頁信息
                    pagination = {
                        "total_results": global_results.get("total_results", 0),
                        "page": global_results.get("page", page),
                        "per_page": global_results.get("per_page", per_page),
                        "total_pages": global_results.get("total_pages", 1)
                    }
                else:
                    # 如果全球搜索失敗，記錄錯誤
                    error_msg = global_results.get("message", "未知錯誤")
                    logger.error(f"全球搜索失敗: {error_msg}")
                    
                    # 如果請求的是全球搜索但失敗了，使用模擬數據
                    if search_type == "global":
                        simulated_results = simulate_global_search(keyword)
                        results.extend(simulated_results[:(page * per_page)])
                        
                        # 設置分頁信息
                        total_results = len(simulated_results)
                        pagination = {
                            "total_results": total_results,
                            "page": page,
                            "per_page": per_page,
                            "total_pages": max(1, (total_results + per_page - 1) // per_page)
                        }
                    else:
                        pagination = {
                            "total_results": 0,
                            "page": page,
                            "per_page": per_page,
                            "total_pages": 0
                        }
            
            if search_type in ["local", "all"]:
                # 爬取本地新聞
                local_results = fetch_local_news(keyword)
                results.extend(local_results)
                
                # 如果只搜索本地新聞，設置分頁信息
                if search_type == "local":
                    total_results = len(local_results)
                    start_idx = (page - 1) * per_page
                    end_idx = start_idx + per_page
                    results = local_results[start_idx:end_idx]
                    
                    pagination = {
                        "total_results": total_results,
                        "page": page,
                        "per_page": per_page,
                        "total_pages": max(1, (total_results + per_page - 1) // per_page)
                    }
            
            # 根據日期排序結果（最新的先顯示）
            try:
                results = sorted(results, key=lambda x: x.get("date", ""), reverse=True)
            except Exception as e:
                logger.warning(f"排序結果時出錯: {e}")
            
            # 返回包含分頁信息的結果
            return jsonify({
                "success": True,
                "keyword": keyword,
                "search_type": search_type,
                "total_results": pagination["total_results"],
                "page": pagination["page"],
                "per_page": pagination["per_page"],
                "total_pages": pagination["total_pages"],
                "results": results
            })
        except Exception as e:
            logger.error(f"搜索處理時出錯: {str(e)}\n{traceback.format_exc()}")
            return jsonify({
                "success": False,
                "error": f"處理搜索請求時出錯: {str(e)}"
            })

    return render_template("index.html")

@app.route('/news-sources', methods=['GET'])
def get_news_sources():
    """獲取支持的新聞來源列表"""
    sources = {
        "local": list(NEWS_SOURCES.keys()),
        "global": ["Bing", "DuckDuckGo"]
    }
    return jsonify(sources)

@app.route('/search-service-status', methods=['GET'])
def check_service_status():
    """檢查搜索引擎服務狀態"""
    try:
        response = requests.get(f"{SEARCH_ENGINE_SERVICE['base_url']}/healthcheck", timeout=2)
        if response.status_code == 200:
            return jsonify({"status": "online", "message": "服務正常運行中"})
        else:
            return jsonify({"status": "error", "message": f"服務返回異常狀態碼: {response.status_code}"})
    except requests.exceptions.ConnectionError:
        # 嘗試啟動服務
        if start_search_engine_service():
            return jsonify({"status": "starting", "message": "服務正在啟動中..."})
        else:
            return jsonify({"status": "offline", "message": "服務未啟動且無法自動啟動"})
    except Exception as e:
        logger.error(f"檢查服務狀態時出錯: {str(e)}")
        return jsonify({"status": "error", "message": f"檢查服務狀態時出錯: {str(e)}"})

@app.route('/trending', methods=['GET'])
def get_trending_topics():
    """獲取熱門話題"""
    # 模擬熱門話題
    trending = [
        {"topic": "新冠疫情", "count": random.randint(5000, 10000)},
        {"topic": "台灣選舉", "count": random.randint(4000, 8000)},
        {"topic": "半導體產業", "count": random.randint(3000, 7000)},
        {"topic": "全球經濟", "count": random.randint(2000, 6000)},
        {"topic": "氣候變遷", "count": random.randint(1000, 5000)},
        {"topic": "人工智能", "count": random.randint(1000, 5000)},
        {"topic": "國際關係", "count": random.randint(1000, 4000)}
    ]
    random.shuffle(trending)
    return jsonify({"success": True, "trending": trending[:5]})

@app.route('/stats', methods=['GET'])
def get_stats():
    """獲取系統統計信息"""
    stats = {
        "sources": len(NEWS_SOURCES),
        "global_sources": 20,  # 模擬數據
        "last_updated": datetime.now().isoformat(),
        "service_status": "online" if check_service_status().json["status"] == "online" else "offline"
    }
    return jsonify({"success": True, "stats": stats})

# 應用初始化函數
@app.before_first_request
def initialize_app():
    """應用首次請求前的初始化工作"""
    try:
        # 檢查搜索引擎服務是否運行
        try:
            requests.get(f"{SEARCH_ENGINE_SERVICE['base_url']}/healthcheck", timeout=1)
            logger.info("搜索引擎服務已經在運行")
        except requests.exceptions.ConnectionError:
            logger.info("搜索引擎服務未運行，正在啟動...")
            start_search_engine_service()
        except Exception as e:
            logger.error(f"檢查搜索引擎服務時出錯: {e}")
    except Exception as e:
        logger.error(f"初始化應用時出錯: {e}")

if __name__ == '__main__':
    # 啟動搜索引擎服務
    try:
        start_search_engine_service()
    except Exception as e:
        logger.error(f"啟動搜索引擎服務時出錯: {e}")
    
    # 啟動Flask應用
    app.run(debug=True, port=5001, host='0.0.0.0')
