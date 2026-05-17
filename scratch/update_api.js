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
  'calculator.html',
  'data-schema.html'
];

htmlFiles.forEach(file => {
  const filePath = path.join(rootDir, file);
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // insert API link right after 数据说明 in footer
    const dataSchemaLink = '<a href="/data-schema">数据说明</a> ·';
    const dataSchemaReplacement = '<a href="/data-schema">数据说明</a> ·\n        <a href="/api">API</a> ·';

    if (content.includes(dataSchemaLink)) {
      if (!content.includes('<a href="/api">API</a>')) {
        content = content.replace(dataSchemaLink, dataSchemaReplacement);
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated footer in ${file}`);
      }
    } else {
      console.log(`dataSchemaLink not found in ${file}`);
    }
  }
});

// Update README.md
const readmePath = path.join(rootDir, 'README.md');
if (fs.existsSync(readmePath)) {
  let content = fs.readFileSync(readmePath, 'utf8');
  
  // Add /api to Sitemap
  if (content.includes('- `/data-schema`') && !content.includes('- `/api`')) {
    content = content.replace('- `/data-schema`', '- `/data-schema`\n- `/api`');
  }

  // Add api.html to tree
  const treeTarget = '|-- data-schema.html               # 数据说明页，解释数据结构与字段含义';
  if (content.includes(treeTarget) && !content.includes('api.html')) {
    content = content.replace(treeTarget, treeTarget + '\n|-- api.html                       # 静态 JSON API 文档页');
  }

  // Add api.html to public build lists
  const publicList1 = '`data-schema.html`、`robots.txt`';
  if (content.includes(publicList1) && !content.includes('`api.html`')) {
    content = content.replace(publicList1, '`data-schema.html`、`api.html`、`robots.txt`');
  }

  const publicList2 = '`public/data-schema/index.html`';
  if (content.includes(publicList2) && !content.includes('`public/api/index.html`')) {
    content = content.replace(publicList2, '`public/data-schema/index.html`、`public/api/index.html`');
  }

  fs.writeFileSync(readmePath, content, 'utf8');
  console.log('Updated README.md');
}
