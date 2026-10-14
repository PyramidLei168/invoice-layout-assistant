/**
 * Word (.docx) 导出 —— 浏览器端直接生成，不经过服务器。
 *
 * 做法：用 JSZip 打包 OOXML。图片用 wp:anchor（浮动、相对页面绝对定位），
 * 与屏幕上的排版 1:1 对应；每页汇总放在页脚。
 *
 * 注意：LibreOffice 在「零边距」下会忽略浮动定位，所以页边距固定 1cm。
 */

const EMU_PER_CM = 360000;
const A4_W = 21;
const A4_H = 29.7;

const xmlEscape = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** blob → base64（去掉 data URL 前缀） */
function blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1]);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

/** 取 PNG 实际像素尺寸，用来设置正确 DPI */
function pngSize(b64) {
  const bin = atob(b64.slice(0, 64));
  const dv = new DataView(Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer);
  // 跳过 IHDR 长度(4) 类型(4)
  return { w: dv.getUint32(16), h: dv.getUint32(20) };
}

/**
 * 生成一张浮动图片的 w:drawing 片段。
 * 注意：整个片段必须紧凑无空白 —— LibreOffice 对 w:drawing 内的
 * 换行/缩进较敏感，会导致图片不显示。
 */
function anchorXml(id, name, rId, x, y, w, h) {
  const cx = Math.round(w * EMU_PER_CM);
  const cy = Math.round(h * EMU_PER_CM);
  return (
    `<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251658240 + id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="page"><wp:posOffset>${Math.round(x * EMU_PER_CM)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="page"><wp:posOffset>${Math.round(y * EMU_PER_CM)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:wrapNone/>` +
    `<wp:docPr id="${id}" name="${xmlEscape(name)}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${xmlEscape(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:anchor></w:drawing>`
  );
}

/**
 * 生成 docx。
 * @param {Array} pages  [{summary:string, items:[{blob,x,y,w,h,name}]}]
 * @returns {Promise<Blob>}
 */
export async function buildDocx(pages) {
  const zip = new JSZip();

  // ---------- 收集图片 ----------
  const media = [];
  for (const page of pages) {
    for (const it of page.items) {
      it._rId = `rId${media.length + 100}`; // 100 起，避开样式等关系
      it._b64 = await blobToB64(it.blob);
      const file = `media/image${media.length + 1}.png`;
      media.push({ rId: it._rId, file, b64: it._b64 });
    }
  }

  // ---------- document.xml ----------
  const paras = [];
  let docPrId = 1;
  pages.forEach((page, pi) => {
    const pageBreak = pi > 0 ? `<w:r><w:br w:type="page"/></w:r>` : "";
    paras.push(
      `<w:p>` +
        pageBreak +
        page.items
          .map((it) => `<w:r>${anchorXml(docPrId++, it.name || "发票", it._rId, it.x, it.y, it.w, it.h)}</w:r>`)
          .join("") +
        `</w:p>`
    );
  });

  const body =
    paras.join("") +
    `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/>` +
    `<w:pgSz w:w="${Math.round(A4_W * 567)}" w:h="${Math.round(A4_H * 567)}"/>` +
    `<w:pgMar w:top="567" w:right="567" w:bottom="567" w:left="567" w:header="0" w:footer="340" w:gutter="0"/>` +
    `<w:cols w:space="425"/><w:docGrid w:type="lines" w:linePitch="312"/>` +
    `</w:sectPr>`;

  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>${body}</w:body></w:document>`
  );

  // ---------- 页脚 ----------
  // 只用 footer1 放每页汇总：页脚在所有页上重复，这里用"每页一个分节
  // + 各自独立页脚"的简化方案不可行（浏览器端生成 sectPr 复杂），
  // 因此改为在页面内容里不依赖页脚：汇总文字直接画在图片下方由用户核对，
  // Word 中用页脚统一显示「本页汇总」见下方 sectPr。
  const footerText = pages.map((p) => p.summary || "");
  const footerBody =
    `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体"/>` +
    `<w:sz w:val="18"/><w:color w:val="64748B"/></w:rPr>` +
    `<w:t xml:space="preserve">${xmlEscape(
      footerText.join("    |    ")
    )}</w:t></w:r></w:p>`;

  zip.file(
    "word/footer1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${footerBody}</w:ftr>`
  );

  // ---------- 关系 ----------
  const rels = [
    `<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`,
    `<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>`,
    `<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>`,
    ...media.map(
      (m) =>
        `<Relationship Id="${m.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${m.file}"/>`
    ),
  ];
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join(
      ""
    )}</Relationships>`
  );

  // 页脚关系
  zip.file(
    "word/_rels/footer1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`
  );

  // ---------- 媒体 ----------
  // 用 STORE（不压缩）存放 PNG：部分 Office 实现对压缩的 PNG 兼容性不佳
  for (const m of media) {
    zip.file(`word/${m.file}`, m.b64, { base64: true, compression: "STORE" });
  }

  // ---------- 样式 ----------
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体" w:cs="宋体"/>
<w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>`
  );

  // ---------- settings.xml（部分 Office 需要） ----------
  zip.file(
    "word/settings.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:compat><w:compatSetting w:name="compatibilityMode"
 w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat>
</w:settings>`
  );

  // ---------- 包结构 ----------
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
  );

  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  zip.file(
    "docProps/core.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>发票拼版</dc:title><dc:creator>发票拼版助手</dc:creator>
<cp:lastModifiedBy>发票拼版助手</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`
  );
  zip.file(
    "docProps/app.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>发票拼版助手</Application></Properties>`
  );

  // docx 不应包含目录条目，JSZip 默认会写，这里关掉
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    streamFiles: false,
    platform: "UNIX",
  });
  return blob;
}