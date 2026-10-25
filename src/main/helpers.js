'use strict';
// 通用辅助：文本解码（编码嗅探）

// BOM / meta charset 嗅探（GBK/GB2312/Big5 等常见中文编码），失败再回退
function decodeTextBest(buffer) {
  try {
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      return { text: new TextDecoder('utf-8').decode(buffer.subarray(3)), charset: 'utf-8' };
    }
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return { text: new TextDecoder('utf-16le').decode(buffer.subarray(2)), charset: 'utf-16le' };
    }
    const head = buffer.subarray(0, 4096).toString('latin1');
    const m = /<meta[^>]+charset\s*=\s*["']?\s*([\w-]+)/i.exec(head) || /@charset\s+["']([\w-]+)["']/i.exec(head);
    let cs = m && m[1] ? m[1].toLowerCase() : '';
    if (cs === 'gb2312' || cs === 'gbk') cs = 'gbk';
    if (cs && !['utf-8', 'utf8', 'ascii', 'us-ascii'].includes(cs)) {
      try { return { text: new TextDecoder(cs).decode(buffer), charset: cs }; } catch {}
    }
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), charset: 'utf-8' }; } catch {}
    try { return { text: new TextDecoder('gbk').decode(buffer), charset: 'gbk' }; } catch {}
  } catch {}
  return { text: buffer.toString('utf8'), charset: 'utf-8' };
}

module.exports = { decodeTextBest };
