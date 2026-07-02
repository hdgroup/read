# Read

一个由 Markdown 书稿自动生成的静态阅读站点。

在线访问：[https://read.delia.love/](https://read.delia.love/)

源码仓库：[https://github.com/hdgroup/read](https://github.com/hdgroup/read)

## 现在做了什么

这个仓库已经从原来的 Jekyll 站点整理成了更轻的静态站点生成项目：

- 书稿统一保存在 `_posts/book/**`，移除了旧站点里的非书籍文章、Jekyll 模板、Ruby 依赖、旧 assets 和 `_site` 生成物。
- 新增 `scripts/build-site.mjs`，用 Node.js 直接把 Markdown 书稿生成静态 HTML，不再依赖 Jekyll、Ruby、接口服务或数据库。
- 新增书籍列表页，以“五层书架”的形式展示书稿；每页 20 本书，每层 4 本，支持分页、封面和悬停简介。
- 新增阅读页，右侧展示目录；默认显示章节目录，滚动到某一章时自动展开该章的二级目录，并同步阅读进度。
- 每本书的正文页都提供朗读控制，通过 `rany2/edge-tts` 使用真正的 `zh-CN-XiaoxiaoNeural` 音色，默认以 2 倍速朗读。
- 为每本书补齐封面素材：优先使用豆瓣封面，找不到时使用 AI 生成插图。封面统一放在 `site/assets/covers/`。
- 新增 GitHub Pages 部署 workflow，推送到 `main` 后自动构建并发布到自定义域名 `read.delia.love`。

## 目录结构

```text
.
├── _posts/book/              # Markdown 书稿，只维护这里的内容即可
├── site/assets/app.css       # 站点样式
├── site/assets/app.js        # 主题切换、目录联动等前端交互
├── site/assets/covers/       # 原版书籍封面，文件名使用书稿 slug
├── site/assets/ai-covers/    # 书架卡片插图，文件名使用书稿 slug
├── site/CNAME                # GitHub Pages 自定义域名
├── scripts/build-site.mjs    # 静态站点生成器
├── scripts/import-epub.mjs   # 从 EPUB 导入书稿和原封面
├── scripts/fetch-douban-covers.mjs
├── scripts/serve-site.py     # 本地静态站点与 Edge TTS 服务
├── requirements.txt          # Python TTS 依赖
├── .github/workflows/deploy.yml
├── package.json
└── README.md
```

`dist/` 是本地构建产物，不提交到 `main` 分支。

## 给下一位 AI：维护一本书的标准流程

下面是本仓库最重要的操作约定。处理书籍任务时，先读完本节再修改文件。

### 0. 动手前

先运行：

```bash
git status --short
```

- 工作区可能已经有用户暂存的封面或其他修改。它们不属于当前任务时，不要删除、还原、覆盖或顺手提交。
- 不要直接修改 `dist/`；它是 `npm run build` 生成的临时产物，并已被忽略。
- 不要提交 `tmp/`、`.venv/`、`__pycache__/` 或豆瓣封面抓取缓存。

### 1. 确认是新增还是更新

更新现有书籍时，先按标题或 slug 查找：

```bash
rg -n "书名或关键词" _posts/book
rg --files _posts/book | rg "slug"
```

更新书籍应尽量保留原文件名和 slug，否则线上阅读地址会改变。只有用户明确要求时才重命名或删除书稿。

### 2. 维护书稿

书稿路径必须使用：

```text
_posts/book/<年份>/YYYY-MM-DD-<slug>.md
```

关键规则：

- `<slug>` 会直接生成阅读地址 `/books/<slug>/`，并关联同名封面。
- 构建器从文件名读取日期和年份；只修改 front matter 中的 `date` 不会改变页面年份。
- slug 使用稳定、可读的小写英文和连字符，不要使用空格，也不要随意改动已经发布的 slug。
- front matter 解析器只支持简单的单行 `key: value`，不要使用复杂 YAML、数组或多行值。
- 至少保留 `title`、`date`、`categories`。建议同时填写 `author`、`publisher` 和 `description`。

推荐格式：

```markdown
---
title: 混沌：开创新科学
date: 2025-07-23
categories: book
author: 詹姆斯·格雷克
publisher: 示例出版社
description: 一本介绍混沌理论发展及其科学影响的作品。
---

# 第一章

正文内容……
```

正文使用仓库构建器支持的基础 Markdown：

- `#` 到 `####` 标题
- 普通段落、有序/无序列表、引用和代码块
- 链接、图片、行内代码、粗体和斜体

目录由正文标题自动生成。导入或编辑后，应检查章节层级是否连续，避免整本书只有一个巨大的段落、重复书名或错误目录。

### 3. 从 EPUB 新增一本书

仓库带有导入脚本，系统需要 `unzip`：

```bash
node scripts/import-epub.mjs "/绝对路径/书名.epub" stable-english-slug
```

脚本会：

- 在当前年份目录生成 `YYYY-MM-DD-slug.md`
- 读取 EPUB 的标题、作者、出版社和正文
- 尝试把 EPUB 原封面保存到 `site/assets/covers/<slug>.<ext>`

EPUB 转换是启发式处理，运行后必须人工检查：

1. front matter 的书名、作者、出版社和简介是否正确。
2. 是否混入版权页、广告、重复目录、页眉页脚或乱码。
3. 章节标题是否使用合理的 `#`、`##`、`###` 层级。
4. 正文是否完整，开头和结尾有没有被误删。
5. 文件名 slug 与两个封面目录中的文件名是否一致。

### 4. 维护封面

一本文稿可以有两类图片：

- `site/assets/covers/<slug>.jpg|png|webp|svg`：原版封面。
- `site/assets/ai-covers/<slug>.jpg|png|webp|svg`：书架默认展示的卡片插图。

构建时会优先使用同 slug 的现有图片。没有 AI 卡片插图时，构建器会生成一个临时 SVG，所以缺图不会阻止构建。

如果书稿中包含豆瓣图书链接，可以尝试：

```bash
node scripts/fetch-douban-covers.mjs
```

该脚本只负责原版封面；生成的 `site/assets/covers/douban-cover-results.json` 是缓存，不提交。

### 5. 构建并核对这本书

每次书稿或封面修改后至少运行：

```bash
npm run build
git diff --check
```

构建成功后，确认：

```bash
test -f "dist/books/<slug>/index.html"
rg -n '"slug": "<slug>"' dist/search-index.json
```

还应打开本地页面检查：

- 书名、分类、年份和字数是否合理。
- 卡片插图、原封面悬停效果是否正确。
- 章节目录能否跳转，正文有没有明显排版错误。
- 新书是否出现在书架和 `dist/search-index.json`。

### 6. 提交边界

提交前再次运行 `git status --short`。一本书的常规提交通常只包含：

- `_posts/book/<年份>/YYYY-MM-DD-<slug>.md`
- `site/assets/covers/<slug>.<ext>`（如果有）
- `site/assets/ai-covers/<slug>.<ext>`（如果有）

不要把 `dist/` 或 `tmp/` 加入提交。工作区存在无关的已暂存文件时，应使用限定路径提交，不能把用户的其他改动混进来。

只维护一本书时，通常不需要修改 `scripts/build-site.mjs`、`site/assets/app.js`、`site/assets/app.css` 或部署 workflow；除非任务本身要求改变全站行为。

## 快速检查清单

- [ ] slug 稳定，并在书稿、原封面、AI 插图之间完全一致
- [ ] 文件名日期正确
- [ ] front matter 是简单单行字段
- [ ] EPUB 导入内容已经人工清理
- [ ] 标题层级和目录正确
- [ ] `npm run build` 成功
- [ ] 阅读页与搜索索引都已生成
- [ ] `git diff --check` 通过
- [ ] 提交中没有混入 `dist/`、`tmp/` 或用户的无关修改

## 本地预览

构建静态页面需要 Node.js：

```bash
npm run build
```

构建完成后，静态文件会生成到 `dist/`。正文朗读需要 Python TTS 服务，首次使用先安装依赖：

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm run serve
```

预览地址为 `http://127.0.0.1:4173/`。该服务同时提供静态页面和 `/api/tts`，音色固定为 `zh-CN-XiaoxiaoNeural`。

如果要模拟旧的 GitHub Pages `/read/` 子路径：

```bash
BASE_PATH=/read npm run build
```

## 部署

GitHub Pages 入口：

[https://read.delia.love/](https://read.delia.love/)

部署方式：

- 推送到 `main` 分支后，`.github/workflows/deploy.yml` 会自动运行。
- workflow 使用 Node.js 构建 `dist/`，并通过 GitHub Pages 发布。
- `site/CNAME` 会在构建时复制到 `dist/CNAME`，用于保持 GitHub Pages 的自定义域名配置。
- 仓库已经改成 public，GitHub Pages 可以对外访问。

注意：GitHub Pages 只托管静态文件，线上朗读需要另行部署 `scripts/serve-site.py` 或将 `/api/tts` 接到可运行 Python 的服务。

如果页面暂时打不开，通常是 GitHub Pages 设置或 Actions 还没跑完：

- 到仓库 `Settings -> Pages` 确认 source 使用 `GitHub Actions`。
- 到 `Actions` 页面查看 `Deploy static library` 是否成功。

## 技术选择

当前页面主体是静态站点：

- 构建：Node.js 脚本
- 内容源：Markdown 文件
- 页面：构建时生成 HTML
- 交互：原生 JavaScript
- 样式：原生 CSS
- 托管：GitHub Pages
- 本地朗读服务：Python + `rany2/edge-tts`

这个结构的重点是让维护成本尽量低：你只管写和整理 Markdown，展示层由生成器负责。
