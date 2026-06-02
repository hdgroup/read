import { mkdir, readFile, readdir, rm, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "_posts/book");
const siteDir = path.join(root, "site");
const distDir = path.join(root, "dist");
const perPage = 18;

const escapeHtml = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);

const stripTags = (value = "") => value.replace(/<[^>]+>/g, "");

const slugify = (value, fallback = "section") => {
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/&[a-z]+;/g, "")
    .replace(/[^\w\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
};

const smartDate = (file) => {
  const match = path.basename(file).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
};

const slugFromFile = (file) => path.basename(file, ".md").replace(/^\d{4}-\d{2}-\d{2}-/, "");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full));
    } else if (entry.name.endsWith(".md")) {
      files.push(full);
    }
  }

  return files;
}

function parseFrontMatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const data = {};
  let body = raw;

  if (match) {
    body = raw.slice(match[0].length);
    for (const line of match[1].split(/\n/)) {
      const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (field) {
        data[field[1]] = field[2].replace(/^["']|["']$/g, "").trim();
      }
    }
  }

  return { data, body };
}

function inlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
}

function renderMarkdown(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const headings = [];
  const usedIds = new Map();
  const html = [];
  let paragraph = [];
  let listType = null;
  let inFence = false;
  let fenceLang = "";
  let fenceLines = [];

  const uniqueId = (text) => {
    const base = slugify(text, `section-${headings.length + 1}`);
    const count = usedIds.get(base) || 0;
    usedIds.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  };

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const line of lines) {
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      if (inFence) {
        html.push(`<pre><code class="language-${escapeHtml(fenceLang)}">${escapeHtml(fenceLines.join("\n"))}</code></pre>`);
        inFence = false;
        fenceLang = "";
        fenceLines = [];
      } else {
        flushParagraph();
        closeList();
        inFence = true;
        fenceLang = fence[1] || "";
      }
      continue;
    }

    if (inFence) {
      fenceLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);

    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      const text = stripTags(inlineMarkdown(heading[2].trim()));
      const id = uniqueId(text);
      headings.push({ level, text, id });
      html.push(`<h${level} id="${id}">${inlineMarkdown(heading[2].trim())}</h${level}>`);
    } else if (unordered || ordered) {
      flushParagraph();
      const nextType = unordered ? "ul" : "ol";
      if (listType !== nextType) {
        closeList();
        html.push(`<${nextType}>`);
        listType = nextType;
      }
      html.push(`<li>${inlineMarkdown((unordered || ordered)[1].trim())}</li>`);
    } else if (/^>\s?/.test(line)) {
      flushParagraph();
      closeList();
      html.push(`<blockquote>${inlineMarkdown(line.replace(/^>\s?/, "").trim())}</blockquote>`);
    } else if (/^\s*$/.test(line)) {
      flushParagraph();
      closeList();
    } else if (!/^---+$/.test(line.trim())) {
      paragraph.push(line.trim());
    }
  }

  flushParagraph();
  closeList();

  return { html: html.join("\n"), headings };
}

function excerpt(markdown, fallback) {
  const cleaned = markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>-]/g, "")
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  return (cleaned[0] || fallback || "").slice(0, 150);
}

function buildToc(headings) {
  const h1Count = headings.filter((heading) => heading.level === 1).length;
  const chapterLevel = h1Count >= 2 ? 1 : 2;
  const roots = [];
  let current = null;

  for (const heading of headings.filter((item) => item.level <= chapterLevel + 1)) {
    if (heading.level <= chapterLevel || !current) {
      current = { ...heading, children: [] };
      roots.push(current);
    } else if (heading.level === chapterLevel + 1) {
      current.children.push(heading);
    }
  }

  return roots;
}

