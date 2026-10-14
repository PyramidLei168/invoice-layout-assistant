/**
 * 发票拼版助手 —— 浏览器端主逻辑
 *
 * 所有处理（PDF 转换 / 金额识别 / 导出）都在本机浏览器内完成，
 * 不上传任何数据到服务器。
 */

import { convertFiles } from "./pdf.js";
import { buildDocx } from "./docx.js";
import { renderPagesToBlobs, packZip } from "./export.js";
import { openInNativeViewer, GUIDE_TEXT } from "./native.js";

const $ = (s) => document.querySelector(s);
const PW = 21, PH = 29.7;                 // A4（厘米）
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ================= 状态 ================= */

const state = {
  items: [],      // {id, seq, name, url, blob, nw, nh, price, amountSource, auto, rot, inLayout, page, x, y, w, h}
  sel: null,
  seq: 0,
  params: { width: 9, gap: 0.4, margin: 1.2, cols: 0, dpi: 200, autoAmt: true },
};

try {
  Object.assign(state.params, JSON.parse(localStorage.getItem("fp_params") || "{}"));
} catch {}

const saveParams = () => {
  try { localStorage.setItem("fp_params", JSON.stringify(state.params)); } catch {}
};

const getItem = (id) => state.items.find((i) => i.id === id);
const aspect = (it) => {
  const a = it.nw / it.nh;
  return it.rot % 180 ? 1 / a : a;
};
const rotUrl = (it) => (it.rot ? `${it.url}#r${it.rot}` : it.url);

function pageSummaryText(items) {
  const total = items.reduce((s, i) => s + (Number(i.price) || 0), 0);
  return `本页 ${items.length} 张` + (total > 0 ? ` · 合计 ¥${total.toFixed(2)}` : "");
}

/* ================= 自动排版 ================= */

function autoLayout() {
  const p = state.params;
  const m = p.margin, gap = p.gap;
  const availW = PW - 2 * m, availH = PH - 2 * m;
  const w = Math.max(2, Math.min(p.width, availW));

  const list = state.items.filter((i) => i.inLayout).sort((a, b) => a.seq - b.seq);
  if (!list.length) return;

  let page = 0, y = m, rowH = 0, row = [];
  const rowW = () => (row.length ? row.reduce((s, r) => s + r.w, 0) + gap * (row.length - 1) : 0);

  function placeRow() {
    if (rowH > availH) {
      const k = availH / rowH;
      row.forEach((r) => { r.w *= k; r.h *= k; });
      rowH *= k;
    }
    if (y + rowH > PH - m) { page += 1; y = m; }
    let sx = m + (availW - rowW()) / 2;
    row.forEach((r) => { r.page = page; r.x = sx; r.y = y; sx += r.w + gap; });
    y += rowH + gap;
    row = []; rowH = 0;
  }

  for (const it of list) {
    it.w = w;
    it.h = w / aspect(it);
    const full = p.cols > 0
      ? row.length >= p.cols
      : row.length > 0 && rowW() + gap + it.w > availW + 1e-6;
    if (row.length && full) placeRow();
    row.push(it);
    rowH = Math.max(rowH, it.h);
    if (p.cols > 0 && row.length === p.cols) placeRow();
  }
  if (row.length) placeRow();
}

/* ================= 渲染 ================= */

const pagesEl = $("#pages");

function render() {
  renderPages();
  renderLibrary();
  renderStatus();
  fitPreview();
}

function renderStatus() {
  const inLay = state.items.filter((i) => i.inLayout);
  const nPages = inLay.length ? Math.max(...inLay.map((i) => i.page)) + 1 : 0;
  const total = inLay.reduce((s, i) => s + (Number(i.price) || 0), 0);
  $("#libCount").textContent = state.items.length;

  let text = state.items.length
    ? `共 ${state.items.length} 张发票，排在 ${nPages} 页 A4 上${total > 0 ? ` · 合计 ¥${total.toFixed(2)}` : ""}`
    : "就绪";
  if (inLay.length) {
    const autoN = inLay.filter((i) => i.auto).length;
    const missN = inLay.filter((i) => !(Number(i.price) > 0)).length;
    const nativeN = inLay.filter((i) => i.needsNative).length;
    text += ` ｜ 自动识别 ${autoN}`;
    if (missN > 0) text += `，${missN} 张待填`;
    if (nativeN > 0) text += `，${nativeN} 张需另存为图片`;
  }
  $("#status").textContent = text;
}

