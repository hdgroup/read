import { execFileSync } from "node:child_process";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const epubPath = process.argv[2];
const explicitSlug = process.argv[3] || "";

if (!epubPath) {
  console.error("Usage: node scripts/import-epub.mjs /path/to/book.epub [slug]");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const year = today.slice(0, 4);
const slug = explicitSlug || path.basename(epubPath, path.extname(epubPath)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "imported-book";

function unzipText(file) {
  return execFileSync("unzip", ["-p", epubPath, file], { encoding: "utf8", maxBuffer: 80 * 1024 * 1024 });
}

function unzipList() {
  return execFileSync("unzip", ["-Z1", epubPath], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 })
    .split(/\r?\n/)
    .filter(Boolean);
}

function decodeEntities(value = "") {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rsquo;/g, "’");
}

function tagText(html = "") {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

function cleanTitle(value = "") {
  return tagText(value).replace(/【.*$/, "").trim();
}

function metaValue(opf, tag) {
  const match = opf.match(new RegExp(`<dc:${tag}[^>]*>([\\s\\S]*?)</dc:${tag}>`, "i"));
  return match ? tagText(match[1]) : "";
}

function parseManifest(opf) {
  const manifest = new Map();
  for (const match of opf.matchAll(/<item\b([^>]+)>/gi)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((item) => [item[1], item[2]]));
    if (attrs.id && attrs.href) manifest.set(attrs.id, attrs.href);
  }
  return manifest;
}

function parseSpine(opf, manifest) {
  const spine = [];
  for (const match of opf.matchAll(/<itemref\b([^>]+)>/gi)) {
    const attrs = Object.fromEntries([...match[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((item) => [item[1], item[2]]));
    if (attrs.idref && manifest.has(attrs.idref)) spine.push(manifest.get(attrs.idref));
  }
  return spine;
}

function shouldSkipFile(file) {
  return /titlepage|part000[0-3]|part007[1-9]/.test(file);
}

function convertHtml(file, html) {
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  const blocks = [];
  const blockPattern = /<(h[1-6]|p)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

  for (const match of body.matchAll(blockPattern)) {
    const tag = match[1].toLowerCase();
    const attrs = match[2] || "";
    const text = tagText(match[3]);
    if (!text || /^目录$/.test(text)) continue;

    if (tag === "h1") {
      blocks.push(`# ${text}`);
    } else if (tag === "h2") {
      blocks.push(`## ${text}`);
    } else if (tag === "h3") {
      blocks.push(`### ${text}`);
    } else if (/class=["'][^"']*block_7/.test(attrs) && text.length <= 40) {
      blocks.push(`### ${text}`);
    } else {
      blocks.push(text);
    }
  }

  return blocks.join("\n\n");
}

const opfName = unzipList().find((file) => file.endsWith(".opf")) || "content.opf";
const opf = unzipText(opfName);
const manifest = parseManifest(opf);
const spine = parseSpine(opf, manifest);
const title = cleanTitle(metaValue(opf, "title")) || "未命名书籍";
const author = metaValue(opf, "creator");
const publisher = metaValue(opf, "publisher");
const description = `${author ? `${author}的` : ""}《${title}》，由 EPUB 自动整理为 Markdown 书稿。`;

const markdownParts = [];
for (const file of spine) {
  if (!/\.x?html?$/i.test(file) || shouldSkipFile(file)) continue;
  const converted = convertHtml(file, unzipText(file));
  if (converted) markdownParts.push(converted);
}

const frontMatter = [
  "---",
  `title: ${title}`,
  `date: ${today}`,
  "categories: book",
  author ? `author: ${author}` : "",
  publisher ? `publisher: ${publisher}` : "",
  `description: ${description}`,
  "---"
].filter(Boolean).join("\n");

const markdown = `${frontMatter}\n\n${markdownParts.join("\n\n")}\n`;
const postDir = path.join(root, "_posts/book", year);
const postPath = path.join(postDir, `${today}-${slug}.md`);

await mkdir(postDir, { recursive: true });
await writeFile(postPath, markdown, "utf8");

const coverHref = manifest.get("cover") || unzipList().find((file) => /cover\.(jpe?g|png|webp)$/i.test(file));
let coverPath = "";
if (coverHref) {
  const ext = path.extname(coverHref).toLowerCase() || ".jpg";
  coverPath = path.join(root, "site/assets/covers", `${slug}${ext === ".jpeg" ? ".jpg" : ext}`);
  await mkdir(path.dirname(coverPath), { recursive: true });
  const coverBytes = execFileSync("unzip", ["-p", epubPath, coverHref], { encoding: "buffer", maxBuffer: 20 * 1024 * 1024 });
  await writeFile(coverPath, coverBytes);
}

console.log(JSON.stringify({
  title,
  author,
  publisher,
  slug,
  postPath,
  coverPath,
  filesConverted: markdownParts.length
}, null, 2));
