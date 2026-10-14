/**
 * PDF 渲染引擎（pdfium）
 *
 * 为什么需要它：铁路电子客票的 PDF 使用 GBK-EUC-H 编码且未内嵌字体，
 * pdf.js 无法解码，渲染出来「只有印章和二维码、没有文字」。
 * pdfium（Chrome 同款 PDF 引擎）能正确处理这类 PDF。
 *
 * 策略：优先用 pdfium（快、兼容性好），加载失败时回退到 pdf.js。
 * 两者都在浏览器本地运行，不上传任何数据。
 */

let libPromise = null;

/** 加载 pdfium（懒加载：只有真正需要时才付出 5MB 的代价） */
async function getPdfium(onProgress) {
  if (libPromise) return libPromise;
  libPromise = (async () => {
    onProgress?.("正在加载 PDF 引擎");
    const { PDFiumLibrary } = await import("./vendor/pdfium/index.esm.js");
    const wasmBinary = await (
      await fetch(new URL("./vendor/pdfium/pdfium.wasm", import.meta.url))
    ).arrayBuffer();
    onProgress?.("正在启动 PDF 引擎");
    return await PDFiumLibrary.init({ wasmBinary });
  })();
  return libPromise;
}

/**
 * 加载中文字体。
 *
 * pdfium 通过 CSS font-family 找汉字字形，浏览器必须真的拥有这些字体。
 * 我们把中文字体子集注册成 PDF 里出现的字体名（KaiTi/SimSun/SimHei），
 * 这样未内嵌字体的中文 PDF 才能正常显示汉字。
 */
let cjkReady = null;
function ensureCjkFont() {
  if (cjkReady) return cjkReady;
  cjkReady = (async () => {
    const FONT_URL = new URL("./fonts/custom/cjk-subset.ttf", import.meta.url).href;
    // PDF 里用到的字体名 → 统一指向我们的中文子集
    const families = ["KaiTi", "SimSun", "SimHei", "STSong", "FangSong", "STKaiti"];
    let ok = 0;
    for (const name of families) {
      try {
        const face = new FontFace(name, `url(${FONT_URL}) format("truetype")`);
        await face.load();
        document.fonts.add(face);
        ok++;
      } catch (e) {
        console.warn(`字体 ${name} 注册失败:`, e);
      }
    }
    if (!ok) console.warn("中文字体全部加载失败，汉字可能无法显示");
    return ok > 0;
  })();
  return cjkReady;
}

/** Uint8Array → ImageData → PNG Blob */
function pixelsToPngBlob(data, width, height) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const imageData = new ImageData(new Uint8ClampedArray(bytes.buffer ?? bytes), width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").putImageData(imageData, 0, 0);
  return new Promise((res) => canvas.toBlob(res, "image/png"));
}

/**
 * 用 pdfium 把 PDF 每一页渲染成 PNG。
 * @returns {Promise<Array<{blob:Blob, w:number, h:number}>>}
 */
export async function renderPdfWithPdfium(bytes, dpi = 200) {
  await ensureCjkFont();
  const lib = await getPdfium();
  const doc = await lib.loadDocument(bytes); // 必须是 Uint8Array
  const scale = dpi / 72;
  const pages = [];
  try {
    const n = doc.getPageCount();
    for (let i = 0; i < n; i++) {
      const page = await doc.getPage(i);
      const { data, width, height } = await page.render({ scale });
      pages.push({ blob: await pixelsToPngBlob(data, width, height), w: width, h: height });
    }
  } finally {
    await doc.destroy?.();
  }
  return pages;
}

/** 仅初始化引擎（供调用方探测可用性） */
export async function initPdfium(onProgress) {
  return await getPdfium(onProgress);
}

/** 测试 pdfium 是否可用（用于决定渲染路径） */
export async function tryPdfium() {
  try {
    await getPdfium();
    return true;
  } catch {
    return false;
  }
}