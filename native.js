/**
 * 特殊 PDF 的处理
 *
 * 问题：铁路电子客票等 PDF 使用 GBK-EUC-H 编码且未内嵌字体，
 * pdf.js 读不出文字，渲染出「只有印章和二维码」的空白票。
 * 而浏览器自带的 PDF 阅读器（Chrome/Firefox/Edge 内置）能完美显示，
 * 因为它会用本机安装的 楷体/宋体/黑体 来补上字形。
 *
 * 这类票的票面文字依赖「本机字体」，纯网页环境无法可靠还原，
 * 因此本工具的策略是：明确告知用户，并引导到本机版（本机装有
 * 常用中文字体，pdftoppm 可 100% 渲染并自动识别金额）。
 */

/**
 * 判断某个 PDF 是否是 pdf.js 处理不了的类型。
 * 依据：整页文字层只有极少内容（正常发票有几十上百个文字块），
 * 但页面里又有大量图形元素（印章、二维码）。
 */
export function needsNativeViewer(textItemCount, pageCount = 1) {
  return textItemCount / Math.max(1, pageCount) < 5;
}

/** 生成操作指引文案 */
export const GUIDE_TEXT = {
  title: "这类高铁票需要用本机版处理",
  reason:
    "铁路电子客票的 PDF 没有内嵌中文字体，网页版受浏览器技术限制无法完整显示票面文字。" +
    "本机版调用系统字体渲染，能 100% 还原票面并自动识别金额。",
  steps: [
    "打开终端执行：bash ~/发票打印/启动发票拼版.sh",
    "把高铁票 PDF 拖进去，票面完整且金额自动填好",
    "其余发票在哪个版本处理都可以",
  ],
};

/**
 * 在浏览器中打开原生 PDF 查看器（备用方案：仍能拿到完整票面）。
 * 用 Blob URL 避免暴露用户本地路径。
 */
export function openInNativeViewer(blob, filename) {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 30 * 60 * 1000);
  return !!w;
}