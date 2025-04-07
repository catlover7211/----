import requests
url = ('https://newsapi.org/v2/everything?q=taiwan&apiKey=2110528690ec40658a6437f045a76755')
response = requests.get(url)
print(response.json())