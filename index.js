const searchEngineTool = require('search-engine-tool');
//import searchEngineTool from "search-engine-tool" // module

const query = '深圳市天气';
const engine = 'bing';

searchEngineTool(query, engine)
  .then(results => {
    console.log('搜索结果:');
    results.forEach(result => {
      console.log('标题:', result.title);
      console.log('链接:', result.href);
      console.log('摘要:', result.abstract);
      console.log('----------------------');
    });
  })
  .catch(error => {
    console.error('发生错误:', error);
  });
