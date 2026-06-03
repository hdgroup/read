import { mkdir, readFile, readdir, rm, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "_posts/book");
const siteDir = path.join(root, "site");
const coverSourceDir = path.join(siteDir, "assets/covers");
const distDir = path.join(root, "dist");
const perPage = 20;
const basePath = (process.env.BASE_PATH || "").replace(/\/$/, "");

const escapeHtml = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);

const stripTags = (value = "") => value.replace(/<[^>]+>/g, "");

const withBase = (url) => `${basePath}${url}`;

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

function makeTagline(post) {
  const source = `${post.description} ${post.headings.slice(0, 8).map((heading) => heading.text).join(" ")}`;
  const cleaned = stripTags(source)
    .replace(/\s+/g, " ")
    .replace(/[。！？!?].*$/, "")
    .trim();
  const core = cleaned || post.title;

  if (/bitcoin|比特币|货币|经济|债务|金融|money/i.test(`${post.title} ${core}`)) {
    return `从财富、信任与制度的角度，重新理解《${post.title}》提出的问题。`;
  }
  if (/history|历史|明朝|中国|帝国|战争|republic|国家/i.test(`${post.title} ${core}`)) {
    return `沿着历史现场展开，看《${post.title}》如何解释权力、秩序与人的选择。`;
  }
  if (/psychology|心理|沟通|人生|老实人|随机|思考/i.test(`${post.title} ${core}`)) {
    return `一本关于心智与行动的书，适合在《${post.title}》里寻找自我校准的线索。`;
  }
  if (/science|complexity|chaos|算法|人工智能|系统|技术/i.test(`${post.title} ${core}`)) {
    return `把复杂世界拆成可观察的结构，《${post.title}》像一张通往新秩序的地图。`;
  }

  return `用一句话进入《${post.title}》：${core.slice(0, 58)}。`;
}

function makeArtPrompt(post) {
  const themes = post.headings.slice(0, 6).map((heading) => heading.text).join("; ");
  return [
    "Use case: illustration-story",
    "Asset type: square book-card illustration for a digital library",
    `Primary request: Create a symbolic illustration for the book "${post.title}".`,
    `Key information: ${post.description}; ${themes}`,
    "Style/medium: refined editorial illustration, painterly digital art, rich texture, no text.",
    "Composition/framing: centered square composition, strong silhouette readable at thumbnail size, generous margins.",
    "Lighting/mood: thoughtful, literary, luminous, slightly cinematic.",
    "Constraints: no words, no book title, no watermark, suitable as a website card image."
  ].join("\n");
}

function hashValue(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function coverPalette(slug) {
  const hash = hashValue(slug);
  const hue = hash % 360;
  return {
    a: `hsl(${hue} 58% 34%)`,
    b: `hsl(${(hue + 38) % 360} 48% 48%)`,
    c: `hsl(${(hue + 190) % 360} 54% 64%)`
  };
}

function generatedCoverSvg(post) {
  const palette = coverPalette(post.slug);
  const title = escapeHtml(post.title);
  const category = escapeHtml(post.category);
  const promptHint = escapeHtml(post.artPrompt.split("\n")[3]?.replace("Key information: ", "") || post.description);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200" role="img" aria-labelledby="title desc">
  <title id="title">${title}</title>
  <desc id="desc">${promptHint}</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.a}"/>
      <stop offset="0.62" stop-color="${palette.b}"/>
      <stop offset="1" stop-color="${palette.c}"/>
    </linearGradient>
    <radialGradient id="glow" cx="35%" cy="22%" r="62%">
      <stop offset="0" stop-color="#fff8" />
      <stop offset="1" stop-color="#fff0" />
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="22" stdDeviation="22" flood-color="#000" flood-opacity=".26"/>
    </filter>
  </defs>
  <rect width="900" height="1200" rx="34" fill="url(#bg)"/>
  <rect width="900" height="1200" rx="34" fill="url(#glow)"/>
  <g opacity=".22" stroke="#fff" fill="none">
    <path d="M90 280C210 120 370 160 450 300s230 170 340 30"/>
    <path d="M52 760c160-120 310-112 448 24s260 132 348 2"/>
    <path d="M140 1000c80-220 260-280 410-160s220 20 270-112"/>
  </g>
  <g filter="url(#shadow)">
    <path d="M210 330h360c66 0 120 54 120 120v360c0 66-54 120-120 120H210V330z" fill="#fff" opacity=".9"/>
    <path d="M210 330c82 34 128 82 138 146v454c-42-32-88-52-138-60V330z" fill="#101820" opacity=".16"/>
    <path d="M340 486c98-94 228-86 286 18-112 16-196 70-250 162-28-58-40-118-36-180z" fill="${palette.a}" opacity=".72"/>
    <circle cx="548" cy="558" r="72" fill="${palette.c}" opacity=".82"/>
    <path d="M326 776c84-104 192-136 324-96-66 90-158 132-276 126z" fill="${palette.b}" opacity=".76"/>
  </g>
  <text x="78" y="96" fill="#fff" font-family="ui-sans-serif, system-ui, sans-serif" font-size="26" font-weight="800" opacity=".86">${post.year}</text>
  <text x="78" y="135" fill="#fff" font-family="ui-sans-serif, system-ui, sans-serif" font-size="18" opacity=".72">${category}</text>
  <text x="78" y="1090" fill="#fff" font-family="ui-sans-serif, system-ui, sans-serif" font-size="34" font-weight="800">${title.slice(0, 18)}</text>
</svg>`;
}

async function resolveCover(post) {
  for (const ext of ["png", "jpg", "jpeg", "webp", "svg"]) {
    const file = path.join(coverSourceDir, `${post.slug}.${ext}`);
    if (existsSync(file)) {
      return { source: file, href: `/assets/covers/${post.slug}.${ext}`, generated: false };
    }
  }

  return { source: null, href: `/assets/covers/${post.slug}.svg`, generated: true };
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
  const pageTitle = title === "Delia‘s 藏书阁" ? title : `${title} · Delia‘s 藏书阁`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <title>${escapeHtml(pageTitle)}</title>
  <link rel="stylesheet" href="${withBase("/assets/app.css")}">
  <script>document.documentElement.dataset.theme=localStorage.getItem("theme")||"light"</script>
</head>
<body class="${pageClass}" data-base-path="${escapeHtml(basePath)}">
  ${body}
  <script src="${withBase("/assets/app.js")}"></script>
</body>
</html>`;
}

