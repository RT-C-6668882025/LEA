// 生成测试夹具：Markdown/TXT/JSON/代码/HTML/PDF/PNG/WAV + 媒体文件（下载或本机获取）
import { writeFileSync, mkdirSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'test', 'fixtures');
mkdirSync(join(dir, 'media'), { recursive: true });

// ---------- Markdown ----------
writeFileSync(join(dir, 'sample.md'), `# LEA 测试文档

这是一个用于验证 **Markdown 渲染** 的样例文件。

## 列表

1. 自动识别文件格式
2. 自动选择渲染器
3. 多标签页切换
4. MCP 接口供外部 Agent 调用

## 表格

| 格式 | 渲染引擎 | 状态 |
| ---- | -------- | ---- |
| Markdown | marked + DOMPurify | ✅ |
| PDF | PDF.js | ✅ |
| 图片/音视频 | Chromium 内置 | ✅ |
| EPUB | foliate-js（第三阶段） | 规划中 |

## 代码块

\`\`\`js
function greet(name) {
  return \`你好, \${name}!\`;
}
console.log(greet('LEA'));
\`\`\`

> 引用块：本客户端只负责渲染，不负责生成内容。

行内代码 \`const x = 42\` 与 [外部链接](https://github.com/mozilla/pdf.js) 示例。

## 中文排版

白日依山尽，黄河入海流。欲穷千里目，更上一层楼。

---

*完*
`);

writeFileSync(join(dir, 'sample.txt'), `这是纯文本测试文件。
第二行：LEA。
The quick brown fox jumps over the lazy dog.
纯文本保持原样换行，不做 Markdown 解析。
`.repeat(40));

writeFileSync(join(dir, 'sample.json'), JSON.stringify({
  name: 'lea',
  version: '0.1.0',
  features: ['markdown', 'pdf', 'image', 'media', 'html-sandbox'],
  nested: { ok: true, items: [1, 2, 3], meta: { engine: 'electron', mcp: 'stdio' } },
}, null, 2));

writeFileSync(join(dir, 'sample-code.js'), `// 代码渲染测试
const fib = (n) => (n <= 1 ? n : fib(n - 1) + fib(n - 2));
for (let i = 0; i < 10; i++) {
  console.log(\`fib(\${i}) = \${fib(i)}\`);
}
`);

writeFileSync(join(dir, 'sample.html'), `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>交互演示（沙箱）</title>
<style>
  body { font-family: "Segoe UI", "Microsoft YaHei", sans-serif; display: flex; flex-direction: column;
         align-items: center; justify-content: center; min-height: 100vh; margin: 0;
         background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; }
  h1 { margin-bottom: 4px; }
  p  { opacity: .85; }
  button { font-size: 18px; padding: 10px 26px; margin: 8px; border: none; border-radius: 10px;
           cursor: pointer; background: #fff; color: #5b3fd4; }
  #n { font-size: 56px; font-weight: 700; margin: 18px 0; }
</style>
</head>
<body>
  <h1>HTML 沙箱渲染正常</h1>
  <p>内联 JavaScript 在隔离 iframe 中执行（无网络、无本地文件访问）</p>
  <div id="n">0</div>
  <div>
    <button onclick="document.getElementById('n').textContent = ++window.c || (window.c = 1)">+1</button>
    <button onclick="window.c = 0; document.getElementById('n').textContent = 0">重置</button>
  </div>
  <script>document.getElementById('n').textContent = '沙箱 JS 运行中 ✓';</script>
</body>
</html>
`);

// ---------- 最小多页 PDF ----------
function makePdf() {
  const pages = 3;
  const objs = [];
  const kids = [];
  for (let i = 0; i < pages; i++) kids.push(`${4 + i * 2} 0 R`);
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  for (let i = 0; i < pages; i++) {
    const pid = 4 + i * 2;
    const cid = pid + 1;
    objs[pid] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${cid} 0 R >>`;
    const text = `LEA - PDF Test Page ${i + 1} / ${pages}`;
    const stream = `BT /F1 28 Tf 72 700 Td (${text}) Tj ET\nBT /F1 14 Tf 72 650 Td (If you can read this, PDF.js rendering works.) Tj ET`;
    objs[cid] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  }
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(out);
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'binary');
}
writeFileSync(join(dir, 'sample.pdf'), makePdf());

// ---------- PNG（程序化绘制） ----------
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function makePng(w, h) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = Math.round(40 + 200 * (x / w));
      raw[o + 1] = Math.round(60 + 140 * (y / h));
      raw[o + 2] = 220;
      // 白色圆环
      const dx = x - w / 2, dy = y - h / 2, r = Math.hypot(dx, dy);
      if (r < h * 0.36 && r > h * 0.28) { raw[o] = 255; raw[o + 1] = 255; raw[o + 2] = 255; }
      // 黄色三角（播放键）
      if (x > w / 2 - 26 && x < w / 2 + 34 && dy < (x - (w / 2 - 26)) * 0.8 && dy > -(x - (w / 2 - 26)) * 0.8) {
        raw[o] = 255; raw[o + 1] = 210; raw[o + 2] = 60;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
writeFileSync(join(dir, 'sample.png'), makePng(480, 320));
writeFileSync(join(dir, 'sample.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200">
  <rect width="300" height="200" rx="16" fill="#1c1f27"/>
  <circle cx="150" cy="100" r="52" fill="#5b8cff"/>
  <polygon points="138,74 138,126 182,100" fill="#fff"/>
  <text x="150" y="180" text-anchor="middle" fill="#8b91a3" font-size="14" font-family="sans-serif">SVG Viewer OK</text>
</svg>
`);

// ---------- WAV（2 秒 440Hz 正弦） ----------
function makeWav() {
  const rate = 22050, dur = 2;
  const n = rate * dur;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t * 4, (dur - t) * 4);
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * t) * 12000 * env), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
writeFileSync(join(dir, 'media', 'sample.wav'), makeWav());

