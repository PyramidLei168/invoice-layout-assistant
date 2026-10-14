/**
 * 字体加载 —— 解决「PDF 未内嵌中文字体导致文字渲染不出来」
 *
 * 背景：铁路电子客票等 PDF 使用 GBK-EUC-H 编码的中文字体（楷体/宋体/黑体）
 * 且**未内嵌**（emb=no）。pdf.js 既没有字体数据、也读不出 Unicode，
 * 结果就是：印章和二维码正常显示，文字全部消失。
 *
 * 解决方案：把中文字体子集（仅 ~900 个常用字，约 350KB）注入浏览器，
 * 再把它注册为 pdf.js 的「标准字体」，让 pdf.js 用它来兜底渲染。
 *
 * 目录说明：
 *   fonts/cmaps/          pdf.js 官方中文编码映射表（必需）
 *   fonts/standard_fonts/ pdf.js 官方西文标准字体
 *   fonts/custom/         我们做好的中文子集字体
 */

import * as pdfjsLib from "./vendor/pdf.min.mjs";

const BASE = "fonts/";
const CJK_FONTS = [
  // 优先用衬线（宋体/楷体），更贴近发票票面
  { url: `${BASE}custom/cjk-serif-subset.ttf`, css: "FPKai", label: "中文衬线" },
  { url: `${BASE}custom/cjk-sans-subset.ttf`, css: "FPSans", label: "中文无衬线" },
];

let initialized = false;

/** 用 FontFace API 把字体装进浏览器，并注册为 pdf.js 可见的 family */
async function installCjkFonts() {
  for (const f of CJK_FONTS) {
    try {
      const face = new FontFace(f.css, `url(${f.url}) format("truetype")`);
      await face.load();
      document.fonts.add(face);
      f.loaded = true;
    } catch (e) {
      console.warn(`字体加载失败 ${f.label}:`, e);
      f.loaded = false;
    }
  }
}

/**
 * 初始化 pdf.js 的字体与 CMap。必须在首次 getDocument 之前调用。
 * @param {Function} onProgress 回调，报告加载进度（0~1）
 */
export function initPdfJs(onProgress) {
  if (initialized) return;
  initialized = true;

  const G = pdfjsLib.GlobalWorkerOptions;
  G.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
  G.standardFontDataUrl = new URL(`${BASE}standard_fonts/`, import.meta.url).href;
  G.cMapUrl = new URL(`${BASE}cmaps/`, import.meta.url).href;
  G.cMapPacked = true;
  // 允许回退到系统字体：未内嵌字体的 PDF 需要浏览器用本机字体补上字形
  G.useSystemFonts = true;

  installCjkFonts().then(() => onProgress && onProgress(1));
}

/**
 * pdf.js 在缺少内嵌字体时会回落到这些 family 名。
 * 我们把中文字体注册成同名（或通过 CSS alias）以便命中。
 */
export function registerFontAliases() {
  // 告诉浏览器：PDF 里出现的这些字体名，实际用我们注入的字体渲染
  const style = document.createElement("style");
  style.textContent = `
    @font-face { font-family: KaiTi; src: local("FPKai"); }
    @font-face { font-family: SimSun; src: local("FPKai"); }
    @font-face { font-family: SimHei; src: local("FPSans"); }
    @font-face { font-family: STSong; src: local("FPKai"); }
  `;
  document.head.appendChild(style);
}

/** 字体是否就绪（用于界面提示） */
export function fontsReady() {
  return CJK_FONTS.some((f) => f.loaded);
}

export { pdfjsLib };