const fs = require("node:fs/promises");
const path = require("node:path");
const cheerio = require("cheerio");

const ROOT_DIR = path.resolve(__dirname, "..");
const LOG_DIR = path.join(ROOT_DIR, "log");

class FileLogger {
  constructor(year, month, day) {
    this.year = year;
    this.month = month;
    this.day = day;
    this.logFileName = `${year}-${month}-${day}.log`;
    this.logPath = path.join(LOG_DIR, this.logFileName);
    this.logs = [];
  }

  async init() {
    await fs.mkdir(LOG_DIR, { recursive: true });
  }

  log(msg, ...args) {
    const formattedMsg = [msg, ...args].join(" ");
    console.log(formattedMsg);
    this.logs.push(`[${new Date().toISOString()}] [INFO] ${formattedMsg}`);
  }

  warn(msg, ...args) {
    const formattedMsg = [msg, ...args].join(" ");
    console.warn(formattedMsg);
    this.logs.push(`[${new Date().toISOString()}] [WARN] ${formattedMsg}`);
  }

  error(msg, ...args) {
    const formattedMsg = [msg, ...args].join(" ");
    console.error(formattedMsg);
    this.logs.push(`[${new Date().toISOString()}] [ERROR] ${formattedMsg}`);
  }

  async flush() {
    try {
      if (this.logs.length === 0) return;
      const content = this.logs.join("\n") + "\n";
      await fs.appendFile(this.logPath, content, "utf8");
      this.logs = [];
    } catch (err) {
      console.error(`[save-raw] 无法写入日志文件: ${err.message}`);
    }
  }
}

// 全局 Logger 实例
let logger = null;

// 安全解析数组字面量的辅助函数
function safeEvalArray(str) {
  try {
    const fn = new Function(`return ${str};`);
    return fn();
  } catch (e) {
    return null;
  }
}

// 原始 HTML 存储的根目录：直接存放在项目根目录下的 raw 目录中
const RAW_DIR = path.join(ROOT_DIR, "raw");

// 支持的抓取目标配置表，后续追加别的抓取目标时只需在此添加即可
const TARGETS = [
  {
    provider: "openai",
    url: "https://developers.openai.com/api/docs/pricing",
    selector: "#mainContent"
  },
  {
    provider: "anthropic",
    url: "https://claude.com/pricing",
    selector: ".tab_panel.u-column-full"
  },
  {
    provider: "google",
    url: "https://ai.google.dev/gemini-api/docs/pricing?hl=zh-cn",
    selector: "article.devsite-article",
    headers: {
      "user-agent": "Mozilla/5.0"
    }
  },
  {
    provider: "deepseek_zh",
    url: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
    selector: "article"
  },
  {
    provider: "deepseek_en",
    url: "https://api-docs.deepseek.com/quick_start/pricing/",
    selector: "article"
  },
  {
    provider: "moonshot",
    url: "https://platform.kimi.com/docs/pricing/chat",
    selector: "#content-area"
  },
  {
    provider: "alibailian",
    url: "https://help.aliyun.com/zh/model-studio/model-pricing",
    selector: "main#main-3168565"
  },
  {
    provider: "volcengine",
    url: "https://www.volcengine.com/docs/82379/1544106?lang=zh",
    selector: "#doc-viewer-container"
  },
  {
    provider: "hunyuan",
    url: "https://cloud.tencent.com/document/product/1729/97731",
    selector: "#docArticleContent"
  }
];

// 获取用于建档的年、月目录名称
function getDirDate() {
  // 与 update.js 保持一致，支持使用 MODEL_RADAR_DATE 环境变量作为指定时间，默认使用当前系统时间
  const rawDate = process.env.MODEL_RADAR_DATE;
  let date = new Date();
  
  if (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    date = new Date(rawDate);
  }
  
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return { year, month, day };
}