function renderPages() {
  pagesEl.innerHTML = "";
  const items = state.items.filter((i) => i.inLayout);
  const nPages = items.length ? Math.max(...items.map((i) => i.page)) + 1 : 0;
  $("#empty").hidden = nPages > 0;

  for (let p = 0; p < nPages; p++) {
    const pageDiv = document.createElement("div");
    pageDiv.className = "page";
    pageDiv.dataset.page = p;

    const label = document.createElement("div");
    label.className = "page-label";
    label.textContent = `第 ${p + 1} 页 / 共 ${nPages} 页`;
    pageDiv.appendChild(label);

    const pageItems = items.filter((i) => i.page === p);
    pageItems.forEach((it) => pageDiv.appendChild(itemEl(it)));

    const summary = document.createElement("div");
    summary.className = "page-summary";
    summary.textContent = pageSummaryText(pageItems);
    pageDiv.appendChild(summary);

    pagesEl.appendChild(pageDiv);
  }
}

function itemEl(it) {
  const d = document.createElement("div");
  d.className = "item" + (state.sel === it.id ? " sel" : "");
  if (it.needsNative) d.classList.add("item-warn");
  d.dataset.id = it.id;
  d.title = it.needsNative
    ? `${it.name}\n（这张票的文字无法解析，请用左侧的「用浏览器打开」另存为图片）`
    : it.name;
  placeStyle(d, it);

  const img = document.createElement("img");
  img.src = rotUrl(it);
  img.alt = it.name;
  img.draggable = false;
  d.appendChild(img);

  // 文字解析失败的票加个角标
  if (it.needsNative) {
    const mark = document.createElement("span");
    mark.className = "warn-mark";
    mark.textContent = "!";
    d.appendChild(mark);
  }

  const handle = document.createElement("div");
  handle.className = "handle";
  d.appendChild(handle);
  return d;
}

function placeStyle(el, it) {
  el.style.left = it.x + "cm";
  el.style.top = it.y + "cm";
  el.style.width = it.w + "cm";
  el.style.height = it.h + "cm";
}

function updateItemEl(it) {
  const el = pagesEl.querySelector(`.item[data-id="${it.id}"]`);
  if (el) placeStyle(el, it);
}

function renderLibrary() {
  const lib = $("#library");
  lib.innerHTML = "";
  $("#libEmpty").hidden = state.items.length > 0;

  [...state.items].sort((a, b) => a.seq - b.seq).forEach((it) => {
    const card = document.createElement("div");
    card.className = "lib-card";
    card.title = "单击：" + (it.inLayout ? "从排版中移出" : "重新加入排版");

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    const im = document.createElement("img");
    im.src = rotUrl(it);
    im.loading = "lazy";
    thumb.appendChild(im);

    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = it.name;
    const sub = document.createElement("div");
    sub.className = "sub";
    const badge = document.createElement("span");
    badge.className = "badge" + (it.inLayout ? "" : " off");
    badge.textContent = it.inLayout ? "✓ 已排版" : "点击加入";
    const rm = document.createElement("span");
    rm.className = "rm";
    rm.textContent = "✕";
    rm.title = "从票据库彻底删除";
    rm.onclick = (e) => {
      e.stopPropagation();
      URL.revokeObjectURL(it.url);
      state.items = state.items.filter((x) => x.id !== it.id);
      if (state.sel === it.id) state.sel = null;
      autoLayout(); render();
    };
    sub.append(badge, rm);
    meta.append(name, sub);

    // 文字层不可读的票（铁路电子客票等）：给出浏览器原生查看器的入口
    if (it.needsNative && it.srcBlob) {
      const warn = document.createElement("div");
      warn.className = "native-hint";
      const txt = document.createElement("span");
      txt.textContent = "⚠ 文字无法解析";
      const btn = document.createElement("button");
      btn.className = "btn tiny native-btn";
      btn.textContent = "浏览器打开";
      btn.title = "在新标签页用浏览器自带的 PDF 阅读器打开（能正常显示），再截图或另存为图片拖回来";
      btn.onclick = (e) => {
        e.stopPropagation();
        openInNativeViewer(it.srcBlob, it.name + ".pdf");
      };
      warn.append(txt, btn);
      card.appendChild(warn);
    }

    const priceRow = document.createElement("div");
    priceRow.className = "price-row";
    const priceInput = document.createElement("input");
    priceInput.type = "number";
    priceInput.min = "0";
    priceInput.step = "0.01";
    priceInput.className = "price-input" + (it.auto ? " auto" : "");
    const NO_TEXT_HINT = "铁路票等格式无法自动识别，请手填";
    priceInput.placeholder =
      it.amountSource === "无文字层" || it.amountSource === "未识别"
        ? NO_TEXT_HINT
        : it.amountSource && !["图片", "识别失败"].includes(it.amountSource)
          ? `自动: ${it.amountSource}`
          : "金额 ¥";
    priceInput.title = it.auto
      ? `自动识别自「${it.amountSource}」，可直接修改`
      : it.amountSource === "无文字层"
        ? "这类 PDF 未提供可读文字层（铁路电子客票常见），需手动填写金额"
        : "填发票金额，页面底部会自动汇总";
    priceInput.value = Number(it.price) > 0 ? it.price : "";
    priceInput.onclick = (e) => e.stopPropagation();
    priceInput.onchange = () => {
      it.price = parseFloat(priceInput.value) || 0;
      it.auto = false;
      priceInput.classList.remove("auto");
      render();
    };
    priceRow.appendChild(priceInput);

    card.append(thumb, meta, priceRow);
    card.onclick = () => {
      it.inLayout = !it.inLayout;
      state.sel = it.inLayout ? it.id : null;
      autoLayout(); render();
    };
    lib.appendChild(card);
  });
}

