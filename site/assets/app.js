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
initReader();
