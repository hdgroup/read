import { mkdir, readFile, readdir, rm, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "_posts/book");
const siteDir = path.join(root, "site");
const coverSourceDir = path.join(siteDir, "assets/covers");
const aiCoverSourceDir = path.join(siteDir, "assets/ai-covers");
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

function plainMarkdown(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^[\s*-]*\d+[\).、]\s*/gm, "")
    .replace(/[*_`#>-]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n");
}

function titleTokens(title) {
  const tokens = String(title)
    .replace(/[《》“”"'!?？！，,.:：;；()[\]（）\s-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
  if (!tokens.length && title.length >= 2) tokens.push(title.slice(0, 2));
  return tokens.slice(0, 4);
}

function sentenceCandidates(markdown) {
  const text = plainMarkdown(markdown);
  const pieces = text
    .split(/(?<=[。！？!?])|\n+/)
    .map((item) => item.trim())
    .map((item) => item.replace(/^["'“”‘’]+|["'“”‘’]+$/g, ""))
    .filter(Boolean);

  return pieces
    .map((sentence, index) => ({
      sentence: sentence.replace(/\s+/g, " "),
      index
    }))
    .filter(({ sentence }) => {
      const length = sentence.length;
      if (length < 16 || length > 120) return false;
      if (/[：:]$/.test(sentence)) return false;
      if (/豆瓣|版权|版权所有|侵权|原名|作者：|制作：|关键词|目录|献词|引用|参考文献|出版|ISBN|Originally|copyright/i.test(sentence)) return false;
      if (/成书|传刻|考订|校注|译本|译者|学界|此处取益|中文简体|授权/.test(sentence)) return false;
      if (/用一句话|一句话进入|进入这本书|打开方式|读者朋友|如前所述/.test(sentence)) return false;
      if (/^第[一二三四五六七八九十\d]+[章节篇卷部]/.test(sentence)) return false;
      if (/^[\d\s.,，。、:：-]+$/.test(sentence)) return false;
      return true;
    });
}

function makeTagline(post, markdown) {
  const signals = [
    "问题", "权力", "秩序", "制度", "历史", "生命", "系统", "混沌", "复杂", "货币",
    "自由", "国家", "人性", "心理", "沟通", "算法", "技术", "文明", "财富", "政治",
    "关系", "暴力", "专制", "民主", "科学", "时间", "选择", "战争", "伦理", "真相"
  ];
  const tokens = titleTokens(post.title);
  const candidates = sentenceCandidates(markdown);
  const scored = candidates.map((item) => {
    let score = 0;
    const length = item.sentence.length;
    score += Math.max(0, 42 - Math.abs(length - 56));
    score += Math.max(0, 18 - item.index / 12);
    for (const token of tokens) {
      if (item.sentence.includes(token)) score += 28;
    }
    for (const signal of signals) {
      if (item.sentence.includes(signal)) score += 8;
    }
    if (/[：:；;]/.test(item.sentence)) score += 3;
    if (/本书|这本书|作者|读者|我想|我要|我们希望/.test(item.sentence)) score -= 18;
    return { ...item, score };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0]?.sentence || post.description || post.title;
  const cleaned = best
    .replace(/^本书(认为|指出|提出|讲述|讨论|解释|试图)?[：:，,]?\s*/, "")
    .replace(/^这本书(认为|指出|提出|讲述|讨论|解释|试图)?[：:，,]?\s*/, "")
    .replace(/[：:；;，,、]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length > 76 ? `${cleaned.slice(0, 74)}…` : cleaned;
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

function generatedArtSvg(post) {
  const palette = coverPalette(post.slug);
  const hash = hashValue(`${post.slug}:${post.title}`);
  const motif = hash % 5;
  const title = escapeHtml(post.title);
  const promptHint = escapeHtml(post.artPrompt.split("\n")[3]?.replace("Key information: ", "") || post.description);
  const ring = (hash % 220) + 140;
  const sweep = ((hash >>> 8) % 220) + 140;
  const tilt = ((hash >>> 16) % 36) - 18;
  const motifs = [
    `<path d="M210 780c80-230 214-360 402-390 60 122 42 260-54 414-126 50-254 44-348-24z" fill="${palette.b}" opacity=".76"/>
    <circle cx="560" cy="430" r="${ring}" fill="none" stroke="#fff" stroke-width="18" opacity=".2"/>
    <path d="M250 342c126 108 272 140 438 96" stroke="#fff" stroke-width="28" stroke-linecap="round" opacity=".16"/>`,
    `<path d="M190 800c118-180 246-286 384-318 70 96 102 204 96 324-178 70-332 68-480-6z" fill="${palette.a}" opacity=".72"/>
    <path d="M300 272c-18 210 44 382 186 516" stroke="#fff" stroke-width="22" stroke-linecap="round" opacity=".18"/>
    <circle cx="620" cy="548" r="${sweep}" fill="${palette.c}" opacity=".24"/>`,
    `<path d="M180 648c102-176 238-254 408-234 98 124 128 252 90 384-184 50-346 20-498-150z" fill="${palette.c}" opacity=".58"/>
    <path d="M212 388c190-82 350-72 480 30M224 820c182-132 364-150 546-54" stroke="#fff" stroke-width="18" stroke-linecap="round" opacity=".18"/>
    <circle cx="454" cy="610" r="${ring}" fill="none" stroke="${palette.b}" stroke-width="34" opacity=".38"/>`,
    `<path d="M220 826c24-212 112-360 264-444 154 50 248 154 282 312-116 132-284 188-546 132z" fill="${palette.b}" opacity=".7"/>
    <path d="M452 284c98 150 122 316 72 498" stroke="#fff" stroke-width="24" stroke-linecap="round" opacity=".18"/>
    <path d="M284 454c170-58 320-30 450 84" stroke="${palette.c}" stroke-width="42" stroke-linecap="round" opacity=".3"/>`,
    `<path d="M178 760c92-206 244-326 456-360 94 128 108 270 42 426-210 42-370 34-498-66z" fill="${palette.a}" opacity=".72"/>
    <circle cx="430" cy="508" r="${ring}" fill="${palette.c}" opacity=".28"/>
    <path d="M232 310c116 160 286 246 510 258" stroke="#fff" stroke-width="20" stroke-linecap="round" opacity=".16"/>`
  ];

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
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency=".82" numOctaves="3" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer>
        <feFuncA type="table" tableValues="0 .18"/>
      </feComponentTransfer>
    </filter>
  </defs>
  <rect width="900" height="1200" rx="34" fill="url(#bg)"/>
  <rect width="900" height="1200" rx="34" fill="url(#glow)"/>
  <rect width="900" height="1200" rx="34" filter="url(#grain)" opacity=".55"/>
  <g opacity=".22" stroke="#fff" fill="none" transform="rotate(${tilt} 450 600)">
    <path d="M70 260C210 118 370 160 450 300s230 170 360 20"/>
    <path d="M44 762c164-124 316-114 456 22s266 136 360-8"/>
    <path d="M128 1010c86-224 270-286 424-156s230 16 290-124"/>
  </g>
  <g filter="url(#shadow)">
    <rect x="116" y="184" width="668" height="832" rx="46" fill="#fff" opacity=".1"/>
    <g transform="translate(0 34)">
      ${motifs[motif]}
    </g>
    <path d="M176 922c134 54 292 62 474 24 54-12 94 4 120 48-234 86-442 78-624-24 8-22 16-38 30-48z" fill="#fff" opacity=".2"/>
  </g>
</svg>`;
}

async function resolveCover(post) {
  for (const ext of ["png", "jpg", "jpeg", "webp", "svg"]) {
    const file = path.join(coverSourceDir, `${post.slug}.${ext}`);
    if (existsSync(file)) {
      return {
        source: file,
        href: `/assets/covers/${post.slug}.${ext}`,
        ext,
        isAi: await isExistingAiCover(file)
      };
    }
  }

  return null;
}

async function resolveAiCover(post) {
  for (const ext of ["png", "jpg", "jpeg", "webp", "svg"]) {
    const file = path.join(aiCoverSourceDir, `${post.slug}.${ext}`);
    if (existsSync(file)) {
      return { source: file, href: `/assets/ai-covers/${post.slug}.${ext}`, generated: false };
    }
  }

  if (post.coverInfo?.isAi) {
    return {
      source: post.coverInfo.source,
      href: `/assets/ai-covers/${post.slug}${path.extname(post.coverInfo.source)}`,
      generated: false
    };
  }

  return {
    source: null,
    href: `/assets/ai-covers/${post.slug}.svg`,
    generated: true
  };
}

async function imageDimensions(file) {
  const bytes = await readFile(file);
  if (bytes.length >= 24 && bytes.toString("ascii", 1, 4) === "PNG") {
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20)
    };
  }

  return null;
}