function select(id) {
  state.sel = id;
  pagesEl.querySelectorAll(".item").forEach((el) => {
    el.classList.toggle("sel", el.dataset.id === id);
  });
}

/* ================= 分隔条 & 预览缩放 ================= */

const dividerEl = $("#divider");
const A4_NATURAL_PX = 794;

function fitPreview() {
  const ws = $("#workspace");
  const z = clamp((ws.clientWidth - 70) / A4_NATURAL_PX, 0.35, 1);
  pagesEl.style.zoom = z;
}

function setSidebarWidth(px) {
  const w = clamp(px, 260, window.innerWidth - 380);
  $("#sidebar").style.width = w + "px";
  state.params.sidebarW = w;
  saveParams();
  fitPreview();
}

dividerEl.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  dividerEl.setPointerCapture(e.pointerId);
  dividerEl.classList.add("dragging");
});
dividerEl.addEventListener("pointermove", (e) => {
  if (!(e.buttons & 1)) return;
  const left = document.querySelector(".layout").getBoundingClientRect().left;
  setSidebarWidth(e.clientX - left);
});
dividerEl.addEventListener("pointerup", () => dividerEl.classList.remove("dragging"));
window.addEventListener("resize", fitPreview);

/* ================= 添加文件 ================= */

const ACCEPT = /\.(pdf|zip|png|jpe?g|webp|bmp|gif|tiff?)$/i;

async function addFiles(fileList) {
  const files = [...fileList].filter((f) => ACCEPT.test(f.name));
  if (!files.length) { toast("只支持 PDF、图片和 zip 文件"); return; }

  const { dpi, autoAmt } = state.params;
  let added = 0, recognized = 0;

  setBusy(true, `正在处理 0/${files.length} …`);

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    setBusy(true, `正在处理：${f.name}（${i + 1}/${files.length}）`);
    try {
      const r = await convertFiles([f], { dpi, wantAmount: autoAmt });
      r.errors.forEach((e) => console.warn(e));
      for (const src of r.files) {
        src.pages.forEach((pg, k) => {
          const base = src.name.replace(/\.[^.]+$/, "");
          const amt = typeof pg.amount === "number" ? pg.amount : 0;
          if (amt > 0) recognized++;
          state.items.push({
            id: uid(), seq: state.seq++,
            name: r.files.length > 1 || src.pages.length > 1 ? `${base}（第${k + 1}页）` : base,
            url: pg.url, blob: pg.blob, nw: pg.w, nh: pg.h,
            price: amt, amountSource: pg.amountSource || "", auto: amt > 0,
            // 文字层不可读的票（铁路电子客票等）需要另存为图片
            needsNative: !!pg.needsNative,
            srcBlob: /\.pdf$/i.test(src.name) ? f : null,
            rot: 0, inLayout: true,
          });
          added++;
        });
      }
    } catch (e) {
      console.error(e);
      toast(`${files[i].name}: ${e.message}`);
    }
  }

  setBusy(false);
  autoLayout();
  render();

  const miss = added - recognized;
  if (miss > 0) toast(`已加入 ${added} 张，自动识别金额 ${recognized} 个，${miss} 个需手动填写`);
  else toast(`已加入 ${added} 张，金额全部自动识别 ✓`);
}

