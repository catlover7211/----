from flask import Flask, render_template, request
import requests

app = Flask(__name__)

@app.route('/')
def index():
    # 不再預設搜尋任何內容，初始頁面不展示新聞
    return render_template('index.html', news_data={"articles": [], "totalResults": 0, "status": "ok"})

@app.route('/search', methods=['GET'])
def search():
    query = request.args.get('q', '')
    if not query:
        return render_template('index.html', news_data={"articles": [], "totalResults": 0, "status": "ok"})
    
    url = f'https://newsapi.org/v2/everything?q={query}&apiKey=2110528690ec40658a6437f045a76755'
    response = requests.get(url)
    news_data = response.json()
    return render_template('index.html', news_data=news_data, search_query=query)

if __name__ == '__main__':
    app.run(debug=True,host= "0.0.0.0", port=4000)