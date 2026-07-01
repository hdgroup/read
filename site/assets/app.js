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
  const synth = window.speechSynthesis;

  if (!synth || typeof window.SpeechSynthesisUtterance === "undefined") {
    toggle.disabled = true;
    rateSelect.disabled = true;
    voiceBadge.textContent = "浏览器不支持";
    status.textContent = "当前浏览器不支持正文朗读";
    return;
  }

  const blocks = $$("h1, h2, h3, h4, p, li, blockquote", article)
    .filter((element) => element.textContent.trim());
  const units = blocks.flatMap((element) => splitSpeechText(element.textContent)
    .map((text) => ({ text, element })));

  let voices = [];
  let selectedVoice = null;
  let currentIndex = 0;
  let activeElement = null;
  let currentUtterance = null;
  let isSpeaking = false;
  let isPaused = false;
  let runId = 0;

  function splitSpeechText(value, maxLength = 220) {
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

  function voiceScore(voice) {
    const name = voice.name.toLowerCase();
    const lang = voice.lang.toLowerCase();
    if (name.includes("xiaoxiao") || name.includes("晓晓")) return 100;
    if (name.includes("microsoft") && lang.startsWith("zh-cn")) return 80;
    if (lang.startsWith("zh-cn")) return 60;
    if (lang.startsWith("zh")) return 40;
    return 0;
  }

  function refreshVoices() {
    voices = synth.getVoices();
    selectedVoice = [...voices]
      .filter((voice) => voiceScore(voice) > 0)
      .sort((a, b) => voiceScore(b) - voiceScore(a))[0] || null;

    if (!selectedVoice) {
      if (voices.length) {
        voiceBadge.textContent = "系统默认";
        voiceBadge.title = "当前浏览器未提供微软晓晓或其他中文音色";
      }
      return;
    }
    const isXiaoxiao = /xiaoxiao|晓晓/i.test(selectedVoice.name);
    voiceBadge.textContent = isXiaoxiao ? "微软晓晓" : "中文语音";
    voiceBadge.title = isXiaoxiao
      ? `当前音色：${selectedVoice.name}`
      : `未找到微软晓晓，当前使用：${selectedVoice.name}`;
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
    toggle.setAttribute("aria-pressed", String(isSpeaking && !isPaused));
    toggle.classList.toggle("is-active", isSpeaking);
    stop.disabled = !isSpeaking;
    icon.textContent = isSpeaking && !isPaused ? "Ⅱ" : "▶";
    label.textContent = !isSpeaking ? "朗读正文" : isPaused ? "继续朗读" : "暂停";
    status.textContent = message;
  }

  function finish(message = "朗读完成") {
    isSpeaking = false;
    isPaused = false;
    currentIndex = 0;
    currentUtterance = null;
    setActiveElement(null);
    updateControls(message);
  }

  function speakCurrent(id) {
    if (id !== runId || !isSpeaking) return;
    if (currentIndex >= units.length) {
      finish();
      return;
    }

    const unit = units[currentIndex];
    const utterance = new SpeechSynthesisUtterance(unit.text);
    currentUtterance = utterance;
    utterance.lang = "zh-CN";
    utterance.rate = Number(rateSelect.value) || 2;
    if (selectedVoice) utterance.voice = selectedVoice;

    utterance.onstart = () => {
      if (id !== runId) return;
      setActiveElement(unit.element);
      const progress = Math.min(100, Math.round(((currentIndex + 1) / units.length) * 100));
      updateControls(`正在朗读 · ${progress}% · ${rateSelect.value} 倍速`);
    };
    utterance.onend = () => {
      if (id !== runId || !isSpeaking) return;
      currentUtterance = null;
      currentIndex += 1;
      speakCurrent(id);
    };
    utterance.onerror = (event) => {
      if (id !== runId || event.error === "canceled" || event.error === "interrupted") return;
      currentUtterance = null;
      finish("朗读暂时中断，请重试");
    };

    synth.speak(utterance);
  }

  function start() {
    if (!units.length) {
      status.textContent = "这页没有可朗读的正文";
      return;
    }
    refreshVoices();
    isSpeaking = true;
    isPaused = false;
    runId += 1;
    updateControls(`正在启动 · ${rateSelect.value} 倍速`);
    speakCurrent(runId);
  }

  function pause() {
    synth.pause();
    isPaused = true;
    updateControls(`已暂停 · ${rateSelect.value} 倍速`);
  }

  function resume() {
    synth.resume();
    isPaused = false;
    updateControls(`继续朗读 · ${rateSelect.value} 倍速`);
  }

  function stopReading() {
    runId += 1;
    synth.cancel();
    finish(`已停止 · 准备以 ${rateSelect.value} 倍速朗读`);
  }

  toggle.addEventListener("click", () => {
    if (!isSpeaking) start();
    else if (isPaused) resume();
    else pause();
  });
  stop.addEventListener("click", stopReading);
  rateSelect.addEventListener("change", () => {
    status.textContent = isSpeaking
      ? `速度已设为 ${rateSelect.value} 倍，将从下一段生效`
      : `准备以 ${rateSelect.value} 倍速朗读`;
  });
  window.addEventListener("beforeunload", () => synth.cancel());
  synth.addEventListener?.("voiceschanged", refreshVoices);

  refreshVoices();
}

initTheme();
initReader();
initSpeechReader();
