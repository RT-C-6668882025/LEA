'use strict';
// 统一格式注册表：主进程据此做格式识别与路由。
// 新增渲染器 = 在 RENDERERS 增加条目 + 在 src/renderer/renderers/ 增加同名 mount 实现。

const RENDERERS = [
  { id: 'markdown', name: 'Markdown 渲染器', engine: 'marked + DOMPurify', exts: ['.md', '.markdown', '.mdown'], caps: ['scroll', 'font_size', 'theme'] },
  { id: 'pdf', name: 'PDF 渲染器', engine: 'PDF.js 3.11', exts: ['.pdf'], caps: ['goto_page', 'zoom', 'scroll'] },
  { id: 'image', name: '图片查看器', engine: 'Chromium 内置', exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'], caps: ['zoom', 'pan'] },
  { id: 'media', name: '媒体播放器', engine: 'Chromium 内置 (H.264/AAC, VP9, Opus)', exts: ['.mp4', '.webm', '.m4v', '.mp3', '.wav', '.ogg', '.oga', '.m4a', '.flac', '.mov', '.mkv'], caps: ['play', 'pause', 'seek', 'volume', 'fullscreen'] },
  { id: 'text', name: '纯文本渲染器', engine: '内置', exts: ['.txt', '.log', '.csv'], caps: ['scroll', 'font_size', 'theme'] },
  { id: 'code', name: '代码渲染器', engine: '内置', exts: ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.sh', '.bat', '.cmd', '.ps1', '.yml', '.yaml', '.toml', '.ini', '.css', '.xml', '.sql', '.swift', '.kt'], caps: ['scroll', 'font_size'] },
  { id: 'json', name: 'JSON 渲染器', engine: '内置', exts: ['.json', '.jsonc', '.geojson'], caps: ['scroll', 'font_size'] },
  { id: 'html', name: 'HTML 沙箱渲染器', engine: 'Chromium sandboxed iframe', exts: ['.html', '.htm'], caps: ['sandbox'] },
  { id: 'page', name: '页面渲染器（可编辑）', engine: 'Tiptap + ArtPlayer/wavesurfer/Viewer + 沙箱互动块', exts: ['.urpage', '.urp'], caps: ['edit', 'media', 'goto_block', 'interactive'] },
  { id: 'folder', name: '文件夹运行器', engine: 'ur-app:// 沙箱（权限化 CSP + 每文件夹源隔离 + 热重载）', exts: [], caps: ['folder', 'reload', 'navigate', 'storage', 'network-optional'] },
  { id: 'epub', name: '电子书渲染器', engine: 'JSZip + EPUB 解析（OPF/NCX）', exts: ['.epub'], caps: ['toc', 'progress', 'font_size'] },
  { id: 'docx', name: 'Word 文档渲染器', engine: 'mammoth（DOCX → HTML）', exts: ['.docx'], caps: ['outline'] },
  { id: 'xlsx', name: '表格渲染器', engine: 'SheetJS（XLSX/XLS/ODS/FODS → HTML 表格）', exts: ['.xlsx', '.xls', '.ods', '.fods'], caps: ['sheets'] },
  { id: 'pptx', name: '幻灯片渲染器', engine: 'JSZip 基础预览（文本与图片）', exts: ['.pptx'], caps: ['slides'] },
  { id: 'slides', name: '幻灯片渲染器', engine: 'reveal.js（Markdown 分页）', exts: ['.slides.md'], caps: ['slides'] },
  { id: 'odt', name: 'ODT 基础预览', engine: 'JSZip（ODF content.xml 文本提取）', exts: ['.odt'], caps: ['basic'] },
];

// 已规划但第三阶段才实现的格式：必须明确提示，不允许假装渲染成功。
const PLANNED = [
  { id: 'odp', exts: ['.odp'], name: 'ODP 幻灯片渲染器', note: '后续评估（当前 PPTX 已支持基础预览）' },
];

const TEXT_LIKE = new Set(['markdown', 'text', 'code', 'json', 'page', 'slides']);

// 从扩展名识别渲染器。返回 {rendererId} | {planned:{...}} | null
// baseName 用于复合扩展名（如 .slides.md）
function detectFormat(extLower, baseName) {
  if (extLower === '.md' && baseName && /\.slides\.md$/i.test(baseName)) return { rendererId: 'slides' };
  for (const r of RENDERERS) {
    if (r.exts.includes(extLower)) return { rendererId: r.id };
  }
  for (const p of PLANNED) {
    if (p.exts.includes(extLower)) return { planned: p };
  }
  return null;
}

// MIME 映射：ur-file:// 协议响应使用
const MIME = {
  '.pdf': 'application/pdf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.html': 'text/html', '.htm': 'text/html',
  '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json', '.log': 'text/plain', '.csv': 'text/csv',
  '.urpage': 'application/json', '.urp': 'application/json',
  '.epub': 'application/epub+zip', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.slides.md': 'text/markdown',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.fods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odt': 'application/vnd.oasis.opendocument.text',
};

function rendererById(id) {
  return RENDERERS.find((r) => r.id === id) || null;
}

module.exports = { RENDERERS, PLANNED, TEXT_LIKE, MIME, detectFormat, rendererById, TEXT_READ_CAP: 8 * 1024 * 1024 };