function siteHeader(current = "home") {
  return `<header class="site-shell">
  <nav class="topbar">
    <a class="brand" href="${withBase("/")}" aria-label="Delia‘s 藏书阁">Delia‘s <span>藏书阁</span></a>
    <div class="nav-actions">
      <a class="${current === "home" ? "active" : ""}" href="${withBase("/")}">书库</a>
      <a href="https://github.com/hdgroup/read" target="_blank" rel="noreferrer">GitHub</a>
      <button class="icon-button" data-theme-toggle type="button" aria-label="切换主题">◐</button>
    </div>
  </nav>
</header>`;
}

function bookCard(post) {
  return `<article class="book-card" data-title="${escapeHtml(post.title.toLowerCase())}" data-year="${post.year}" data-category="${escapeHtml(post.category.toLowerCase())}" data-tagline="${escapeHtml(post.tagline)}">
    <a class="book-card-link" href="${withBase(`/books/${post.slug}/`)}">
      <figure class="book-cover">
        <img src="${withBase(post.cover)}" alt="${escapeHtml(post.title)} 插图" loading="lazy">
        <figcaption>${escapeHtml(post.tagline)}</figcaption>
      </figure>
      <div class="book-meta">
        <span>${escapeHtml(post.category)}</span>
        <span>${post.wordCount.toLocaleString("zh-CN")} 字</span>
      </div>
    </a>
  </article>`;
}

function shelfRows(posts) {
  const rows = [];
  for (let index = 0; index < posts.length; index += 4) {
    const row = posts.slice(index, index + 4);
    rows.push(`<div class="shelf-row" data-shelf-row="${Math.floor(index / 4) + 1}">
        ${row.map(bookCard).join("")}
      </div>
      <div class="shelf-divider" aria-hidden="true"></div>`);
  }
  return rows.join("");
}

function pagination(page, totalPages) {
  if (totalPages <= 1) return "";
  const href = (index) => withBase(index === 1 ? "/" : `/page/${index}/`);
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

  return layout({
    title: page === 1 ? "Delia‘s 藏书阁" : `Delia‘s 藏书阁 第 ${page} 页`,
    pageClass: "home-page",
    description: "Delia‘s 藏书阁，自动从 Markdown 生成的静态书库。",
    body: `${siteHeader("home")}
<main class="library">
  <section class="shelf-stage" aria-label="Delia‘s 藏书阁">
    <div class="book-grid" data-book-grid data-total-count="${posts.length}">
      ${shelfRows(visible)}
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
  <a class="back-link" href="${withBase("/")}">← 返回书库</a>
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
  await copyFile(path.join(siteDir, "assets/bookshelf-wood.png"), path.join(distDir, "assets/bookshelf-wood.png"));
  const cnamePath = path.join(siteDir, "CNAME");
  if (existsSync(cnamePath)) {
    await copyFile(cnamePath, path.join(distDir, "CNAME"));
  }
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
  const post = {
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
  };
  post.tagline = makeTagline(post);
  post.artPrompt = makeArtPrompt(post);
  post.coverInfo = await resolveCover(post);
  post.cover = post.coverInfo.href;
  posts.push(post);
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await copyAssets();

await mkdir(path.join(distDir, "assets/covers"), { recursive: true });
for (const post of posts) {
  const target = path.join(distDir, "assets/covers", path.basename(post.cover));
  if (post.coverInfo.generated) {
    await writeFile(target, generatedCoverSvg(post));
  } else {
    await copyFile(post.coverInfo.source, target);
  }
}

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
  tagline: post.tagline,
  artPrompt: post.artPrompt,
  cover: post.cover,
  wordCount: post.wordCount
})), null, 2));

await writeFile(path.join(distDir, "cover-prompts.json"), JSON.stringify(posts.map((post) => ({
  title: post.title,
  slug: post.slug,
  output: `site/assets/covers/${post.slug}.png`,
  prompt: post.artPrompt
})), null, 2));

if (process.env.CUSTOM_DOMAIN && existsSync(path.join(root, "CNAME"))) {
  await copyFile(path.join(root, "CNAME"), path.join(distDir, "CNAME"));
}

console.log(`Built ${posts.length} books into ${path.relative(root, distDir)}`);