async function isExistingAiCover(file) {
  if (path.extname(file).toLowerCase() !== ".png") return false;
  const dimensions = await imageDimensions(file);
  return dimensions?.width === 1254 && dimensions?.height === 1254;
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
      <figure class="book-cover${post.originalCover ? " has-original-cover" : ""}">
        <img class="book-image book-ai-image" src="${withBase(post.aiCover)}" alt="${escapeHtml(post.title)} AI 插图" loading="lazy">
        ${post.originalCover ? `<img class="book-image book-original-image" src="${withBase(post.originalCover)}" alt="${escapeHtml(post.title)} 原封面" loading="lazy">` : ""}
        <figcaption>${escapeHtml(post.tagline)}</figcaption>
      </figure>
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
  post.tagline = makeTagline(post, body);
  post.artPrompt = makeArtPrompt(post);
  post.coverInfo = await resolveCover(post);
  post.aiCoverInfo = await resolveAiCover(post);
  post.aiCover = post.aiCoverInfo.href;
  post.originalCover = post.coverInfo && !post.coverInfo.isAi ? post.coverInfo.href : "";
  posts.push(post);
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
await copyAssets();

await mkdir(path.join(distDir, "assets/ai-covers"), { recursive: true });
await mkdir(path.join(distDir, "assets/covers"), { recursive: true });
for (const post of posts) {
  if (post.aiCoverInfo.generated) {
    await writeFile(path.join(distDir, "assets/ai-covers", `${post.slug}.svg`), generatedArtSvg(post));
  } else {
    await copyFile(post.aiCoverInfo.source, path.join(distDir, "assets/ai-covers", path.basename(post.aiCover)));
  }

  if (post.originalCover && post.coverInfo) {
    await copyFile(post.coverInfo.source, path.join(distDir, "assets/covers", path.basename(post.originalCover)));
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
  aiCover: post.aiCover,
  originalCover: post.originalCover,
  wordCount: post.wordCount
})), null, 2));

await writeFile(path.join(distDir, "cover-prompts.json"), JSON.stringify(posts.map((post) => ({
  title: post.title,
  slug: post.slug,
  output: `site/assets/ai-covers/${post.slug}.png`,
  prompt: post.artPrompt
})), null, 2));

if (process.env.CUSTOM_DOMAIN && existsSync(path.join(root, "CNAME"))) {
  await copyFile(path.join(root, "CNAME"), path.join(distDir, "CNAME"));
}

console.log(`Built ${posts.length} books into ${path.relative(root, distDir)}`);
