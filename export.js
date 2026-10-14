/**
 * 导出：合成 A4 PNG（每页一张），用 Canvas 在本地完成。
 */

/**
 * @param {Array} pages [{summary, items:[{blob,x,y,w,h}]}]
 * @param {number} dpi 300
 */
export async function renderPagesToBlobs(pages, dpi = 300) {
  const px = (cm) => Math.max(1, Math.round((cm * dpi) / 2.54));
  const W = px(21);
  const H = px(29.7);

  const out = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);

    for (const it of page.items) {
      const bmp = await createImageBitmap(it.blob);
      ctx.drawImage(bmp, px(it.x), px(it.y), px(it.w), px(it.h));
      bmp.close?.();
    }

    // 底部汇总：细线 + 文字
    if (page.summary) {
      const fontPx = Math.round(px(0.42));
      ctx.font = `${fontPx}px "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.fillStyle = "#334155";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(page.summary, W / 2, H - px(1.05));

      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = Math.max(1, Math.round(px(0.03)));
      ctx.beginPath();
      ctx.moveTo(px(2), H - px(1.55));
      ctx.lineTo(W - px(2), H - px(1.55));
      ctx.stroke();
    }

    out.push(await new Promise((res) => canvas.toBlob(res, "image/png")));
    canvas.width = canvas.height = 0;
  }
  return out;
}

/** 打包成 zip */
export async function packZip(blobs, filename = "page") {
  const zip = new JSZip();
  blobs.forEach((b, i) => zip.file(`${filename}-${i + 1}.png`, b));
  return zip.generateAsync({ type: "blob" });
}