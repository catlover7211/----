from flask import Flask, request, jsonify, render_template
import requests
import json

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/search', methods=['POST'])
def search():
    data = request.json
    query = data.get('query', 'Nike')
    limit = data.get('limit', '10')
    
    url = "https://google-search74.p.rapidapi.com/"
    
    querystring = {"query": query, "limit": limit, "related_keywords":"true"}
    
    headers = {
        "x-rapidapi-key": "f93d6a4a26msh3bcff115e89c615p1b84efjsn9bf7711a6ffb",
        "x-rapidapi-host": "google-search74.p.rapidapi.com"
    }
    
    try:
        response = requests.get(url, headers=headers, params=querystring)
        return jsonify(response.json())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)