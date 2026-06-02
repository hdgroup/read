(function () {
  function slugify(text, index) {
    return "toc-" + index + "-" + text.toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function getChapterLevel(headings) {
    var h1Count = headings.filter(function (heading) {
      return heading.tagName.toLowerCase() === "h1";
    }).length;

    return h1Count >= 2 ? 1 : 2;
  }

  function makeLink(heading) {
    var link = document.createElement("a");
    link.className = "book-toc-link";
    link.href = "#" + heading.id;
    link.textContent = heading.textContent.trim();
    return link;
  }

  function buildToc(headings, chapterLevel) {
    var roots = [];
    var currentRoot = null;

    headings.forEach(function (heading) {
      var level = Number(heading.tagName.slice(1));

      if (level <= chapterLevel || !currentRoot) {
        currentRoot = {
          heading: heading,
          children: []
        };
        roots.push(currentRoot);
      } else if (level === chapterLevel + 1) {
        currentRoot.children.push(heading);
      }
    });

    return roots;
  }

  function renderToc(roots, target) {
    var list = document.createElement("ol");
    list.className = "book-toc-list";

    roots.forEach(function (root) {
      var item = document.createElement("li");
      item.className = "book-toc-item";
      item.dataset.headingId = root.heading.id;
      item.appendChild(makeLink(root.heading));

      if (root.children.length) {
        var children = document.createElement("ol");
        children.className = "book-toc-children";

        root.children.forEach(function (child) {
          var childItem = document.createElement("li");
          childItem.className = "book-toc-item book-toc-child";
          childItem.dataset.headingId = child.id;
          childItem.appendChild(makeLink(child));
          children.appendChild(childItem);
        });

        item.appendChild(children);
      }

      list.appendChild(item);
    });

    target.appendChild(list);
  }

  function updateActiveState(headings, rootItems) {
    var activeHeading = headings[0];
    var topOffset = 120;
    var headingIndex = new Map();

    headings.forEach(function (heading, index) {
      headingIndex.set(heading.id, index);
    });

    headings.forEach(function (heading) {
      if (heading.getBoundingClientRect().top <= topOffset) {
        activeHeading = heading;
      }
    });

    rootItems.forEach(function (item) {
      var rootId = item.dataset.headingId;
      var activeIndex = headingIndex.get(activeHeading.id);
      var rootIndex = headingIndex.get(rootId);
      var nextRoot = item.nextElementSibling
        ? headingIndex.get(item.nextElementSibling.dataset.headingId)
        : null;
      var inSection = activeIndex >= rootIndex && (nextRoot === null || activeIndex < nextRoot);

      item.classList.toggle("is-current-section", inSection);
      item.classList.toggle("is-active", rootId === activeHeading.id);

      Array.prototype.forEach.call(item.querySelectorAll(".book-toc-child"), function (child) {
        child.classList.toggle("is-active", child.dataset.headingId === activeHeading.id);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var article = document.querySelector(".article-content");
    var target = document.getElementById("book-toc");

    if (!article || !target) {
      return;
    }

    var headings = Array.prototype.slice.call(article.querySelectorAll("h1, h2, h3"))
      .filter(function (heading) {
        return heading.textContent.trim();
      });

    if (!headings.length) {
      target.parentNode.style.display = "none";
      return;
    }

    headings.forEach(function (heading, index) {
      if (!heading.id) {
        heading.id = slugify(heading.textContent.trim(), index);
      }
    });

    var chapterLevel = getChapterLevel(headings);
    var tocRoots = buildToc(headings, chapterLevel);
    renderToc(tocRoots, target);

    var rootItems = Array.prototype.slice.call(target.querySelectorAll(".book-toc-list > .book-toc-item"));
    updateActiveState(headings, rootItems);
    window.addEventListener("scroll", function () {
      updateActiveState(headings, rootItems);
    }, { passive: true });
  });
})();