/* ---- 拖放（含文件夹） ---- */

let dragDepth = 0;

window.addEventListener("dragenter", (e) => {
  e.preventDefault(); dragDepth++;
  $("#dropOverlay").hidden = false;
});
window.addEventListener("dragleave", (e) => {
  e.preventDefault();
  if (--dragDepth <= 0) { dragDepth = 0; $("#dropOverlay").hidden = true; }
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("#dropOverlay").hidden = true;
  const files = await collectDropped(e.dataTransfer);
  if (files.length) addFiles(files);
});

async function collectDropped(dt) {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files];

  const out = [];
  async function walk(entry, depth) {
    if (out.length > 600 || depth > 6) return;
    if (entry.isFile) {
      await new Promise((resolve) =>
        entry.file((f) => { if (ACCEPT.test(f.name)) out.push(f); resolve(); }, resolve)
      );
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((r) => reader.readEntries(r, () => r([])));
        for (const en of batch) await walk(en, depth + 1);
      } while (batch.length);
    }
  }
  for (const en of entries) await walk(en, 0);
  return out;
}

/* ================= 交互 ================= */

let drag = null;

pagesEl.addEventListener("pointerdown", (e) => {
  const itemDiv = e.target.closest(".item");
  if (!itemDiv) { select(null); return; }
  const it = getItem(itemDiv.dataset.id);
  if (!it) return;
  select(it.id);

  const rect = itemDiv.closest(".page").getBoundingClientRect();
  drag = {
    mode: e.target.closest(".handle") ? "resize" : "move",
    id: it.id, sx: e.clientX, sy: e.clientY,
    ox: it.x, oy: it.y, ow: it.w, oh: it.h,
    ppmX: rect.width / PW, ppmY: rect.height / PH,
  };
  itemDiv.setPointerCapture(e.pointerId);
  e.preventDefault();
});

window.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const it = getItem(drag.id);
  if (!it) return;
  const dx = (e.clientX - drag.sx) / drag.ppmX;
  const dy = (e.clientY - drag.sy) / drag.ppmY;

  if (drag.mode === "move") {
    it.x = clamp(drag.ox + dx, 0, PW - it.w);
    it.y = clamp(drag.oy + dy, 0, PH - it.h);
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const pd = el?.closest?.(".page");
    if (pd && +pd.dataset.page !== it.page) it.page = +pd.dataset.page;
  } else {
    it.w = clamp(drag.ow + dx, 2, PW - 2 * state.params.margin);
    it.h = it.w / aspect(it);
    it.x = clamp(it.x, 0, PW - it.w);
    it.y = clamp(it.y, 0, PH - it.h);
  }
  updateItemEl(it);
});
window.addEventListener("pointerup", () => { drag = null; });

document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, select, textarea")) return;
  const it = getItem(state.sel);
  if (!it) return;
  const step = e.shiftKey ? 1 : 0.1;
  let used = true;
  switch (e.key) {
    case "Delete": case "Backspace":
      it.inLayout = false; state.sel = null; autoLayout(); render(); break;
    case "r": case "R": rotateItem(it); break;
    case "ArrowLeft":  it.x = clamp(it.x - step, 0, PW - it.w); updateItemEl(it); break;
    case "ArrowRight": it.x = clamp(it.x + step, 0, PW - it.w); updateItemEl(it); break;
    case "ArrowUp":    it.y = clamp(it.y - step, 0, PH - it.h); updateItemEl(it); break;
    case "ArrowDown":  it.y = clamp(it.y + step, 0, PH - it.h); updateItemEl(it); break;
    default: used = false;
  }
  if (used) e.preventDefault();
});

function rotateItem(it) {
  const cx = it.x + it.w / 2, cy = it.y + it.h / 2;
  it.rot = (it.rot + 90) % 360;
  [it.w, it.h] = [it.h, it.w];
  it.x = clamp(cx - it.w / 2, 0, PW - it.w);
  it.y = clamp(cy - it.h / 2, 0, PH - it.h);
  state.sel = it.id;
  render();
}

/* ================= 导出 ================= */

