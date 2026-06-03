# Read

一个由 Markdown 书稿自动生成的静态阅读站点。

在线访问：[https://hdgroup.github.io/read/](https://hdgroup.github.io/read/)

源码仓库：[https://github.com/hdgroup/read](https://github.com/hdgroup/read)

## 现在做了什么

这个仓库已经从原来的 Jekyll 站点整理成了更轻的静态站点生成项目：

- 保留 `_posts/book/**` 下的 131 篇 Markdown 书稿，移除了旧站点里的非书籍文章、Jekyll 模板、Ruby 依赖、旧 assets 和 `_site` 生成物。
- 新增 `scripts/build-site.mjs`，用 Node.js 直接把 Markdown 书稿生成静态 HTML，不再依赖 Jekyll、Ruby、接口服务或数据库。
- 新增书籍列表页，以“一本书一本书”的卡片形式展示全部书稿，支持搜索、分类筛选、分页、封面和悬停简介。
- 新增阅读页，右侧展示目录；默认显示章节目录，滚动到某一章时自动展开该章的二级目录，并同步阅读进度。
- 为每本书补齐封面素材：优先使用豆瓣封面，找不到时使用 AI 生成插图。封面统一放在 `site/assets/covers/`。
- 新增 GitHub Pages 部署 workflow，推送到 `main` 后自动构建并发布到 `/read/`。

## 目录结构

```text
.
├── _posts/book/              # Markdown 书稿，只维护这里的内容即可
├── site/assets/app.css       # 站点样式
├── site/assets/app.js        # 搜索、筛选、目录联动等前端交互
├── site/assets/covers/       # 书籍封面，文件名使用书稿 slug
├── scripts/build-site.mjs    # 静态站点生成器
├── scripts/fetch-douban-covers.mjs
├── .github/workflows/deploy.yml
├── package.json
└── README.md
```

`dist/` 是本地构建产物，不提交到 `main` 分支。

## 日常维护

以后主要维护 Markdown 书稿：

1. 在 `_posts/book/年份/` 下新增或修改 Markdown 文件。
2. 文件名建议继续使用 `YYYY-MM-DD-slug.md`，其中 `slug` 会作为阅读页地址的一部分。
3. 书稿 front matter 里至少保留标题，例如：

```markdown
---
title: 混沌：开创新科学
date: 2025-07-23
categories: book
---

# 第一章

正文内容……
```

4. 如果要手动指定封面，把图片放到 `site/assets/covers/slug.jpg`、`slug.png` 或 `slug.webp`。`slug` 需要和 Markdown 文件名里的 slug 一致。
5. 如果没有封面，构建器会先生成可用页面；后续可以运行封面脚本或补一张 AI 插图。

## 本地预览

项目不需要安装第三方依赖，机器上有 Node.js 即可。

```bash
npm run build
```

构建完成后，静态文件会生成到 `dist/`。可以用任意静态服务器预览，例如：

```bash
npx serve dist
```

如果要模拟 GitHub Pages 的 `/read/` 子路径：

```bash
BASE_PATH=/read npm run build
```

## 部署

GitHub Pages 入口：

[https://hdgroup.github.io/read/](https://hdgroup.github.io/read/)

部署方式：

- 推送到 `main` 分支后，`.github/workflows/deploy.yml` 会自动运行。
- workflow 使用 Node.js 构建 `dist/`，并通过 GitHub Pages 发布。
- 仓库已经改成 public，GitHub Pages 可以对外访问。

如果页面暂时打不开，通常是 GitHub Pages 设置或 Actions 还没跑完：

- 到仓库 `Settings -> Pages` 确认 source 使用 `GitHub Actions`。
- 到 `Actions` 页面查看 `Deploy static library` 是否成功。

## 封面维护

封面规则：

- 优先使用 `site/assets/covers/<slug>.jpg`
- 其次尝试 `.png`、`.webp`
- 找不到时会使用生成器内置的默认封面样式

如果 Markdown front matter 里有豆瓣链接，可以运行：

```bash
node scripts/fetch-douban-covers.mjs
```

脚本会尝试从豆瓣页面提取封面并保存到 `site/assets/covers/`。结果缓存文件 `site/assets/covers/douban-cover-results.json` 不提交。

## 技术选择

当前站点是零运行时后端的静态站点：

- 构建：Node.js 脚本
- 内容源：Markdown 文件
- 页面：构建时生成 HTML
- 交互：原生 JavaScript
- 样式：原生 CSS
- 托管：GitHub Pages

这个结构的重点是让维护成本尽量低：你只管写和整理 Markdown，展示层由生成器负责。
