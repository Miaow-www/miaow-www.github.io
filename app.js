(() => {
  const groups = window.PROMPT_CATALOG;
  const byId = (id) => document.getElementById(id);
  const cards = byId("cards");
  const detail = byId("detail");
  const status = byId("status");
  const download = byId("download");
  let activeEntry;
  let activeGroup;
  let previousTrigger;
  let appClosing = false;

  function card({ title, note, image, href }) {
    const link = document.createElement("a");
    link.className = "card";
    link.href = href;
    const img = new Image();
    img.src = image;
    img.alt = "";
    const info = document.createElement("span");
    info.className = "card-info";
    for (const [className, label] of [["card-title", title], ["card-note", note], ["card-arrow", "↗"]]) {
      if (!label) continue;
      const span = document.createElement("span");
      span.className = className;
      span.textContent = label;
      if (className === "card-arrow") span.setAttribute("aria-hidden", "true");
      info.append(span);
    }
    link.append(img, info);
    return link;
  }

  function render() {
    const [groupId, entryId] = location.hash.slice(1).split("/");
    const group = groups.find((item) => item.id === groupId);
    const entry = group?.entries.find((item) => item.id === entryId);
    const groupChanged = activeGroup !== group || !cards.hasChildNodes();
    activeGroup = group;
    activeEntry = entry;

    if (groupChanged) {
      byId("section-title").textContent = group ? group.title : "提示词分组";
      byId("back").hidden = !group;
      byId("count").textContent = group ? `${group.entries.length} 张例图` : `${groups.length} 个分组`;
      const links = group
        ? group.entries.map((item) => card({ ...item, href: `#${group.id}/${item.id}` }))
        : groups.map((item) => card({
          title: item.title, note: `${item.entries.length} 张例图`,
          image: item.entries[0]?.image || "images/greenhouse.webp", href: `#${item.id}`
        }));
      cards.replaceChildren(...links);
      if (group && links.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "这个分组还没有例图。";
        cards.append(empty);
      }
      if (group && !entry) {
        byId("section-title").focus({ preventScroll: true });
        byId("section-title").scrollIntoView({ block: "nearest" });
      }
    }

    if (!entry) {
      if (detail.open) {
        appClosing = true;
        detail.close();
      }
      return;
    }

    byId("detail-title").textContent = entry.title;
    byId("detail-group").textContent = group.title;
    byId("detail-sample").hidden = !entry.demo;
    byId("detail-image").src = entry.image;
    byId("detail-image").alt = entry.alt || entry.title;
    byId("positive").textContent = entry.positive;
    byId("negative").textContent = entry.negative || "";
    byId("negative-block").hidden = !entry.negative;
    status.textContent = "自动清除 NovelAI 元数据。";
    download.disabled = false;
    if (!detail.open) {
      previousTrigger = document.activeElement;
      detail.showModal();
      byId("close").focus({ preventScroll: true });
    }
  }

  function close() {
    if (activeGroup) location.replace(`#${activeGroup.id}`);
  }

  byId("close").addEventListener("click", close);
  detail.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  detail.addEventListener("click", (event) => { if (event.target === detail) close(); });
  detail.addEventListener("close", () => {
    if (!appClosing) close();
    appClosing = false;
    if (cards.contains(previousTrigger)) previousTrigger.focus({ preventScroll: true });
  });

  async function copy(key, field) {
    if (!activeEntry) return;
    const button = byId(`copy-${key}`);
    const value = activeEntry[key] || "";
    if (!value) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(value);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(byId(field));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand("copy")) {
        status.textContent = "已选中文字，可长按或手动复制。";
        return;
      }
      selection.removeAllRanges();
    }
    button.textContent = "已复制";
    window.setTimeout(() => { button.textContent = "复制"; }, 1100);
  }

  byId("copy-positive").addEventListener("click", () => copy("positive", "positive"));
  byId("copy-negative").addEventListener("click", () => copy("negative", "negative"));
  download.addEventListener("click", async () => {
    const entry = activeEntry;
    if (!entry) return;
    download.disabled = true;
    status.textContent = "正在清除元数据…";
    try {
      const img = byId("detail-image");
      let png;
      if (location.protocol === "file:") {
        await img.decode();
        png = await CleanImage.clean(img);
      } else {
        const response = await fetch(entry.image);
        if (!response.ok) throw new Error("image fetch failed");
        png = await CleanImage.clean(await response.blob());
      }
      CleanImage.save(png, `${entry.id}.png`);
      if (activeEntry === entry) status.textContent = "已生成净化版 PNG。";
    } catch {
      if (activeEntry === entry) status.textContent = "下载失败，请重试或换用新版浏览器。";
    } finally {
      if (activeEntry === entry) download.disabled = false;
    }
  });

  addEventListener("hashchange", render);
  render();
})();
