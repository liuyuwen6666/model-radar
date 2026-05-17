const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');

const htmlFiles = [
  'index.html',
  'model.html',
  'compare.html',
  'history.html',
  'rankings.html',
  'provider.html',
  'calculator.html'
];

htmlFiles.forEach(file => {
  const filePath = path.join(rootDir, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // First, let's remove any previously incorrectly added 数据说明 from my previous script (though it might have only been in some)
    content = content.replace('<a href="/data-schema">数据说明</a> ·\n', '');
    content = content.replace('<a href="/data-schema">数据说明</a> ·\r\n', '');
    content = content.replace('<a href="/data-schema">数据说明</a> ·', '');

    // Now insert it right before sitemap.xml in footer
    const sitemapLink = '<a href="/sitemap.xml">站点地图</a>';
    const sitemapReplacement = '<a href="/data-schema">数据说明</a> ·\n        <a href="/sitemap.xml">站点地图</a>';

    if (content.includes(sitemapLink)) {
      content = content.replace(sitemapLink, sitemapReplacement);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated footer in ${file}`);
    } else {
      console.log(`sitemapLink not found in ${file}`);
    }
  }
});
