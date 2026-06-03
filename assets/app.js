const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
const basePath = document.body?.dataset.basePath || "";
const withBase = (url) => `${basePath}${url}`;

function initTheme() {
  const button = $("[data-theme-toggle]");
  if (!button) return;

  button.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("theme", next);
  });
}

function initLibraryFilters() {
  const input = $("[data-search]");
  const grid = $("[data-book-grid]");
  const count = $("[data-result-count]");
  if (!input || !grid || !count) return;

  let year = "all";
  let globalIndex = null;
  const initialHtml = grid.innerHTML;
  const initialCards = $$(".book-card", grid);
  const totalSize = Number(grid.dataset.totalCount || initialCards.length);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function renderCard(post) {
    return `<article class="book-card" data-title="${escapeHtml(post.title.toLowerCase())}" data-year="${post.year}" data-category="${escapeHtml(post.category.toLowerCase())}" data-tagline="${escapeHtml(post.tagline)}">
      <a class="book-card-link" href="${withBase(`/books/${post.slug}/`)}">
        <figure class="book-cover">
          <img src="${escapeHtml(withBase(post.cover))}" alt="${escapeHtml(post.title)} 插图" loading="lazy">
          <figcaption>${escapeHtml(post.tagline)}</figcaption>
        </figure>
        <div class="book-info">
          <span class="book-year">${post.year}</span>
          <h2>${escapeHtml(post.title)}</h2>
        </div>
        <div class="book-meta">
          <span>${escapeHtml(post.category)}</span>
          <span>${Number(post.wordCount || 0).toLocaleString("zh-CN")} 字</span>
        </div>
      </a>
    </article>`;
  }

  async function getIndex() {
    if (!globalIndex) {
      const response = await fetch(withBase("/search-index.json"));
      globalIndex = await response.json();
    }
    return globalIndex;
  }

  function filterCards(cards, sourceSize, query) {
    let visible = 0;

    cards.forEach((card) => {
      const matchesQuery = !query || `${card.dataset.title} ${card.dataset.year} ${card.dataset.category}`.includes(query);
      const matchesYear = year === "all" || card.dataset.year === year;
      const show = matchesQuery && matchesYear;
      card.hidden = !show;
      if (show) visible += 1;
    });

    count.textContent = `${visible} / ${sourceSize}`;
  }

  async function apply() {
    const query = input.value.trim().toLowerCase();

    if (!query) {
      if (grid.dataset.mode === "search") {
        grid.innerHTML = initialHtml;
        grid.dataset.mode = "page";
      }
      filterCards($$(".book-card", grid), totalSize, query);
      return;
    }

    const index = await getIndex();
    const matched = index.filter((post) => {
      const haystack = `${post.title} ${post.category} ${post.year} ${post.description}`.toLowerCase();
      return haystack.includes(query) && (year === "all" || post.year === year);
    });

    grid.dataset.mode = "search";
    grid.innerHTML = matched.map(renderCard).join("");
    count.textContent = `${matched.length} / ${index.length}`;
  }

  input.addEventListener("input", apply);
  $$("[data-filter-year]").forEach((button) => {
    button.addEventListener("click", () => {
      year = button.dataset.filterYear;
      $$("[data-filter-year]").forEach((item) => item.classList.toggle("active", item === button));
      apply();
    });
  });
}

function initReader() {
  const article = $(".article-content");
  const progress = $("[data-reading-progress]");
  const roots = $$(".toc-list > .toc-item");
  if (!article) return;

  const headings = $$("h1[id], h2[id], h3[id], h4[id]", article);
  const index = new Map(headings.map((heading, idx) => [heading.id, idx]));

  function update() {
    if (progress) {
      const rect = article.getBoundingClientRect();
      const total = Math.max(1, rect.height - window.innerHeight * 0.72);
      const read = Math.min(1, Math.max(0, -rect.top / total));
      progress.style.transform = `scaleX(${read})`;
    }

    if (!headings.length || !roots.length) return;

    let active = headings[0];
    headings.forEach((heading) => {
      if (heading.getBoundingClientRect().top <= 132) active = heading;
    });

    const activeIndex = index.get(active.id);
    roots.forEach((root) => {
      const rootIndex = index.get(root.dataset.headingId);
      const next = root.nextElementSibling ? index.get(root.nextElementSibling.dataset.headingId) : null;
      const inSection = activeIndex >= rootIndex && (next == null || activeIndex < next);

      root.classList.toggle("is-current-section", inSection);
      root.classList.toggle("is-active", root.dataset.headingId === active.id);
      $$("li", root).forEach((item) => item.classList.toggle("is-active", item.dataset.headingId === active.id));
    });
  }

  update();
  window.addEventListener("scroll", update, { passive: true });
}

initTheme();
initLibraryFilters();
initReader();
