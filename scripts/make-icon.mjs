// 生成应用图标：build/icon.png (256) 与 build/icon.ico（内嵌 PNG）
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const S = 512; // 绘制分辨率（2x 超采样）
const buf = new Float32Array(S * S * 4);

function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) return;
  const i = (y * S + x) * 4;
  const da = buf[i + 3];
  const na = a + da * (1 - a);
  if (na <= 0) return;
  buf[i] = (r * a + buf[i] * da * (1 - a)) / na;
  buf[i + 1] = (g * a + buf[i + 1] * da * (1 - a)) / na;
  buf[i + 2] = (b * a + buf[i + 2] * da * (1 - a)) / na;
  buf[i + 3] = na;
}

function sdRoundRect(x, y, cx, cy, hw, hh, rad) {
  const qx = Math.abs(x - cx) - (hw - rad);
  const qy = Math.abs(y - cy) - (hh - rad);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
}

function triCoverage(x, y, tri) {
  const d = [];
  for (let i = 0; i < 3; i++) {
    const [x1, y1] = tri[i];
    const [x2, y2] = tri[(i + 1) % 3];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    d.push(((x - x1) * (y2 - y1) - (y - y1) * (x2 - x1)) / len);
  }
  const inside = (d[0] >= 0 && d[1] >= 0 && d[2] >= 0) || (d[0] <= 0 && d[1] <= 0 && d[2] <= 0);
  const dist = Math.min(Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
  return inside ? Math.min(1, dist + 0.5) : Math.max(0, 0.5 - dist);
}

const TRI = [[196, 150], [196, 362], [384, 256]];

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const cx = x + 0.5, cy = y + 0.5;
    const dRect = sdRoundRect(cx, cy, S / 2, S / 2, S / 2 - 10, S / 2 - 10, 116);
    const covRect = Math.max(0, Math.min(1, 0.5 - dRect));
    if (covRect <= 0) continue;
    const t = cy / S;
    const r = (0x4f + (0x8b - 0x4f) * t) / 255;
    const g = (0x6b + (0x5c - 0x6b) * t) / 255;
    const b = (0xf6 + (0xf6 - 0xf6) * t) / 255;
    blend(x, y, r, g, b, covRect);
    const covTri = triCoverage(cx, cy, TRI);
    if (covTri > 0) blend(x, y, 1, 1, 1, covTri);
  }
}

// 2x2 盒式降采样 → 256x256
const OUT = 256;
const rgba = Buffer.alloc(OUT * OUT * 4);
for (let y = 0; y < OUT; y++) {
  for (let x = 0; x < OUT; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const i = ((y * 2 + dy) * S + (x * 2 + dx)) * 4;
        const al = buf[i + 3];
        r += buf[i] * al; g += buf[i + 1] * al; b += buf[i + 2] * al; a += al;
      }
    }
    const o = (y * OUT + x) * 4;
    if (a > 0) {
      rgba[o] = Math.round((r / a) * 255);
      rgba[o + 1] = Math.round((g / a) * 255);
      rgba[o + 2] = Math.round((b / a) * 255);
    }
    rgba[o + 3] = Math.round((a / 4) * 255);
  }
}

// ---- PNG 编码 ----
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(b) {
  let c = 0xffffffff;
  for (const byte of b) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OUT, 0);
ihdr.writeUInt32BE(OUT, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const raw = Buffer.alloc(OUT * (OUT * 4 + 1));
for (let y = 0; y < OUT; y++) {
  raw[y * (OUT * 4 + 1)] = 0;
  rgba.copy(raw, y * (OUT * 4 + 1) + 1, y * OUT * 4, (y + 1) * OUT * 4);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

// ---- ICO 封装（单条目 256px PNG） ----
const iconDir = Buffer.alloc(6);
iconDir.writeUInt16LE(0, 0);
iconDir.writeUInt16LE(1, 2);
iconDir.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0; // 256
entry[2] = 0; entry[3] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);
const ico = Buffer.concat([iconDir, entry, png]);

mkdirSync(join(root, 'build'), { recursive: true });
writeFileSync(join(root, 'build', 'icon.png'), png);
writeFileSync(join(root, 'build', 'icon.ico'), ico);
console.log(`icon.png ${png.length}B, icon.ico ${ico.length}B 已生成`);
