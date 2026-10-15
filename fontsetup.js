/**
 * pdf.js 运行配置
 *
 * 背景：铁路电子客票等 PDF 使用 GBK-EUC-H 编码的中文字体（楷体/宋体/黑体）
 * 且**未内嵌**（emb=no）。如果不给 pdf.js 提供 CMap，它无法把 GBK 字节
 * 解码成 Unicode，结果就是「印章和二维码正常、文字全部消失」。
 *
 * 因此这里只做三件事：
 *   1. 指定 worker（必须）
 *   2. 指定 cMapUrl —— 解决 GBK/Big5 等中文编码解码（关键）
 *   3. 指定 standardFontDataUrl —— 补齐标准西文字体
 *
 * 刻意「不」做的事：注入自定义中文字体。
 * 曾经试过用 FontFace 注册中文子集并把 PDF 里的 KaiTi/SimSun/SimHei
 * 重定向过去，结果反而让浏览器放弃系统字体回退，汉字全部消失。
 * 实际上每个系统都自带中文字体（Windows: 宋体/黑体，macOS: 苹方/宋体-简，
 * Linux: Noto CJK），浏览器会自动回退，无需额外打包任何字体。
 *
 * 另一个坑：这些路径必须写成绝对 URL，且必须逐文档传给 getDocument。
 * 挂在 GlobalWorkerOptions 上不生效，原因见 PDF_OPTS 的注释。
 */

import * as pdfjsLib from "./vendor/pdf.min.mjs";

const BASE = "fonts/";

let initialized = false;

/**
 * pdf.js 的每文档参数。
 *
 * 重要：这些选项**必须逐文档传给 getDocument()**。
 * 挂在 GlobalWorkerOptions 上的 cMapUrl / standardFontDataUrl 在
 * pdf.js 4.6 里不生效——实测同一个高铁票 PDF，用全局配置只能解出
 * 1 个文本项（渲染成「只有二维码没有字」），改成每文档传参则能正确
 * 解出全部 54 个文本项（票面完整）。
 *
 * 另外路径必须是**绝对 URL**：pdf.js 在 worker 里拼 cmap 地址，基准是
 *  worker 脚本所在的 vendor/ 目录，相对路径会解析成 /vendor/fonts/… 而 404。
 */
export const PDF_OPTS = {
  // 中文编码映射表：没有它，GBK-EUC-H 的票据（铁路电子客票等）渲染成空白
  cMapUrl: new URL(`${BASE}cmaps/`, import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL(`${BASE}standard_fonts/`, import.meta.url).href,
  // 允许回退到系统字体，替代 PDF 里未内嵌的字体
  useSystemFonts: true,
};

/**
 * 初始化 pdf.js 的 worker。必须在首次 getDocument 之前调用。
 */
export function initPdfJs() {
  if (initialized) return;
  initialized = true;
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "./vendor/pdf.worker.min.mjs",
    import.meta.url
  ).href;
}

export { pdfjsLib };