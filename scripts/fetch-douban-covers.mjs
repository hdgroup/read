import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceDir = path.join(root, "_posts/book");
const coverDir = path.join(root, "site/assets/covers");
const keepExisting = new Set(["chaos-making-a-new-science"]);

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

function firstDoubanSubject(markdown) {
  const match = markdown.match(/https?:\/\/(?:book\.)?douban\.com\/subject\/\d+\/?/);
  if (!match) return null;
  return match[0].replace("https://www.douban.com/subject/", "https://book.douban.com/subject/");
}

function extractCoverUrl(html) {
  const candidates = [
    /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i,
    /<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i,
    /<img[^>]+id=["']mainpic["'][^>]+src=["']([^"']+)["']/i,
    /<a[^>]+class=["']nbg["'][^>]*>\s*<img[^>]+src=["']([^"']+)["']/i
  ];

  for (const pattern of candidates) {
    const match = html.match(pattern);
    if (match) return match[1].replace(/\\u002F/g, "/");
  }

  return null;
}

function extensionFromContentType(contentType, fallbackUrl) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  const ext = path.extname(new URL(fallbackUrl).pathname).replace(".", "").toLowerCase();
  return ["jpg", "jpeg", "png", "webp"].includes(ext) ? (ext === "jpeg" ? "jpg" : ext) : "jpg";
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function downloadImage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      "Referer": "https://book.douban.com/"
    }
  });
  if (!response.ok) throw new Error(`image HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    ext: extensionFromContentType(contentType, url)
  };
}

await mkdir(coverDir, { recursive: true });

const files = (await walk(sourceDir)).sort().reverse();
const results = [];

for (const file of files) {
  const slug = slugFromFile(file);
  const pngPath = path.join(coverDir, `${slug}.png`);
  const jpgPath = path.join(coverDir, `${slug}.jpg`);
  const webpPath = path.join(coverDir, `${slug}.webp`);

  if (keepExisting.has(slug) && (existsSync(pngPath) || existsSync(jpgPath) || existsSync(webpPath))) {
    results.push({ slug, status: "kept-existing" });
    continue;
  }

  const markdown = await readFile(file, "utf8");
  const subjectUrl = firstDoubanSubject(markdown);
  if (!subjectUrl) {
    results.push({ slug, status: "missing-douban" });
    continue;
  }

  try {
    const html = await fetchText(subjectUrl);
    const coverUrl = extractCoverUrl(html);
    if (!coverUrl) {
      results.push({ slug, status: "missing-cover", subjectUrl });
      continue;
    }

    const image = await downloadImage(coverUrl);
    const target = path.join(coverDir, `${slug}.${image.ext}`);
    await writeFile(target, image.bytes);
    results.push({ slug, status: "downloaded", subjectUrl, coverUrl, target: path.relative(root, target) });
  } catch (error) {
    results.push({ slug, status: "failed", subjectUrl, error: error.message });
  }

  await new Promise((resolve) => setTimeout(resolve, 420));
}

const summary = results.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] || 0) + 1;
  return acc;
}, {});

await writeFile(path.join(coverDir, "douban-cover-results.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(summary, null, 2));
