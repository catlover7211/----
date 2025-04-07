document.addEventListener('DOMContentLoaded', function() {
    const searchButton = document.getElementById('searchButton');
    const searchQuery = document.getElementById('searchQuery');
    const searchLimit = document.getElementById('searchLimit');
    const resultsContainer = document.getElementById('results');
    const loadingIndicator = document.getElementById('loading');
    const relatedKeywords = document.getElementById('related-keywords');
    const keywordsList = document.getElementById('keywords-list');
    
    searchButton.addEventListener('click', performSearch);
    searchQuery.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            performSearch();
        }
    });
    
    function performSearch() {
        const query = searchQuery.value.trim();
        if (!query) {
            alert('請輸入搜尋關鍵字');
            return;
        }
        
        // 顯示載入指示器
        loadingIndicator.style.display = 'block';
        resultsContainer.innerHTML = '';
        relatedKeywords.style.display = 'none';
        keywordsList.innerHTML = '';
        
        // 發送請求到後端
        fetch('/search', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: query,
                limit: searchLimit.value
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('搜尋請求失敗: ' + response.status);
            }
            return response.json();
        })
        .then(data => {
            if (!data) {
                throw new Error('未收到有效數據');
            }
            displayResults(data);
        })
        .catch(error => {
            handleError(error);
        })
        .finally(() => {
            loadingIndicator.style.display = 'none';
        });
    }
    
    function displayResults(data) {
        console.log("Received data:", data); // 記錄收到的數據以便調試
        
        if (!data || !data.results || data.results.length === 0) {
            resultsContainer.innerHTML = '<div class="no-results">沒有找到結果</div>';
            return;
        }
        
        // 顯示搜尋結果
        resultsContainer.innerHTML = '';
        data.results.forEach(result => {
            // 獲取原始網址 - 根據 API 返回的數據結構調整屬性名稱
            const url = result.url || result.link || result.href || '#';
            const title = result.title || '無標題';
            const description = result.description || result.snippet || '無描述';
            
            // 只提取網址的 domain 部分
            const domain = extractDomain(url);
            
            const resultItem = document.createElement('div');
            resultItem.className = 'result-item';
            
            resultItem.innerHTML = `
                <h2><a href="${url}" target="_blank">${title}</a></h2>
                <p class="result-link">${domain}</p>
                <p class="result-description">${description}</p>
            `;
            
            resultsContainer.appendChild(resultItem);
        });
        
        // 處理相關關鍵字
        if (data.related_keywords && data.related_keywords.length > 0) {
            relatedKeywords.style.display = 'block';
            keywordsList.innerHTML = '';
            
            data.related_keywords.forEach(keyword => {
                if (keyword) { // 確保關鍵字不是 undefined
                    const keywordTag = document.createElement('div');
                    keywordTag.className = 'keyword-tag';
                    keywordTag.textContent = keyword;
                    
                    keywordTag.addEventListener('click', () => {
                        searchQuery.value = keyword;
                        performSearch();
                    });
                    
                    keywordsList.appendChild(keywordTag);
                }
            });
        }
    }
    
    // 新增函數: 提取 URL 的 domain 部分
    function extractDomain(url) {
        try {
            if (url === '#' || !url) return '無網址';
            
            // 處理沒有 protocol 的 URL
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                url = 'https://' + url;
            }
            
            const parsedUrl = new URL(url);
            return parsedUrl.hostname;
        } catch (e) {
            console.error("URL parsing error:", e);
            return url; // 如果解析失敗，返回原始 URL
        }
    }
    
    function handleError(error) {
        console.error("Error:", error);
        resultsContainer.innerHTML = `<div class="error">錯誤: ${error.message}</div>`;
        loadingIndicator.style.display = 'none';
    }
});