function collectSpec() {
  const items = state.items.filter((i) => i.inLayout);
  if (!items.length) return null;
  const nPages = Math.max(...items.map((i) => i.page)) + 1;
  const pages = [];
  for (let p = 0; p < nPages; p++) {
    const pageItems = items.filter((i) => i.page === p);
    pages.push({
      summary: pageSummaryText(pageItems),
      items: pageItems.map((i) => ({
        blob: i.blob, x: i.x, y: i.y, w: i.w, h: i.h, name: i.name,
      })),
    });
  }
  return { pages, filename: `发票拼版-${stamp()}` };
}

function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function download(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function exportDocx(btn) {
  const spec = collectSpec();
  if (!spec) return toast("还没有排版内容，请先拖入发票");
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = "导出中…";
  try {
    const blob = await buildDocx(spec.pages);
    download(blob, spec.filename + ".docx");
    toast("已导出：" + spec.filename + ".docx");
  } catch (e) {
    toast("导出失败：" + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

async function exportImages(btn) {
  const spec = collectSpec();
  if (!spec) return toast("还没有排版内容，请先拖入发票");
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = "导出中…";
  try {
    const blobs = await renderPagesToBlobs(spec.pages, 300);
    const zip = await packZip(blobs);
    download(zip, spec.filename + ".zip");
    toast("已导出：" + spec.filename + ".zip");
  } catch (e) {
    toast("导出失败：" + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

/* ================= 提示 ================= */

function setBusy(on, text) {
  if (on) {
    if (text) $("#busyText").textContent = text;
    $("#busy").hidden = false;
  } else {
    $("#busy").hidden = true;
  }
}

let toastTimer = null;
function toast(msg) {
  $("#status").textContent = msg;
  $("#status").style.color = "#2563eb";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#status").style.color = "";
    renderStatus();
  }, 5000);
}

/* ================= 控件 ================= */

function bindControls() {
  const p = state.params;
  const uniWidth = $("#uniWidth"), gap = $("#gap"), margin = $("#margin"),
        cols = $("#cols"), dpi = $("#dpi"), autoAmt = $("#autoAmt");

  uniWidth.value = p.width; gap.value = p.gap; margin.value = p.margin;
  cols.value = p.cols; dpi.value = p.dpi; autoAmt.checked = p.autoAmt !== false;

  const sync = () => {
    $("#uniWidthVal").textContent = p.width + " cm";
    $("#gapVal").textContent = p.gap;
    $("#marginVal").textContent = p.margin;
  };
  sync();

  uniWidth.oninput = () => { p.width = +uniWidth.value; sync(); saveParams(); autoLayout(); render(); };
  gap.oninput = () => { p.gap = +gap.value; sync(); saveParams(); autoLayout(); render(); };
  margin.oninput = () => { p.margin = +margin.value; sync(); saveParams(); autoLayout(); render(); };
  cols.onchange = () => { p.cols = +cols.value; saveParams(); autoLayout(); render(); };
  dpi.onchange = () => { p.dpi = +dpi.value; saveParams(); };
  autoAmt.onchange = (e) => { p.autoAmt = e.target.checked; saveParams(); };

  $("#btnAdd").onclick = () => $("#fileInput").click();
  $("#fileInput").onchange = (e) => {
    if (e.target.files.length) addFiles(e.target.files);
    e.target.value = "";
  };

  $("#btnRelayout").onclick = () => { autoLayout(); render(); };

  $("#btnRotate").onclick = () => {
    const it = getItem(state.sel);
    if (!it) return toast("请先单击选中一张发票");
    rotateItem(it);
  };

  $("#btnDelete").onclick = () => {
    const it = getItem(state.sel);
    if (!it) return toast("请先单击选中一张发票");
    it.inLayout = false; state.sel = null; autoLayout(); render();
  };

  $("#btnClearLib").onclick = () => {
    if (!state.items.length) return;
    if (!confirm("清空票据库和全部排版？")) return;
    state.items.forEach((i) => URL.revokeObjectURL(i.url));
    state.items = []; state.sel = null; render();
  };

  $("#btnExportDocx").onclick = (e) => exportDocx(e.currentTarget);
  $("#btnExportImg").onclick = (e) => exportImages(e.currentTarget);
  $("#btnPrint").onclick = () => {
    if (!state.items.some((i) => i.inLayout)) return toast("还没有排版内容，请先拖入发票");
    window.print();
  };
}

bindControls();
if (state.params.sidebarW) {
  $("#sidebar").style.width = state.params.sidebarW + "px";
}
render();

// 供开发者/自动化测试调用的钩子（不影响使用）
window.__collectSpec = collectSpec;
window.__buildDocx = buildDocx;