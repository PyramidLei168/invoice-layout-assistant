/**
 * PDF 处理（浏览器端，基于 pdf.js）
 *
 * 全部在本地完成：PDF → PNG 图片 + 提取文字层识别金额。
 * 文件不会上传到任何服务器。
 */

import * as pdfjsLib from "./vendor/pdf.min.mjs";
import { extractAmount, textFromItems } from "./amount.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "./vendor/pdf.worker.min.mjs",
  import.meta.url
).href;

/** 把 PDF 的第 pageNo 页渲染成 PNG blob */
async function renderPage(pdf, pageNo, dpi) {
  const page = await pdf.getPage(pageNo);
  // 1 CSS px = 1/96 inch；scale = dpi / 72
  const scale = dpi / 72;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/png")
  );
  canvas.width = canvas.height = 0; // 释放显存
  return blob;
}

/**
 * 取某页文字层并识别金额。
 *
 * 注意：部分铁路电子客票的 PDF 使用 GBK-EUC-H 编码且缺少 Unicode
 * 映射（ToUnicode），文字层无法解码（表现为「无文字层」）。这是格式
 * 限制，这类票需要用户手动填写金额。
 */
async function amountOfPage(pdf, pageNo) {
  try {
    const page = await pdf.getPage(pageNo);
    const tc = await page.getTextContent();
    const text = textFromItems(tc.items);
    if (!text.trim()) return { amount: null, source: "无文字层" };
    return extractAmount(text);
  } catch {
    return { amount: null, source: "无文字层" };
  }
}

function blobToFile(blob, name) {
  return new File([blob], name, { type: blob.type });
}

/** 单个文件（PDF / 图片）→ 一组页面项 */
export async function convertFile(file, { dpi = 200, wantAmount = true } = {}) {
  const isPdf =
    file.type === "application/pdf" || /\.pdf$/i.test(file.name);

  if (!isPdf) {
    // 图片：直接用原图
    const img = await createImageBitmap(file);
    const w = img.width;
    const h = img.height;
    img.close?.();
    return [
      {
        url: URL.createObjectURL(file),
        blob: file,
        w,
        h,
        rot: 0,
        amount: null,
        amountSource: "图片",
      },
    ];
  }

  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const blob = await renderPage(pdf, i, dpi);
    const img = await createImageBitmap(blob);
    const w = img.width;
    const h = img.height;
    img.close?.();

    let amount = null;
    let amountSource = "";
    if (wantAmount) {
      const r = await amountOfPage(pdf, i);
      amount = r.amount;
      amountSource = r.source;
    }

    out.push({
      url: URL.createObjectURL(blob),
      blob,
      w,
      h,
      rot: 0,
      amount,
      amountSource,
    });
  }
  await pdf.destroy();
  return out;
}

/** 自然排序：27.pdf 排在 28.pdf 前面，而不是 27 在 8 前面 */
export function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), "zh", { numeric: true });
}

const IMAGE_RE = /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i;
const ZIP_RE = /\.zip$/i;

/** ZIP 批量解压（仅取其中的发票文件） */
async function convertZip(file, opts) {
  if (typeof JSZip === "undefined") {
    throw new Error("ZIP 支持需要加载 JSZip 库");
  }
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const names = Object.keys(zip.files)
    .filter(
      (n) =>
        !zip.files[n].dir &&
        !n.startsWith(".") &&
        !n.startsWith("__MACOSX") &&
        (n.toLowerCase().endsWith(".pdf") || IMAGE_RE.test(n))
    )
    .sort((a, b) => naturalCompare(a.split("/").pop(), b.split("/").pop()));

  if (!names.length) throw new Error("ZIP 里没有找到 PDF 或图片文件");
  if (names.length > 300) throw new Error("ZIP 内文件过多（>300），请拆分后再拖入");

  const files = [];
  const errors = [];
  for (const name of names) {
    const base = name.split("/").pop();
    try {
      const buf = await zip.files[name].async("blob");
      const f = new File([buf], base);
      files.push({ name: base, pages: await convertFile(f, opts) });
    } catch (e) {
      errors.push(`${base}: ${e.message}`);
    }
  }
  return { files, errors };
}

/**
 * 批量转换入口。
 * @returns {Promise<{files: Array<{name:string, pages:Array}>, errors: string[]}>}
 */
export async function convertFiles(fileList, opts = {}) {
  const files = [...fileList]
    .filter((f) => /\.(pdf|zip|png|jpe?g|webp|bmp|gif|tiff?)$/i.test(f.name))
    .sort((a, b) => naturalCompare(a.name, b.name));

  if (!files.length) {
    throw new Error("只支持 PDF、图片和 zip 文件");
  }

  const out = [];
  const errors = [];
  for (const f of files) {
    try {
      if (ZIP_RE.test(f.name)) {
        const r = await convertZip(f, opts);
        out.push(...r.files);
        errors.push(...r.errors);
      } else {
        out.push({ name: f.name, pages: await convertFile(f, opts) });
      }
    } catch (e) {
      errors.push(`${f.name}: ${e.message}`);
    }
  }
  return { files: out, errors };
}