async function fetchAndSave(target, year, month, day) {
  const { provider, url, selector, headers: customHeaders } = target;
  const filename = `${day}.html`;
  logger.log(`[save-raw] 开始抓取 ${provider} 原始 HTML 页面: ${url}`);
  
  try {
    const fetchHeaders = customHeaders || {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
    };

    if (provider === "moonshot") {
      // 1. 获取主页面的 HTML 以便提取侧边栏定价链接
      const response = await fetch(url, {
        headers: fetchHeaders
      });

      if (!response.ok) {
        throw new Error(`主页请求失败，HTTP 状态码: ${response.status}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      
      const baseUrl = new URL(url).origin;
      const links = [];
      
      $("#sidebar-content a").each((i, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        
        const absUrl = new URL(href, baseUrl).href;
        
        // 排除常见问题链接
        if (absUrl.includes("/pricing/faq")) {
          return;
        }
        
        if (!links.includes(absUrl)) {
          links.push(absUrl);
        }
      });

      if (links.length === 0) {
        throw new Error("在 Kimi 定价主页中未找到任何有效的定价子链接！");
      }

      logger.log(`[save-raw] 发现 ${links.length} 个 Kimi 定价子页面，开始逐个抓取合并并提取真实价格...`);
      
      let combinedHtml = "";
      for (let i = 0; i < links.length; i++) {
        const subUrl = links[i];
        try {
          const subRes = await fetch(subUrl, {
            headers: fetchHeaders
          });
          if (!subRes.ok) {
            logger.warn(`[save-raw] [警告] 子页面抓取失败 ${subUrl}: HTTP ${subRes.status}`);
            continue;
          }
          const subHtml = await subRes.text();
          const sub$ = cheerio.load(subHtml);

          // ======== 智能动态价格解析与静态 HTML 表格重建逻辑 ========
          const nextFLines = [];
          sub$("script").each((sIdx, sEl) => {
            const scriptText = sub$(sEl).text();
            if (scriptText.includes("self.__next_f.push")) {
              nextFLines.push(scriptText);
            }
          });

          let fullPayload = "";
          for (const scriptText of nextFLines) {
            const regex = /self\.__next_f\.push\(\s*\[\s*\d+\s*,\s*"([\s\S]*?)"\s*\]\s*\)/g;
            let match;
            while ((match = regex.exec(scriptText)) !== null) {
              let chunk = match[1];
              try {
                const decoded = JSON.parse(`"${chunk}"`);
                fullPayload += decoded;
              } catch (e) {
                fullPayload += chunk;
              }
            }
          }

          // 匹配并提取所有 DocTable 数据
          const docTables = [];
          const seenTables = new Set();
          let searchIdx = 0;
          while (true) {
            const idx = fullPayload.indexOf("DocTable", searchIdx);
            if (idx === -1) break;

            const chunk = fullPayload.substring(idx, idx + 5000);
            const colMatch = chunk.match(/columns\s*:\s*(\[[\s\S]*?\])\s*,\s*rows/);
            const rowMatch = chunk.match(/rows\s*:\s*(\[[\s\S]*?\]\s*\])/) || chunk.match(/rows\s*:\s*(\[[\s\S]*?\])/);

            if (colMatch && rowMatch) {
              const cols = safeEvalArray(colMatch[1]);
              const rows = safeEvalArray(rowMatch[1]);
              if (cols && rows) {
                const fingerprint = JSON.stringify({ cols, rows });
                if (!seenTables.has(fingerprint)) {
                  seenTables.add(fingerprint);
                  docTables.push({ cols, rows });
                }
              }
            }
            searchIdx = idx + 8;
          }

          // 将解析出来的静态表格还原插回 DOM
          const contentArea = sub$(selector);
          if (contentArea.length > 0 && docTables.length > 0) {
            docTables.forEach((table) => {
              let tableHtml = `
<div class="kimi-static-pricing-table" style="margin: 20px 0; overflow-x: auto; width: 100%;">
  <table class="kimi-pricing-table" style="width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; font-family: sans-serif; font-size: 14px; text-align: left;">
    <thead>
      <tr style="background-color: #f7fafc; border-bottom: 2px solid #edf2f7;">
              `;

              table.cols.forEach(col => {
                const widthStyle = col.width ? ` style="width: ${col.width}; padding: 12px; font-weight: bold; color: #4a5568;"` : ` style="padding: 12px; font-weight: bold; color: #4a5568;"`;
                tableHtml += `<th${widthStyle}>${col.title}</th>`;
              });

              tableHtml += `
      </tr>
    </thead>
    <tbody>
              `;

              table.rows.forEach((row, rowIndex) => {
                tableHtml += `<tr style="border-bottom: 1px solid #edf2f7; background-color: ${rowIndex % 2 === 0 ? '#ffffff' : '#fcfcfc'};">`;
                row.forEach(cell => {
                  tableHtml += `<td style="padding: 12px; color: #2d3748;">${cell}</td>`;
                });
                tableHtml += `</tr>`;
              });

              tableHtml += `
    </tbody>
  </table>
</div>
              `;

              // 寻找合适的 Heading 插入（比如“产品定价”或“模型说明”后面），如果没有，就追加在末尾
              const targetHeading = contentArea.find("h2, h3").filter((hIdx, hEl) => {
                const text = sub$(hEl).text();
                return text.includes("定价") || text.includes("价格") || text.includes("限速") || text.includes("费");
              });

              if (targetHeading.length > 0) {
                sub$(targetHeading[0]).after(tableHtml);
              } else {
                contentArea.append(tableHtml);
              }
            });
          }

          if (contentArea.length === 0) {
            logger.warn(`[save-raw] [警告] 页面 ${subUrl} 中未找到指定的选择器: "${selector}"`);
            continue;
          }
          
          const pageContent = sub$.html(contentArea);
          combinedHtml += `\n<!-- START OF PAGE: ${subUrl} -->\n<div class="moonshot-page-chunk" data-source-url="${subUrl}">\n${pageContent}\n</div>\n`;
        } catch (subErr) {
          logger.warn(`[save-raw] [警告] 抓取子页面 ${subUrl} 时发生异常: ${subErr.message}`);
        }
      }

      if (combinedHtml.length === 0) {
        throw new Error("所有 Kimi 定价子页面内容抓取均失败，无法生成合并文件！");
      }

      const content = `<div class="moonshot-combined-pricing">\n${combinedHtml}\n</div>`;

      // 建立结构化目录并写入文件
      const targetDir = path.join(RAW_DIR, provider, year, month);
      await fs.mkdir(targetDir, { recursive: true });

      const targetPath = path.join(targetDir, filename);
      await fs.writeFile(targetPath, content, "utf8");

      // 强校验文件是否真实存在且大小大于 0 字节
      let fileValid = false;
      try {
        const stats = await fs.stat(targetPath);
        if (stats.isFile() && stats.size > 0) {
          fileValid = true;
        }
      } catch (err) {
        fileValid = false;
      }
      if (!fileValid) {
        throw new Error(`归档写入的文件不存在或为空（大小为 0 字节）`);
      }

      logger.log(`[save-raw] 成功保存合并并恢复价格表格后的 ${provider} 原始 HTML 至: ${path.relative(ROOT_DIR, targetPath)}`);
    } else if (provider === "volcengine") {
      // 1. 抓取火山静态 HTML 并提取预加载状态中的 MDContent
      const response = await fetch(url, {
        headers: fetchHeaders
      });

      if (!response.ok) {
        throw new Error(`火山引擎页面请求失败，HTTP 状态码: ${response.status}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      
      let routerDataText = "";
      $("script").each((i, el) => {
        const text = $(el).text();
        if (text.includes("window._ROUTER_DATA =")) {
          routerDataText = text;
        }
      });

      if (!routerDataText) {
        throw new Error("在火山引擎静态页面中未找到 window._ROUTER_DATA 预加载数据！");
      }

      const startIdx = routerDataText.indexOf("window._ROUTER_DATA =");
      const jsonStr = routerDataText.substring(startIdx + "window._ROUTER_DATA =".length).trim().replace(/;$/, "");
      const data = JSON.parse(jsonStr);
      const pageData = data.loaderData["docs/(libid)/(docid$)/page"];
      
      if (!pageData || !pageData.curDoc || !pageData.curDoc.MDContent) {
        throw new Error("火山引擎预加载数据中未包含 curDoc.MDContent 内容！");
      }

      const title = pageData.curDoc.Title || "模型价格";
      const md = pageData.curDoc.MDContent;

      // 2. 将完美详实的 Markdown 解析为包含丰富美学排版表格的静态 HTML，包裹在 doc-viewer-container 中
      const renderedHtml = renderMarkdownToHtml(title, md);

      // 3. 建立结构化目录并写入文件
      const targetDir = path.join(RAW_DIR, provider, year, month);
      await fs.mkdir(targetDir, { recursive: true });

      const targetPath = path.join(targetDir, filename);
      await fs.writeFile(targetPath, renderedHtml, "utf8");

      // 强校验文件是否真实存在且大小大于 0 字节
      let fileValid = false;
      try {
        const stats = await fs.stat(targetPath);
        if (stats.isFile() && stats.size > 0) {
          fileValid = true;
        }
      } catch (err) {
        fileValid = false;
      }
      if (!fileValid) {
        throw new Error(`归档写入的文件不存在或为空（大小为 0 字节）`);
      }

      logger.log(`[save-raw] 成功解析并保存渲染后的火山 ${provider} 原始 HTML 至: ${path.relative(ROOT_DIR, targetPath)}`);
    } else {
      // 通用的单页面抓取
      const response = await fetch(url, {
        headers: fetchHeaders
      });

      if (!response.ok) {
        throw new Error(`请求失败，HTTP 状态码: ${response.status}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);
      const element = $(selector);

      if (element.length === 0) {
        throw new Error(`未能在页面中找到指定的选择器: "${selector}"`);
      }

      // 保留 mainContent 中的完整html内容（包括其自身的标签属性等）
      const content = $.html(element);

      // 建立结构化目录: data/raw/{provider}/{year}/{month}
      const targetDir = path.join(RAW_DIR, provider, year, month);
      await fs.mkdir(targetDir, { recursive: true });

      const targetPath = path.join(targetDir, filename);
      await fs.writeFile(targetPath, content, "utf8");

      // 强校验文件是否真实存在且大小大于 0 字节
      let fileValid = false;
      try {
        const stats = await fs.stat(targetPath);
        if (stats.isFile() && stats.size > 0) {
          fileValid = true;
        }
      } catch (err) {
        fileValid = false;
      }
      if (!fileValid) {
        throw new Error(`归档写入的文件不存在或为空（大小为 0 字节）`);
      }

      logger.log(`[save-raw] 成功保存 ${provider} 原始 HTML 至: ${path.relative(ROOT_DIR, targetPath)}`);
    }
  } catch (error) {
    // 遵守全局规范 6: 在进行接口请求处理 catch 异常时候，优先使用接口返回的信息字段 msg 或者 message
    const errMsg = error.message || error.msg || String(error);
    logger.error(`[save-raw] 抓取并保存 ${provider} 失败: ${errMsg}`);
    if (error.cause) {
      logger.error(`[save-raw] 底层原因 (cause): ${error.cause}`);
    }
    throw error;
  }
}

async function main() {
  const { year, month, day } = getDirDate();
  
  // 初始化全局 Logger，在 log 目录下创建对应的年-月-日.log
  logger = new FileLogger(year, month, day);
  await logger.init();

  // 支持通过命令行参数指定抓取的 provider，如：npm run save-raw openai
  const specificProvider = process.argv[2]?.toLowerCase();
  
  let targetsToFetch = TARGETS;
  if (specificProvider) {
    targetsToFetch = TARGETS.filter(t => t.provider === specificProvider);
    if (targetsToFetch.length === 0) {
      logger.warn(`[save-raw] 警告: 未找到匹配 provider 为 "${specificProvider}" 的配置目标。`);
      await logger.flush();
      process.exitCode = 1;
      return;
    }
  }

  logger.log(`[save-raw] 准备开始抓取原始 HTML，目标日期: ${year}-${month}-${day}`);
  
  let hasFailed = false;
  let successCount = 0;
  const totalCount = targetsToFetch.length;

  for (const target of targetsToFetch) {
    try {
      await fetchAndSave(target, year, month, day);
      successCount++;
    } catch (e) {
      hasFailed = true;
    }
    // 每次抓取完一个 provider 都实时刷新日志，防止异常退出导致日志丢失
    await logger.flush();
  }
  
  // 最终的统计输出与落盘记录
  logger.log(`\n========================================`);
  logger.log(`抓取统计总结：`);
  logger.log(`- 目标日期: ${year}-${month}-${day}`);
  logger.log(`- 计划抓取 provider 数量: ${totalCount}`);
  logger.log(`- 成功抓取数量: ${successCount}`);
  logger.log(`- 失败抓取数量: ${totalCount - successCount}`);
  logger.log(`- 成功率: ${((successCount / totalCount) * 100).toFixed(2)}%`);
  logger.log(`========================================\n`);

  await logger.flush();

  if (hasFailed) {
    process.exitCode = 1;
  }
}

main();

function renderMarkdownToHtml(title, md) {
  const lines = md.split("\n");
  let html = `
<div id="doc-viewer-container" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 24px; color: #1d1d1f; line-height: 1.6; max-width: 1000px; margin: 0 auto;">
  <h1 style="font-size: 32px; font-weight: 700; border-bottom: 1px solid #d2d2d7; padding-bottom: 12px; margin-bottom: 24px;">${title}</h1>
  `;
  
  let inTable = false;
  let tableHeaders = [];
  let tableRows = [];
  
  for (let line of lines) {
    line = line.trim();
    
    // 处理标题
    if (line.startsWith("# ")) {
      if (inTable) { html += closeTable(tableHeaders, tableRows); inTable = false; tableHeaders = []; tableRows = []; }
      html += `<h2 style="font-size: 24px; font-weight: 600; margin-top: 32px; margin-bottom: 16px; color: #1d1d1f;">${line.substring(2)}</h2>\n`;
      continue;
    }
    if (line.startsWith("## ")) {
      if (inTable) { html += closeTable(tableHeaders, tableRows); inTable = false; tableHeaders = []; tableRows = []; }
      html += `<h3 style="font-size: 20px; font-weight: 600; margin-top: 24px; margin-bottom: 12px; color: #1d1d1f;">${line.substring(3)}</h3>\n`;
      continue;
    }
    if (line.startsWith("### ")) {
      if (inTable) { html += closeTable(tableHeaders, tableRows); inTable = false; tableHeaders = []; tableRows = []; }
      html += `<h4 style="font-size: 16px; font-weight: 600; margin-top: 20px; margin-bottom: 8px; color: #1d1d1f;">${line.substring(4)}</h4>\n`;
      continue;
    }
    
    // 处理说明提示框
    if (line.includes('data-tips="true"')) {
      if (inTable) { html += closeTable(tableHeaders, tableRows); inTable = false; tableHeaders = []; tableRows = []; }
      const tipText = line.replace(/<[^>]+>/g, "").replace(/^\*\s*/, "").trim();
      if (tipText) {
        html += `
<div style="background-color: #f5f5f7; border-left: 4px solid #0066cc; padding: 12px 16px; border-radius: 4px; margin: 16px 0; font-size: 14px; color: #515154;">
  <strong>提示：</strong>${tipText}
</div>
        `;
      }
      continue;
    }
    
    // 处理表格行
    if (line.startsWith("|")) {
      inTable = true;
      const cells = line.split("|").map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      
      // 忽略分隔线行
      if (cells.every(c => /^:-*-*:?$/.test(c) || /^-+$/.test(c))) {
        continue;
      }
      
      if (tableHeaders.length === 0) {
        tableHeaders = cells;
      } else {
        tableRows.push(cells);
      }
      continue;
    } else {
      if (inTable) {
        html += closeTable(tableHeaders, tableRows);
        inTable = false;
        tableHeaders = [];
        tableRows = [];
      }
    }
    
    // 忽略一些多余的标记或空行
    if (!line || line.startsWith("<span") || line.startsWith("<div") || line.startsWith("</div")) {
      continue;
    }
    
    // 普通文本段落
    html += `<p style="font-size: 15px; margin-bottom: 16px; color: #333336;">${line}</p>\n`;
  }
  
  if (inTable) {
    html += closeTable(tableHeaders, tableRows);
  }
  
  html += `\n</div>`;
  return html;
}

function closeTable(headers, rows) {
  let tableHtml = `
<div style="margin: 24px 0; overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px;">
  <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 14px;">
    <thead>
      <tr style="background-color: #f8fafc; border-bottom: 2px solid #edf2f7;">
  `;
  
  headers.forEach(h => {
    const cleanHeader = h.replace(/<br\s*\/?>/gi, " ");
    tableHtml += `<th style="padding: 12px 16px; font-weight: 600; color: #4a5568; border-bottom: 1px solid #edf2f7;">${cleanHeader}</th>`;
  });
  
  tableHtml += `
      </tr>
    </thead>
    <tbody>
  `;
  
  rows.forEach((row, rowIndex) => {
    tableHtml += `<tr style="border-bottom: 1px solid #edf2f7; background-color: ${rowIndex % 2 === 0 ? '#ffffff' : '#f9fafb'};">`;
    row.forEach(cell => {
      const cleanCell = cell.replace(/\\-/g, "-").replace(/<br\s*\/?>/gi, "<br>");
      tableHtml += `<td style="padding: 12px 16px; color: #2d3748; vertical-align: top;">${cleanCell}</td>`;
    });
    tableHtml += `</tr>`;
  });
  
  tableHtml += `
    </tbody>
  </table>
</div>
  `;
  return tableHtml;
}

