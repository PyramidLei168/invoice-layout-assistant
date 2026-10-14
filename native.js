/**
 * 特殊 PDF 的检测与用户引导
 *
 * 问题：铁路电子客票等 PDF 使用 GBK-EUC-H 编码且未内嵌字体，
 * pdf.js 读不出文字，渲染出的是「只有印章和二维码的空白票」。
 * 而浏览器自带的 PDF 阅读器（Chrome/Firefox/Edge 内置）能完美显示。
 *
 * 策略：检测到这类 PDF 时，给用户一个一键打开浏览器原生查看器的
 * 入口 + 清晰的截图操作指引，避免误以为工具坏了。
 */

/**
 * 判断某个 PDF 是否是 pdf.js 处理不了的类型。
 * 依据：整页文字层只有极少内容（正常发票有几十上百个文字块），
 * 但页面里又有大量图形元素（印章、二维码）。
 */
export function needsNativeViewer(textItemCount, pageCount = 1) {
  // 每页平均文字块少于 3 个，基本可以断定文字层不可读
  return textItemCount / Math.max(1, pageCount) < 3;
}

/** 生成操作指引文案 */
export const GUIDE_TEXT = {
  title: "这张票需要用浏览器打开",
  steps: [
    "点下方「用浏览器打开」按钮，会在新标签页显示完整发票",
    "在那个页面按 Ctrl+Shift+S（Mac: Cmd+Shift+S）保存为图片",
    "把保存的图片拖回本工具，就能正常排版和汇总金额",
  ],
  note: "原因：这类铁路电子客票的 PDF 未内嵌中文字体，浏览器自带的 PDF 阅读器能正确显示，网页工具则受限于技术无法解析。",
};

/**
 * 在浏览器中打开原生 PDF 查看器。
 * 用 Blob URL 而不是文件路径，避免暴露用户本地路径。
 */
export function openInNativeViewer(blob, filename) {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) {
    // 弹窗被拦截：给用户手动下载
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }
  // 30 分钟后回收
  setTimeout(() => URL.revokeObjectURL(url), 30 * 60 * 1000);
  return !!w;
}