// ---------- 规划中格式（.odt 假文件，验证明确报错；docx/epub 等真实夹具在 make-fixtures2.mjs） ----------
writeFileSync(join(dir, 'sample.odp'), Buffer.from('PK\x03\x04 fake odp for planned-format test'));

// ---------- 可编辑页面夹具（.urpage：文本 + 图片 + 音频 + 视频 + 互动块） ----------
const pageDir = join(dir, 'page-demo');
mkdirSync(join(pageDir, 'assets'), { recursive: true });
mkdirSync(join(pageDir, 'media'), { recursive: true });
copyFileSync(join(dir, 'sample.png'), join(pageDir, 'assets', 'pic.png'));
copyFileSync(join(dir, 'media', 'sample.wav'), join(pageDir, 'media', 'narration.wav'));
if (existsSync(join(dir, 'media', 'sample-clip.mp4'))) {
  copyFileSync(join(dir, 'media', 'sample-clip.mp4'), join(pageDir, 'media', 'clip.mp4'));
}
const pageJson = {
  version: 1,
  title: '页面演示：可编辑内容块 + 沙箱互动',
  doc: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '交互式学习页面' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: '本页由 ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'Tiptap' },
        { type: 'text', text: ' 管理可编辑内容块。下方依次是图片、音频、视频与互动组件（HTML/CSS/JS 独立沙箱）。按 Ctrl+E 进入编辑模式。' },
      ] },
      { type: 'pageImage', attrs: { src: './assets/pic.png', caption: '程序生成的测试图片' } },
      { type: 'pageAudio', attrs: { src: './media/narration.wav' } },
      { type: 'interactive', attrs: { height: 240, html: '<style>body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;text-align:center;padding:14px;color:#1a1c22}</style><h3 style="margin:4px 0">JS 互动：计数器</h3><p id="n" style="font-size:36px;font-weight:700;margin:4px">0</p><button onclick="document.getElementById(\'n\').textContent=Number(document.getElementById(\'n\').textContent)+1" style="font-size:15px;padding:6px 18px;cursor:pointer">+1</button><p style="color:#888;font-size:12px">内联脚本运行在沙箱 iframe 中</p>' } },
      { type: 'pageVideo', attrs: { src: './media/clip.mp4' } },
      { type: 'paragraph', content: [{ type: 'text', text: '互动块的源码以字符串属性存储，编辑器从不解析或重排它 —— 这就是 "JS 不被编辑器破坏" 的关键。' }] },
    ],
  },
};
writeFileSync(join(pageDir, 'sample.urpage'), JSON.stringify(pageJson, null, 2));

// ---------- MP4 视频：优先下载小样片，失败则复用本机已有 mp4 ----------
const mp4Path = join(dir, 'media', 'sample-clip.mp4');
if (!existsSync(mp4Path) || statSync(mp4Path).size < 10000) {
  const urls = [
    'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4',
    'https://www.w3schools.com/html/mov_bbb.mp4',
    'https://media.w3.org/2010/05/sintel/trailer.mp4',
  ];
  let ok = false;
  for (const u of urls) {
    try {
      console.log('下载视频样片:', u);
      execFileSync('curl', ['-m', '90', '-sL', '-o', mp4Path, u], { stdio: 'inherit' });
      if (existsSync(mp4Path) && statSync(mp4Path).size > 100000) { ok = true; break; }
    } catch (e) { console.log('  失败:', e.message); }
  }
  if (!ok) {
    const local = 'E:\\2025-andriod-studio-1f.mp4';
    if (existsSync(local)) {
      console.log('使用本机样片:', local);
      copyFileSync(local, mp4Path);
      ok = true;
    }
  }
  console.log(ok ? 'MP4 夹具就绪' : '警告：未能获取 MP4 夹具，视频测试将跳过');
}

console.log('夹具生成完成:', dir);
