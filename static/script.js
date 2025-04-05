document.addEventListener('DOMContentLoaded', function() {
    // 初始化全局變量
    const config = {
        pageSize: 10,       // 每頁顯示結果數量
        currentPage: 1,     // 當前頁碼
        totalPages: 1,      // 總頁數
        lastKeyword: '',    // 上次搜索關鍵詞
        filters: {          // 篩選器
            language: 'all',
            country: 'all',
            time: 'all'
        }
    };
    
    // 快取搜索結果
    let cachedResults = [];
    let filteredResults = [];
    
    // DOM 元素
    const elements = {
        // 表單元素
        searchForm: document.getElementById('search-form'),
        keywordInput: document.getElementById('keyword'),
        searchBtn: document.getElementById('search-btn'),
        clearInputBtn: document.getElementById('clear-input'),
        
        // 搜尋類型選項
        searchTypeOptions: document.querySelectorAll('input[name="search_type"]'),
        
        // 結果展示區
        resultsPlaceholder: document.getElementById('results-placeholder'),
        resultsContent: document.getElementById('results-content'),
        noResults: document.getElementById('no-results'),
        loading: document.getElementById('loading'),
        
        // 統計和篩選
        searchStats: document.getElementById('search-stats'),
        searchKeyword: document.getElementById('search-keyword'),
        resultCount: document.getElementById('result-count'),
        searchModeIndicator: document.getElementById('search-mode-indicator'),
        filterOptions: document.getElementById('filter-options'),
        
        // 分頁控制
        paginationContainer: document.getElementById('paginationContainer'),
        pageStart: document.getElementById('pageStart'),
        pageEnd: document.getElementById('pageEnd'),
        totalResults: document.getElementById('totalResults'),
        currentPage: document.getElementById('currentPage'),
        totalPages: document.getElementById('totalPages'),
        prevPageBtn: document.getElementById('prevPage'),
        nextPageBtn: document.getElementById('nextPage'),
        
        // 趨勢話題
        trendingTopics: document.getElementById('trending-topics'),
        
        // 系統狀態
        systemStatus: document.getElementById('system-status'),
        currentDate: document.getElementById('current-date'),
        
        // 快速搜尋按鈕
        quickSearchBtns: document.querySelectorAll('.quick-search-btn')
    };
    
    // 設置當前日期
    function updateCurrentDate() {
        const now = new Date();
        const options = { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric', 
            weekday: 'long',
            hour: '2-digit',
            minute: '2-digit'
        };
        if (elements.currentDate) {
            elements.currentDate.textContent = now.toLocaleDateString('zh-TW', options);
        }
    }
    
    // 初始化頁面
    function initializePage() {
        // 更新當前日期
        updateCurrentDate();
        
        // 載入熱門話題
        fetchTrendingTopics();
        
        // 檢查搜索服務狀態
        checkServiceStatus();
        
        // 設置事件監聽器
        setupEventListeners();
    }
    
    // 設置所有事件監聽器
    function setupEventListeners() {
        // 搜索表單提交
        if (elements.searchForm) {
            elements.searchForm.addEventListener('submit', handleSearch);
        }
        
        // 輸入框清空按鈕
        if (elements.keywordInput && elements.clearInputBtn) {
            elements.keywordInput.addEventListener('input', function() {
                elements.clearInputBtn.style.display = this.value ? 'block' : 'none';
            });
            
            elements.clearInputBtn.addEventListener('click', function() {
                elements.keywordInput.value = '';
                elements.clearInputBtn.style.display = 'none';
                elements.keywordInput.focus();
            });
        }
        
        // 分頁按鈕
        if (elements.prevPageBtn) {
            elements.prevPageBtn.addEventListener('click', goToPreviousPage);
        }
        
        if (elements.nextPageBtn) {
            elements.nextPageBtn.addEventListener('click', goToNextPage);
        }
        
        // 篩選按鈕
        setupFilterButtons();
        
        // 快速搜尋按鈕
        if (elements.quickSearchBtns) {
            elements.quickSearchBtns.forEach(btn => {
                btn.addEventListener('click', function() {
                    const keyword = this.getAttribute('data-keyword');
                    if (keyword && elements.keywordInput) {
                        elements.keywordInput.value = keyword;
                        // 觸發表單提交
                        if (elements.searchForm) {
                            elements.searchForm.dispatchEvent(new Event('submit'));
                        }
                    }
                });
            });
        }
    }
    
    // 設置篩選按鈕事件監聽
    function setupFilterButtons() {
        const filterGroups = {
            language: document.getElementById('language-filter'),
            country: document.getElementById('country-filter'),
            time: document.getElementById('time-filter')
        };
        
        // 為每個篩選組添加事件監聽
        for (const [filterType, filterGroup] of Object.entries(filterGroups)) {
            if (filterGroup) {
                const buttons = filterGroup.querySelectorAll('.filter-btn');
                buttons.forEach(button => {
                    button.addEventListener('click', function() {
                        // 移除同組中所有按鈕的活動狀態
                        buttons.forEach(btn => btn.classList.remove('active'));
                        
                        // 添加當前按鈕的活動狀態
                        this.classList.add('active');
                        
                        // 更新篩選條件
                        const filterValue = this.getAttribute('data-filter');
                        config.filters[filterType] = filterValue;
                        
                        // 應用篩選並更新顯示
                        applyFilters();
                    });
                });
            }
        }
    }
    
    // 獲取熱門話題
    async function fetchTrendingTopics() {
        if (!elements.trendingTopics) return;
        
        try {
            const response = await fetch('/trending');
            if (!response.ok) {
                throw new Error('無法獲取熱門話題');
            }
            
            const data = await response.json();
            
            if (data.success && data.trending && data.trending.length > 0) {
                // 清空載入中的內容
                elements.trendingTopics.innerHTML = '';
                
                // 創建並添加話題標籤
                data.trending.forEach(item => {
                    const topicTag = document.createElement('div');
                    topicTag.className = 'trending-tag';
                    topicTag.innerHTML = `
                        <a href="#" class="trending-link" data-keyword="${item.topic}">
                            <i class="fas fa-chart-line"></i>
                            <span>${item.topic}</span>
                        </a>
                    `;
                    elements.trendingTopics.appendChild(topicTag);
                    
                    // 添加點擊事件
                    topicTag.querySelector('.trending-link').addEventListener('click', function(e) {
                        e.preventDefault();
                        const keyword = this.getAttribute('data-keyword');
                        if (keyword && elements.keywordInput) {
                            elements.keywordInput.value = keyword;
                            // 觸發表單提交
                            if (elements.searchForm) {
                                elements.searchForm.dispatchEvent(new Event('submit'));
                            }
                        }
                    });
                });
            } else {
                elements.trendingTopics.innerHTML = '<p>暫無熱門話題</p>';
            }
        } catch (error) {
            console.error('獲取熱門話題失敗:', error);
            elements.trendingTopics.innerHTML = '<p>無法載入熱門話題</p>';
        }
    }
    
    // 檢查搜索服務狀態
    async function checkServiceStatus() {
        const statusIndicator = document.querySelector('.status-badge');
        if (!statusIndicator) return;
        
        try {
            const response = await fetch('/search-service-status');
            if (!response.ok) {
                throw new Error('無法獲取服務狀態');
            }
            
            const data = await response.json();
            
            if (data.status === 'online') {
                statusIndicator.className = 'status-badge online';
                statusIndicator.innerHTML = '<i class="fas fa-circle"></i> 系統運行中';
            } else if (data.status === 'starting') {
                statusIndicator.className = 'status-badge starting';
                statusIndicator.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> 系統啟動中';
            } else {
                statusIndicator.className = 'status-badge offline';
                statusIndicator.innerHTML = '<i class="fas fa-circle"></i> 系統離線中';
            }
        } catch (error) {
            console.error('檢查服務狀態失敗:', error);
            statusIndicator.className = 'status-badge error';
            statusIndicator.innerHTML = '<i class="fas fa-exclamation-circle"></i> 狀態檢查失敗';
        }
    }
    
    // 處理搜索提交
    async function handleSearch(event) {
        event.preventDefault();
        
        // 獲取關鍵詞和搜索類型
        const keyword = elements.keywordInput.value.trim();
        
        if (!keyword) {
            alert('請輸入搜尋關鍵字');
            return;
        }
        
        // 獲取選中的搜索類型
        const searchType = document.querySelector('input[name="search_type"]:checked').value;
        
        // 重置頁碼（如果是新的搜索關鍵詞）
        if (keyword !== config.lastKeyword) {
            config.currentPage = 1;
            config.lastKeyword = keyword;
        }
        
        // 顯示載入中
        showLoading();
        
        // 隱藏歡迎頁面內容
        if (elements.resultsPlaceholder) {
            elements.resultsPlaceholder.style.display = 'none';
        }
        
        try {
            // 發送搜索請求
            const response = await fetch('/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    keyword: keyword,
                    search_type: searchType,
                    page: config.currentPage,
                    per_page: config.pageSize
                })
            });
            
            if (!response.ok) {
                throw new Error('搜索請求失敗');
            }
            
            const data = await response.json();
            
            // 隱藏載入中
            hideLoading();
            
            if (data.success) {
                // 更新搜索統計
                updateSearchStats(keyword, data.total_results, searchType);
                
                // 儲存結果和更新分頁信息
                cachedResults = data.results || [];
                filteredResults = [...cachedResults];
                
                // 更新分頁參數
                config.totalPages = data.total_pages || 1;
                config.currentPage = data.page || 1;
                
                // 顯示篩選選項（僅當有結果且是全球搜索時）
                if (elements.filterOptions) {
                    elements.filterOptions.style.display = (cachedResults.length > 0 && (searchType === 'global' || searchType === 'all')) ? 'block' : 'none';
                }
                
                // 處理搜索結果
                if (cachedResults.length > 0) {
                    // 顯示結果
                    displayResults();
                    
                    // 更新分頁控制
                    updatePagination(data.total_results, data.page, data.total_pages);
                } else {
                    // 顯示無結果
                    showNoResults();
                }
            } else {
                console.error('搜索失敗:', data.error);
                showErrorMessage(data.error || '搜索處理時出錯');
            }
        } catch (error) {
            console.error('搜索錯誤:', error);
            hideLoading();
            showErrorMessage(error.message);
        }
    }
    
    // 顯示載入中
    function showLoading() {
        if (elements.loading) {
            elements.loading.style.display = 'flex';
        }
        
        if (elements.noResults) {
            elements.noResults.style.display = 'none';
        }
        
        if (elements.resultsContent) {
            elements.resultsContent.innerHTML = '';
        }
    }
    
    // 隱藏載入中
    function hideLoading() {
        if (elements.loading) {
            elements.loading.style.display = 'none';
        }
    }
    
    // 顯示無結果
    function showNoResults() {
        if (elements.noResults) {
            elements.noResults.style.display = 'block';
        }
        
        if (elements.resultsContent) {
            elements.resultsContent.innerHTML = '';
        }
        
        if (elements.paginationContainer) {
            elements.paginationContainer.style.display = 'none';
        }
    }
    
    // 顯示錯誤消息
    function showErrorMessage(message) {
        if (elements.resultsContent) {
            elements.resultsContent.innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>搜尋時發生錯誤：${message}</p>
                </div>
            `;
        }
        
        if (elements.noResults) {
            elements.noResults.style.display = 'none';
        }
        
        if (elements.paginationContainer) {
            elements.paginationContainer.style.display = 'none';
        }
    }
    
    // 更新搜索統計信息
    function updateSearchStats(keyword, totalResults, searchType) {
        if (elements.searchStats) {
            elements.searchStats.style.display = 'flex';
        }
        
        if (elements.searchKeyword) {
            elements.searchKeyword.textContent = keyword;
        }
        
        if (elements.resultCount) {
            elements.resultCount.textContent = totalResults || 0;
        }
        
        // 更新搜索模式指示器
        if (elements.searchModeIndicator) {
            let modeText = '';
            let modeIcon = '';
            
            switch (searchType) {
                case 'local':
                    modeText = '台灣新聞';
                    modeIcon = 'fa-map-marker-alt';
                    break;
                case 'global':
                    modeText = '全球新聞';
                    modeIcon = 'fa-globe';
                    break;
                case 'all':
                    modeText = '所有來源';
                    modeIcon = 'fa-th-large';
                    break;
            }
            
            elements.searchModeIndicator.innerHTML = `<i class="fas ${modeIcon}"></i> ${modeText}`;
        }
    }
    
    // 顯示搜索結果
    function displayResults() {
        if (!elements.resultsContent) return;
        
        // 清空結果區域
        elements.resultsContent.innerHTML = '';
        
        // 根據篩選條件過濾結果
        const displayResults = applyFilters();
        
        if (displayResults.length === 0) {
            elements.resultsContent.innerHTML = `
                <div class="no-filter-results">
                    <i class="fas fa-filter"></i>
                    <p>沒有符合篩選條件的結果</p>
                    <button id="resetFilters" class="reset-filters-btn">重置篩選器</button>
                </div>
            `;
            
            // 添加重置篩選器按鈕的事件監聽
            document.getElementById('resetFilters').addEventListener('click', resetFilters);
            return;
        }
        
        // 創建結果容器
        const resultsContainer = document.createElement('div');
        resultsContainer.className = 'search-results';
        
        // 依據新聞源分組
        const newsBySource = groupNewsBySource(displayResults);
        
        // 為每個新聞源創建一個區塊
        for (const [source, newsItems] of Object.entries(newsBySource)) {
            const sourceSection = document.createElement('div');
            sourceSection.className = 'news-source-section';
            
            // 創建標題
            const sectionTitle = document.createElement('h2');
            sectionTitle.className = 'source-title';
            sectionTitle.textContent = source;
            sourceSection.appendChild(sectionTitle);
            
            // 添加新聞卡片
            const newsCards = document.createElement('div');
            newsCards.className = 'news-cards';
            
            newsItems.forEach(news => {
                const card = createNewsCard(news);
                newsCards.appendChild(card);
            });
            
            sourceSection.appendChild(newsCards);
            resultsContainer.appendChild(sourceSection);
        }
        
        // 添加結果到頁面
        elements.resultsContent.appendChild(resultsContainer);
    }
    
    // 按新聞源分組新聞
    function groupNewsBySource(newsItems) {
        const groupedNews = {};
        
        newsItems.forEach(news => {
            const source = news.source || '未知來源';
            
            if (!groupedNews[source]) {
                groupedNews[source] = [];
            }
            
            groupedNews[source].push(news);
        });
        
        return groupedNews;
    }
    
    // 創建新聞卡片
    function createNewsCard(news) {
        const card = document.createElement('div');
        card.className = 'news-card';
        
        // 設置國家標籤的樣式類
        const countryClass = getCountryClass(news.country);
        
        // 構建卡片HTML
        card.innerHTML = `
            <div class="news-image">
                ${news.image_url 
                    ? `<img src="${news.image_url}" alt="${news.title}" loading="lazy">` 
                    : '<div class="news-no-image"><i class="far fa-image"></i></div>'
                }
            </div>
            <div class="news-content">
                <div class="news-source-container">
                    <span class="news-source ${countryClass}">${news.source || '未知來源'}</span>
                    ${news.country ? `<span class="news-country">${news.country}</span>` : ''}
                    ${news.language ? `<span class="news-language"><i class="fas fa-language"></i> ${formatLanguage(news.language)}</span>` : ''}
                </div>
                <h3 class="news-title"><a href="${news.link}" target="_blank" rel="noopener noreferrer">${news.title}</a></h3>
                ${news.snippet ? `<div class="news-snippet">${news.snippet}</div>` : ''}
                <div class="news-date">
                    <i class="far fa-clock"></i> ${formatDate(news.date)}
                </div>
            </div>
        `;
        
        return card;
    }
    
    // 獲取國家對應的樣式類
    function getCountryClass(country) {
        if (!country) return '';
        
        const countryMap = {
            '台灣': 'tw',
            '美國': 'us',
            '英國': 'uk',
            '日本': 'jp',
            '韓國': 'kr',
            '中國': 'cn',
            '澳洲': 'au',
            '法國': 'fr',
            '卡達': 'qa'
        };
        
        return countryMap[country] || 'global';
    }
    
    // 格式化語言顯示
    function formatLanguage(langCode) {
        const langMap = {
            'zh-TW': '中文(台灣)',
            'zh-CN': '中文(簡體)',
            'zh-HK': '中文(香港)',
            'en-US': '英文(美國)',
            'en-GB': '英文(英國)',
            'ja-JP': '日文',
            'ko-KR': '韓文',
            'fr-FR': '法文',
            'de-DE': '德文',
            'ru-RU': '俄文',
            'es-ES': '西班牙文',
            'it-IT': '義大利文',
            'pt-BR': '葡萄牙文'
        };
        
        return langMap[langCode] || langCode;
    }
    
    // 應用篩選條件並返回過濾後的結果
    function applyFilters() {
        if (!cachedResults || cachedResults.length === 0) {
            return [];
        }
        
        // 應用所有篩選條件
        filteredResults = cachedResults.filter(news => {
            // 語言篩選
            if (config.filters.language !== 'all' && news.language !== config.filters.language) {
                return false;
            }
            
            // 國家篩選
            if (config.filters.country !== 'all') {
                if (config.filters.country === '其他') {
                    // 檢查是否屬於其他國家（不在主要國家列表中）
                    const majorCountries = ['台灣', '美國', '日本', '英國', '中國'];
                    if (majorCountries.includes(news.country)) {
                        return false;
                    }
                } else if (news.country !== config.filters.country) {
                    return false;
                }
            }
            
            // 時間篩選
            if (config.filters.time !== 'all' && news.date) {
                const newsDate = new Date(news.date);
                const now = new Date();
                
                // 如果日期無效，不過濾
                if (isNaN(newsDate.getTime())) {
                    return true;
                }
                
                // 根據時間篩選
                switch (config.filters.time) {
                    case 'today':
                        // 今天的新聞（24小時內）
                        return (now - newsDate) <= 24 * 60 * 60 * 1000;
                    case 'week':
                        // 本週的新聞（7天內）
                        return (now - newsDate) <= 7 * 24 * 60 * 60 * 1000;
                    case 'month':
                        // 本月的新聞（30天內）
                        return (now - newsDate) <= 30 * 24 * 60 * 60 * 1000;
                }
            }
            
            return true;
        });
        
        // 更新顯示
        displayFilteredResults();
        
        return filteredResults;
    }
    
    // 顯示過濾後的結果
    function displayFilteredResults() {
        // 這個函數現在只是更新計數，實際顯示由 displayResults 處理
        if (elements.resultCount) {
            elements.resultCount.textContent = filteredResults.length;
        }
    }
    
    // 重置所有篩選器
    function resetFilters() {
        // 重置篩選條件
        config.filters = {
            language: 'all',
            country: 'all',
            time: 'all'
        };
        
        // 重置按鈕UI狀態
        const filterButtons = document.querySelectorAll('.filter-btn');
        filterButtons.forEach(btn => {
            const isAllButton = btn.getAttribute('data-filter') === 'all';
            btn.classList.toggle('active', isAllButton);
        });
        
        // 重新應用篩選器並顯示結果
        displayResults();
    }
    
    // 更新分頁控制
    function updatePagination(totalResults, currentPage, totalPages) {
        if (!elements.paginationContainer) return;
        
        // 顯示分頁控制
        elements.paginationContainer.style.display = 'flex';
        
        // 更新分頁信息
        const total = totalResults || 0;
        const start = (currentPage - 1) * config.pageSize + 1;
        const end = Math.min(currentPage * config.pageSize, total);
        
        if (elements.pageStart) elements.pageStart.textContent = total > 0 ? start : 0;
        if (elements.pageEnd) elements.pageEnd.textContent = end;
        if (elements.totalResults) elements.totalResults.textContent = total;
        if (elements.currentPage) elements.currentPage.textContent = currentPage;
        if (elements.totalPages) elements.totalPages.textContent = totalPages;
        
        // 更新分頁按鈕狀態
        if (elements.prevPageBtn) {
            elements.prevPageBtn.disabled = currentPage <= 1;
        }
        
        if (elements.nextPageBtn) {
            elements.nextPageBtn.disabled = currentPage >= totalPages;
        }
    }
    
    // 前往上一頁
    async function goToPreviousPage() {
        if (config.currentPage <= 1) return;
        
        config.currentPage--;
        await performSearch(config.lastKeyword, config.currentPage);
    }
    
    // 前往下一頁
    async function goToNextPage() {
        if (config.currentPage >= config.totalPages) return;
        
        const shouldContinue = confirm('要查看下一頁結果嗎？');
        if (shouldContinue) {
            config.currentPage++;
            await performSearch(config.lastKeyword, config.currentPage);
        }
    }
    
    // 執行搜索的通用函數
    async function performSearch(keyword, page = 1) {
        if (!keyword) return;
        
        const searchType = document.querySelector('input[name="search_type"]:checked').value;
        
        // 顯示載入中
        showLoading();
        
        try {
            const response = await fetch('/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    keyword: keyword,
                    search_type: searchType,
                    page: page,
                    per_page: config.pageSize
                })
            });
            
            if (!response.ok) {
                throw new Error('搜索請求失敗');
            }
            
            const data = await response.json();
            
            // 隱藏載入中
            hideLoading();
            
            if (data.success) {
                // 更新搜索統計
                updateSearchStats(keyword, data.total_results, searchType);
                
                // 儲存結果和更新分頁信息
                cachedResults = data.results || [];
                filteredResults = [...cachedResults];
                
                // 更新分頁參數
                config.totalPages = data.total_pages || 1;
                config.currentPage = data.page || 1;
                
                // 顯示篩選選項（僅當有結果且是全球搜索時）
                if (elements.filterOptions) {
                    elements.filterOptions.style.display = (cachedResults.length > 0 && (searchType === 'global' || searchType === 'all')) ? 'block' : 'none';
                }
                
                // An automatic scroll to search stats
                if (elements.searchStats) {
                    window.scrollTo({
                        top: elements.searchStats.offsetTop - 20,
                        behavior: 'smooth'
                    });
                }
                
                // 處理搜索結果
                if (cachedResults.length > 0) {
                    // 顯示結果
                    displayResults();
                    
                    // 更新分頁控制
                    updatePagination(data.total_results, data.page, data.total_pages);
                } else {
                    // 顯示無結果
                    showNoResults();
                }
            } else {
                console.error('搜索失敗:', data.error);
                showErrorMessage(data.error || '搜索處理時出錯');
            }
        } catch (error) {
            console.error('搜索錯誤:', error);
            hideLoading();
            showErrorMessage(error.message);
        }
    }
    
    // 格式化日期
    function formatDate(dateString) {
        if (!dateString) return '未知日期';
        
        try {
            const date = new Date(dateString);
            
            // 檢查日期是否有效
            if (isNaN(date.getTime())) {
                return dateString; // 返回原始字符串
            }
            
            // 計算相對時間
            const now = new Date();
            const diff = now - date;
            
            // 一小時內
            if (diff < 60 * 60 * 1000) {
                const minutes = Math.floor(diff / (60 * 1000));
                return `${minutes} 分鐘前`;
            }
            
            // 一天內
            if (diff < 24 * 60 * 60 * 1000) {
                const hours = Math.floor(diff / (60 * 60 * 1000));
                return `${hours} 小時前`;
            }
            
            // 一週內
            if (diff < 7 * 24 * 60 * 60 * 1000) {
                const days = Math.floor(diff / (24 * 60 * 60 * 1000));
                return `${days} 天前`;
            }
            
            // 超過一週，顯示完整日期
            return date.toLocaleDateString('zh-TW', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch (e) {
            return dateString; // 出錯時返回原始字符串
        }
    }
    
    // 初始化頁面
    initializePage();
});
