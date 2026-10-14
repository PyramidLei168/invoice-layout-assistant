/**
 * 发票金额自动识别（浏览器端，移植自 Python 版 amount.py）
 *
 * 原理：电子发票、火车票等 PDF 都带"文字层"，用 pdf.js 取出文字，
 *       再用多条规则匹配金额。识别不出返回 null，由用户手填。
 *
 * 覆盖：电子发票（价税合计大小写）、机票/火车票（票价）、
 *      网约车/出租车行程单（可开票金额）等。
 */

const CN_DIGIT = {
  零: 0, 壹: 1, 贰: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9,
};
const CN_UNIT = { 拾: 10, 佰: 100, 仟: 1000 };

const NUM = String.raw`([0-9][0-9,，]*\.[0-9]{1,2}|[0-9][0-9,，]*)`;

/** 中文大写转数字：肆拾壹圆玖角整 -> 41.90 */
export function cnToNum(s) {
  if (!s) return null;
  s = s.replace(/整|正/g, "");
  const m = s.match(
    /^(.*?)[圆元]([零壹贰叁肆伍陆柒捌玖]角)?([零壹贰叁肆伍陆柒捌玖]分)?$/
  );
  if (!m) return null;
  const [, integerPart, jiao, fen] = m;

  let total = 0;
  let cur = 0;
  for (const ch of integerPart) {
    if (ch in CN_DIGIT) {
      cur = CN_DIGIT[ch];
    } else if (ch in CN_UNIT) {
      total += (cur || 1) * CN_UNIT[ch];
      cur = 0;
    }
  }
  total += cur;

  let frac = 0;
  if (jiao) frac += CN_DIGIT[jiao[0]] * 0.1;
  if (fen) frac += CN_DIGIT[fen[0]] * 0.01;

  const val = Math.round((total + frac) * 100) / 100;
  return val > 0 ? val : null;
}

function toFloat(s) {
  if (s == null) return null;
  const v = parseFloat(String(s).replace(/[,，]/g, ""));
  return Number.isFinite(v) ? v : null;
}

/**
 * 从发票文字层提取金额。
 * @param {string} text pdf.js 取出的文字
 * @returns {{amount: number|null, source: string}}
 */
export function extractAmount(text) {
  if (!text || !text.trim()) return { amount: null, source: "无文字层" };

  const flat = text.replace(/\s+/g, "");

  // 1) 网约车/出租车行程单：总计可开票金额 61.36 元
  let m = flat.match(
    new RegExp(`可开票金额(?:合计|总计)?[^\\d]{0,10}${NUM}`)
  );
  if (m) {
    const v = toFloat(m[1]);
    if (v) return { amount: v, source: "行程单可开票金额" };
  }

  // 2) 电子发票标准：价税合计（小写）¥30.00
  m =
    flat.match(new RegExp(`（小写）[¥￥]?${NUM}`)) ||
    flat.match(new RegExp(`小写[）)]?[¥￥]?${NUM}`));
  if (m) {
    const v = toFloat(m[1]);
    if (v) return { amount: v, source: "价税合计小写" };
  }

  // 3) 小写缺失时用大写：肆拾壹圆玖角整
  m = flat.match(
    new RegExp(
      `[（(]?大写[）)]?[^价]{0,60}?([零壹贰叁肆伍陆柒捌玖拾佰仟万亿圆元角分整正]+)`
    )
  );
  if (m) {
    const v = cnToNum(m[1]);
    if (v) return { amount: v, source: "价税合计大写" };
  }

  // 4) 出租车机打发票：路线服务费 ¥xx
  m = flat.match(new RegExp(`路线服务费[¥￥]?${NUM}`));
  if (m) {
    const v = toFloat(m[1]);
    if (v) return { amount: v, source: "路线服务费" };
  }

  // 5) 合计行 金额+税额（小写缺失时最可靠）：¥39.53 + ¥2.37
  m = text.match(
    new RegExp(`合\\s*计\\s*[¥￥]?\\s*${NUM}\\s*[¥￥]?\\s*${NUM}`)
  );
  if (m) {
    const a = toFloat(m[1]);
    const b = toFloat(m[2]);
    if (a != null && b != null) {
      return {
        amount: Math.round((a + b) * 100) / 100,
        source: "合计+税额",
      };
    }
  }

  // 6) 合计 ¥xx
  m = text.match(new RegExp(`合\\s*计[^\\n]{0,40}?[¥￥]\\s*${NUM}`));
  if (m) {
    const v = toFloat(m[1]);
    if (v) return { amount: v, source: "合计" };
  }

  // 7) 合计（带小数）
  m = text.match(new RegExp(`合\\s*计[^\\n]{0,40}?${NUM}`));
  if (m) {
    const v = toFloat(m[1]);
    if (v && m[1].includes(".")) return { amount: v, source: "合计" };
  }

  // 8) 机票 / 火车票 / 车票
  for (const key of [
    "票价",
    "车费",
    "运费",
    "票款",
    "费用合计",
    "应收金额",
    "实收金额",
    "小计",
    "合计金额",
  ]) {
    const re = new RegExp(`${key}[^\\n]{0,25}?[¥￥]?\\s*${NUM}`);
    m = text.match(re);
    if (m) {
      const v = toFloat(m[1]);
      if (v) return { amount: v, source: key };
    }
  }

  return { amount: null, source: "未识别" };
}

/**
 * 从 pdf.js 的 textContent 结果拼出带换行的文字。
 * pdf.js 按"文本项"给坐标，这里按 Y 坐标分行、X 排序，拼成接近
 * pdftotext -layout 的结果，便于复用同一套正则。
 */
export function textFromItems(items) {
  if (!items || !items.length) return "";
  const rows = new Map();
  for (const it of items) {
    if (!it.str) continue;
    const y = Math.round(it.transform[5]);
    // 同一行内 3 个单位内视为同一行
    let key = null;
    for (const k of rows.keys()) {
      if (Math.abs(k - y) <= 3) {
        key = k;
        break;
      }
    }
    if (key === null) {
      key = y;
      rows.set(key, []);
    }
    rows.get(key).push({ x: it.transform[4], s: it.str });
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0]) // 顶部先
    .map(([, parts]) =>
      parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").trim()
    )
    .join("\n");
}