function layout({ title, body, pageClass = "", description = "" }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <title>${escapeHtml(title)} · Delia's 藏书阁</title>
  <link rel="stylesheet" href="/assets/app.css">
  <script>document.documentElement.dataset.theme=localStorage.getItem("theme")||"light"</script>
</head>
<body class="${pageClass}">
  ${body}
  <script src="/assets/app.js"></script>
</body>
</html>`;
}

function siteHeader(current = "home") {
  return `<header class="site-shell">
  <nav class="topbar">
    <a class="brand" href="/" aria-label="Delia's 藏书阁">Delia's <span>藏书阁</span></a>
    <div class="nav-actions">
      <a class="${current === "home" ? "active" : ""}" href="/">书库</a>
      <a href="https://github.com/hdgroup/lib" target="_blank" rel="noreferrer">GitHub</a>
      <button class="icon-button" data-theme-toggle type="button" aria-label="切换主题">◐</button>
    </div>
  </nav>
</header>`;
}

function bookCard(post) {
  return `<article class="book-card" data-title="${escapeHtml(post.title.toLowerCase())}" data-year="${post.year}" data-category="${escapeHtml(post.category.toLowerCase())}">
    <a class="book-card-link" href="/books/${post.slug}/">
      <span class="book-year">${post.year}</span>
      <h2>${escapeHtml(post.title)}</h2>
      <p>${escapeHtml(post.description)}</p>
      <div class="book-meta">
        <span>${escapeHtml(post.category)}</span>
        <span>${post.wordCount.toLocaleString("zh-CN")} 字</span>
      </div>
    </a>
  </article>`;
}

function pagination(page, totalPages) {
  if (totalPages <= 1) return "";
  const href = (index) => index === 1 ? "/" : `/page/${index}/`;
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1)
    .map((index) => `<a class="${index === page ? "active" : ""}" href="${href(index)}">${index}</a>`)
    .join("");

  return `<nav class="pagination" aria-label="分页">
    ${page > 1 ? `<a href="${href(page - 1)}">上一页</a>` : `<span>上一页</span>`}
    <div>${pages}</div>
    ${page < totalPages ? `<a href="${href(page + 1)}">下一页</a>` : `<span>下一页</span>`}
  </nav>`;
}

function indexPage(posts, page, totalPages) {
  const start = (page - 1) * perPage;
  const visible = posts.slice(start, start + perPage);
  const years = [...new Set(posts.map((post) => post.year))].sort((a, b) => b.localeCompare(a));

  return layout({
    title: page === 1 ? "书库" : `书库 第 ${page} 页`,
    pageClass: "home-page",
    description: "Delia's 藏书阁，自动从 Markdown 生成的静态书库。",
    body: `${siteHeader("home")}
<section class="hero">
  <div class="hero-copy">
    <p class="eyebrow">Markdown powered library</p>
    <h1>专心维护文字，剩下的交给网页。</h1>
    <p>共收录 ${posts.length} 本书。列表、分页、目录、阅读进度和主题切换都由静态构建自动生成。</p>
  </div>
  <div class="hero-orbit" aria-hidden="true">
    <span></span><span></span><span></span>
  </div>
</section>
<main class="library">
  <aside class="library-panel">
    <label class="search-box">
      <span>搜索</span>
      <input data-search type="search" placeholder="书名、分类或年份">
    </label>
    <div class="filter-group" aria-label="年份筛选">
      <button class="active" data-filter-year="all" type="button">全部</button>
      ${years.slice(0, 6).map((year) => `<button data-filter-year="${year}" type="button">${year}</button>`).join("")}
    </div>
    <p class="panel-note">当前页展示 ${visible.length} 本，完整书库可通过分页浏览。</p>
  </aside>
  <section>
    <div class="section-head">
      <h2>书籍列表</h2>
      <span data-result-count>${visible.length} / ${posts.length}</span>
    </div>
    <div class="book-grid" data-book-grid>
      ${visible.map(bookCard).join("")}
    </div>
    ${pagination(page, totalPages)}
  </section>
</main>`
  });
}

function articlePage(post) {
  const toc = buildToc(post.headings);
  const tocMarkup = toc.map((item) => `<li class="toc-item" data-heading-id="${item.id}">
    <a href="#${item.id}">${escapeHtml(item.text)}</a>
    ${item.children.length ? `<ol>${item.children.map((child) => `<li data-heading-id="${child.id}"><a href="#${child.id}">${escapeHtml(child.text)}</a></li>`).join("")}</ol>` : ""}
  </li>`).join("");

  return layout({
    title: post.title,
    pageClass: "reader-page",
    description: post.description,
    body: `<div class="reading-progress" data-reading-progress></div>
${siteHeader()}
<header class="reader-hero">
  <a class="back-link" href="/">← 返回书库</a>
  <p class="eyebrow">${post.year} · ${escapeHtml(post.category)}</p>
  <h1>${escapeHtml(post.title)}</h1>
  <div class="reader-stats">
    <span>${post.wordCount.toLocaleString("zh-CN")} 字</span>
    <span>约 ${Math.max(1, Math.round(post.wordCount / 500))} 分钟</span>
  </div>
</header>
<main class="reader-layout">
  <article class="article-content">
    ${post.html}
  </article>
  <aside class="toc-shell">
    <div class="toc-card">
      <div class="toc-title">目录</div>
      <ol class="toc-list" data-toc>${tocMarkup}</ol>
    </div>
  </aside>
</main>`
  });
}

async function copyAssets() {
  await mkdir(path.join(distDir, "assets"), { recursive: true });
  await copyFile(path.join(siteDir, "assets/app.css"), path.join(distDir, "assets/app.css"));
  await copyFile(path.join(siteDir, "assets/app.js"), path.join(distDir, "assets/app.js"));
}

const files = (await walk(sourceDir)).sort().reverse();
const posts = [];

for (const file of files) {
  const raw = await readFile(file, "utf8");
  const { data, body } = parseFrontMatter(raw);
  const rendered = renderMarkdown(body);
  const title = data.title || slugFromFile(file);
  const date = smartDate(file);
  const wordCount = body.replace(/\s/g, "").length;

  posts.push({
    slug: slugFromFile(file),
    file,
    title,
    date,
    year: date.slice(0, 4) || "未知",
    category: data.categories || "未分类",
    description: data.description || excerpt(body, title),
    wordCount,
    html: rendered.html,
    headings: rendered.headings
  });
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await copyAssets();

const totalPages = Math.ceil(posts.length / perPage);
for (let page = 1; page <= totalPages; page += 1) {
  const targetDir = page === 1 ? distDir : path.join(distDir, "page", String(page));
  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, "index.html"), indexPage(posts, page, totalPages));
}

for (const post of posts) {
  const targetDir = path.join(distDir, "books", post.slug);
  await mkdir(targetDir, { recursive: true });
  await writeFile(path.join(targetDir, "index.html"), articlePage(post));
}

await writeFile(path.join(distDir, "search-index.json"), JSON.stringify(posts.map((post) => ({
  title: post.title,
  slug: post.slug,
  date: post.date,
  year: post.year,
  category: post.category,
  description: post.description,
  wordCount: post.wordCount
})), null, 2));

if (existsSync(path.join(root, "CNAME"))) {
  await copyFile(path.join(root, "CNAME"), path.join(distDir, "CNAME"));
}

console.log(`Built ${posts.length} books into ${path.relative(root, distDir)}`);
