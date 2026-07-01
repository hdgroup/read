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

function initSpeechReader() {
  const root = $("[data-speech-reader]");
  const article = $(".article-content");
  if (!root || !article) return;

  const toggle = $("[data-speech-toggle]", root);
  const stop = $("[data-speech-stop]", root);
  const rateSelect = $("[data-speech-rate]", root);
  const label = $("[data-speech-label]", root);
  const icon = $("[data-speech-icon]", root);
  const voiceBadge = $("[data-speech-voice]", root);
  const status = $("[data-speech-status]", root);
  const audio = new Audio();
  audio.preload = "auto";
  voiceBadge.textContent = "微软晓晓";
  voiceBadge.title = "当前音色：zh-CN-XiaoxiaoNeural";

  const blocks = $$("h1, h2, h3, h4, p, li, blockquote", article)
    .filter((element) => element.textContent.trim());
  const units = blocks.flatMap((element) => splitSpeechText(element.textContent)
    .map((text) => ({ text, element })));

  let currentIndex = 0;
  let activeElement = null;
  let isReading = false;
  let isPaused = false;
  let isLoading = false;
  let runId = 0;
  let prefetchController = null;

  function splitSpeechText(value, maxLength = 420) {
    const text = value.replace(/\s+/g, " ").trim();
    if (text.length <= maxLength) return text ? [text] : [];

    const sentences = text.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [text];
    const chunks = [];
    let chunk = "";

    for (const sentence of sentences) {
      if (chunk && chunk.length + sentence.length > maxLength) {
        chunks.push(chunk.trim());
        chunk = "";
      }
      if (sentence.length > maxLength) {
        for (let offset = 0; offset < sentence.length; offset += maxLength) {
          const part = sentence.slice(offset, offset + maxLength).trim();
          if (part) chunks.push(part);
        }
      } else {
        chunk += sentence;
      }
    }
    if (chunk.trim()) chunks.push(chunk.trim());
    return chunks;
  }

  function setActiveElement(element) {
    if (activeElement === element) return;
    activeElement?.classList.remove("is-speaking");
    activeElement = element;
    activeElement?.classList.add("is-speaking");

    if (!activeElement) return;
    const rect = activeElement.getBoundingClientRect();
    if (rect.top < 96 || rect.bottom > window.innerHeight - 40) {
      activeElement.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function updateControls(message) {
    toggle.setAttribute("aria-pressed", String(isReading && !isPaused));
    toggle.classList.toggle("is-active", isReading);
    stop.disabled = !isReading;
    icon.textContent = isReading && !isPaused ? "Ⅱ" : "▶";
    label.textContent = !isReading ? "朗读正文" : isPaused ? "继续朗读" : "暂停";
    status.textContent = message;
  }

  function clearAudio() {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }

  function finish(message = "朗读完成") {
    isReading = false;
    isPaused = false;
    isLoading = false;
    currentIndex = 0;
    prefetchController?.abort();
    prefetchController = null;
    clearAudio();
    setActiveElement(null);
    updateControls(message);
  }

  function unitAudioUrl(index) {
    return withBase(`/api/tts?text=${encodeURIComponent(units[index].text)}`);
  }

  function prefetchNext(id) {
    if (currentIndex + 1 >= units.length) return;
    prefetchController?.abort();
    prefetchController = new AbortController();
    fetch(unitAudioUrl(currentIndex + 1), {
      cache: "force-cache",
      signal: prefetchController.signal
    }).then((response) => {
      if (!response.ok) throw new Error("TTS prefetch failed");
      return response.arrayBuffer();
    }).catch(() => {});
  }

  function playCurrent(id) {
    if (id !== runId || !isReading) return;
    if (currentIndex >= units.length) {
      finish();
      return;
    }

    isLoading = true;
    updateControls(`正在加载晓晓语音 · ${rateSelect.value} 倍速`);
    audio.src = unitAudioUrl(currentIndex);
    audio.playbackRate = Number(rateSelect.value) || 2;

    audio.play().then(() => {
      if (id !== runId || !isReading) {
        audio.pause();
        return;
      }
      isLoading = false;
      setActiveElement(units[currentIndex].element);
      const progress = Math.min(100, Math.round(((currentIndex + 1) / units.length) * 100));
      updateControls(`正在朗读 · ${progress}% · ${rateSelect.value} 倍速`);
      prefetchNext(id);
    }).catch((error) => {
      if (id !== runId || error.name === "AbortError") return;
      const message = error.name === "NotAllowedError"
        ? "浏览器阻止了音频播放，请重新点击朗读"
        : "晓晓朗读服务不可用，请确认 TTS 服务已启动";
      finish(message);
    });
  }

  function start() {
    if (!units.length) {
      status.textContent = "这页没有可朗读的正文";
      return;
    }
    isReading = true;
    isPaused = false;
    runId += 1;
    updateControls(`正在启动 · ${rateSelect.value} 倍速`);
    playCurrent(runId);
  }

  function pause() {
    audio.pause();
    isPaused = true;
    updateControls(`已暂停 · ${rateSelect.value} 倍速`);
  }

  async function resume() {
    isPaused = false;
    if (isLoading) {
      updateControls(`正在加载晓晓语音 · ${rateSelect.value} 倍速`);
      return;
    }
    if (!audio.getAttribute("src")) {
      playCurrent(runId);
      return;
    }
    audio.playbackRate = Number(rateSelect.value) || 2;
    try {
      await audio.play();
      updateControls(`继续朗读 · ${rateSelect.value} 倍速`);
    } catch {
      finish("浏览器阻止了音频播放，请重新点击朗读");
    }
  }

  function stopReading() {
    runId += 1;
    finish(`已停止 · 准备以 ${rateSelect.value} 倍速朗读`);
  }

  audio.addEventListener("ended", () => {
    if (!isReading) return;
    currentIndex += 1;
    playCurrent(runId);
  });
  audio.addEventListener("error", () => {
    if (isReading && !isLoading) finish("音频播放失败，请重试");
  });
  toggle.addEventListener("click", () => {
    if (!isReading) start();
    else if (isPaused) resume();
    else pause();
  });
  stop.addEventListener("click", stopReading);
  rateSelect.addEventListener("change", () => {
    audio.playbackRate = Number(rateSelect.value) || 2;
    status.textContent = isReading
      ? `速度已设为 ${rateSelect.value} 倍`
      : `准备以 ${rateSelect.value} 倍速朗读`;
  });
  window.addEventListener("beforeunload", stopReading);
}

initTheme();
initReader();
initSpeechReader();
