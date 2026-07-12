const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const SITEMAP_PATH = path.join(PUBLIC_DIR, 'sitemap.xml');

function logErrorAndExit(msg) {
  console.error('\x1b[31m%s\x1b[0m', `[sitemap-check] ERROR: ${msg}`);
  process.exit(1);
}

function checkSitemap() {
  console.log('[sitemap-check] Starting verification...');

  if (!fs.existsSync(SITEMAP_PATH)) {
    logErrorAndExit(`Sitemap file does not exist at path: ${SITEMAP_PATH}`);
  }

  const sitemapContent = fs.readFileSync(SITEMAP_PATH, 'utf8');
  
  // Extract all <loc> content
  const locRegex = /<loc>([\s\S]*?)<\/loc>/g;
  const urls = [];
  let match;
  while ((match = locRegex.exec(sitemapContent)) !== null) {
    urls.push(match[1].trim());
  }

  console.log(`[sitemap-check] Found ${urls.length} URLs in sitemap.`);

  if (urls.length === 0) {
    logErrorAndExit('Sitemap contains zero URLs!');
  }

  const seenUrls = new Set();

  urls.forEach(url => {
    // 1. Repeat check
    if (seenUrls.has(url)) {
      logErrorAndExit(`Duplicate URL found in sitemap: ${url}`);
    }
    seenUrls.add(url);

    // 2. Data block / JSON check
    if (url.endsWith('.json') || url.includes('/data/')) {
      logErrorAndExit(`Forbidden data asset/JSON url found in sitemap: ${url}`);
    }

    // 3. Illegal placeholder check
    if (url.includes('${') || url.includes('undefined') || url.includes('null') || url.includes('#')) {
      logErrorAndExit(`Illegal character or template literal leakage found in sitemap URL: ${url}`);
    }

    // 4. Resolve local file mapping
    let relativePath = url.replace(/^https?:\/\/modelradar\.cn/, '');
    
    // Normalize path
    let localFilePath;
    if (relativePath === '' || relativePath === '/') {
      localFilePath = path.join(PUBLIC_DIR, 'index.html');
    } else {
      // Remove leading and trailing slash
      const cleanPath = relativePath.replace(/^\/+/, '').replace(/\/+$/, '');
      localFilePath = path.join(PUBLIC_DIR, cleanPath, 'index.html');
    }

    // 5. File existence check
    if (!fs.existsSync(localFilePath)) {
      logErrorAndExit(`Sitemap URL '${url}' maps to '${localFilePath}', but the file does not exist!`);
    }

    // 6. Canonical matching check
    const htmlContent = fs.readFileSync(localFilePath, 'utf8');
    const canonicalMatch = htmlContent.match(/<link\s+rel=["']canonical["']\s+href=["']([\s\S]*?)["']/i) ||
                           htmlContent.match(/<link\s+href=["']([\s\S]*?)["']\s+rel=["']canonical["']/i);
    
    if (!canonicalMatch) {
      logErrorAndExit(`HTML file '${localFilePath}' (URL: ${url}) is missing a canonical link tag!`);
    }

    const canonicalUrl = canonicalMatch[1].trim();
    if (canonicalUrl !== url) {
      logErrorAndExit(`Canonical mismatch in '${localFilePath}'. sitemap loc: '${url}', canonical tag: '${canonicalUrl}'`);
    }
  });

  console.log('\x1b[32m%s\x1b[0m', `[sitemap-check] PASS: All ${urls.length} URLs verified successfully! No duplicates, leaks, 404s, or canonical mismatches.`);
}

try {
  checkSitemap();
} catch (err) {
  logErrorAndExit(`Unexpected execution error: ${err.message}`);
}
