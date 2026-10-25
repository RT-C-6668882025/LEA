'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { Readable } = require('stream');
const { MIME, RENDERERS, PLANNED, TEXT_LIKE, detectFormat, rendererById, TEXT_READ_CAP } = require('./formats');
const { startBridge } = require('./ipc-bridge');
const mcpStdio = require('./mcp-stdio');
const apps = require('./apps');
const { decodeTextBest } = require('./helpers');

const MCP_MODE = process.argv.includes('--mcp-stdio');

class AppError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

let gotLock = true;
if (!MCP_MODE) {
  gotLock = app.requestSingleInstanceLock();
  if (!gotLock) app.quit();
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try { console.error(line); } catch {}
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'oea.log'), line + '\n');
  } catch {}
}

// ---------------- 全局状态 ----------------
const openedFiles = new Set();      // 归一化路径白名单：允许经 ur-file:// 访问
const virtualContents = new Map();  // ur-render 沙箱页：'r-<id>' → { html }
const tabsCache = new Map();        // contentId → 标签元数据（供 MCP 兜底读取）
const pendingAcks = new Map();      // reqId → resolve(contentAck)
const pendingRr = new Map();        // reqId → { resolve, timer }
let pendingOpenQueue = [];          // 窗口加载完成前积压的发送
let win = null;
let seq = 0;
const stateStore = { files: {} };
let statePath = null;
let stateSaveTimer = null;
let stateDirty = false;

const normPath = (p) => path.win32.normalize(String(p)).toLowerCase();
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');
const fileUrlOf = (p) => 'ur-file://local/' + encodeURIComponent(path.win32.normalize(p).replace(/\\/g, '/'));

function supportedExtsString() {
  return RENDERERS.map((r) => r.exts.join(' ')).join(' ');
}

// ---------------- 协议处理 ----------------
async function handleUrFile(req) {
  try {
    const u = new URL(req.url);
    const rel = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    const p = path.win32.normalize(rel);
    if (!openedFiles.has(normPath(p))) {
      return new Response('Forbidden: 该文件未在客户端中打开', { status: 403 });
    }
    const st = await fsp.stat(p);
    if (!st.isFile()) return new Response('Not Found', { status: 404 });
    const mime = MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
    const base = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    if (req.method === 'HEAD') return new Response(null, { status: 200, headers: { ...base, 'Content-Length': String(st.size) } });
    const range = req.headers.get('range');
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (!Number.isFinite(start) || start > end || start >= st.size) { start = 0; end = st.size - 1; }
      else if (end >= st.size) end = st.size - 1;
      return new Response(Readable.toWeb(fs.createReadStream(p, { start, end })), {
        status: 206,
        headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1) },
      });
    }
    return new Response(Readable.toWeb(fs.createReadStream(p)), { status: 200, headers: { ...base, 'Content-Length': String(st.size) } });
  } catch (err) {
    log(`ur-file 处理失败 ${req.url}: ${err.message}`);
    return new Response('Not Found', { status: 404 });
  }
}

function wrapSandboxHtml(raw) {
  // 沙箱 HTML：仅内联脚本/样式，禁止网络、本地文件、表单提交与框架嵌套
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: blob:; media-src blob: data:; font-src data:; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\';">';
  if (/<head[^>]*>/i.test(raw)) return raw.replace(/<head[^>]*>/i, (m) => m + '\n' + csp);
  return csp + '\n' + raw;
}

function handleUrRender(req) {
  const u = new URL(req.url);
  const id = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
  const entry = virtualContents.get(id);
  if (!entry) return new Response('Not Found', { status: 404 });
  return new Response(entry.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

// ---------------- 内置离线库（ur-lib://）：沙箱互动块可用的库，白名单精确映射 ----------------
const LIB_MAP = {
  'sortable/sortable.min.js': ['sortablejs', 'Sortable.min.js', 'application/javascript'],
  'katex/katex.min.js': ['katex', 'dist/katex.min.js', 'application/javascript'],
  'katex/katex.min.css': ['katex', 'dist/katex.min.css', 'text/css'],
  'jsxgraph/jsxgraphcore.js': ['jsxgraph', 'distrib/jsxgraphcore.js', 'application/javascript'],
  'jsxgraph/jsxgraph.css': ['jsxgraph', 'distrib/jsxgraph.css', 'text/css'],
  'three/three.min.js': ['three', 'build/three.min.js', 'application/javascript'],
  'epub-runtime.js': ['@app', 'epub-runtime.js', 'application/javascript'],
  'chartjs/chart.umd.js': ['chart.js', 'dist/chart.umd.js', 'application/javascript'],
  'marked/marked.min.js': ['marked', 'marked.min.js', 'application/javascript'],
  'pdfjs/pdf.min.js': ['pdfjs-dist', 'build/pdf.min.js', 'application/javascript'],
  'pdfjs/pdf.worker.min.js': ['pdfjs-dist', 'build/pdf.worker.min.js', 'application/javascript'],
  'mammoth/mammoth.browser.min.js': ['mammoth', 'mammoth.browser.min.js', 'application/javascript'],
  'xlsx/xlsx.full.min.js': ['xlsx', 'dist/xlsx.full.min.js', 'application/javascript'],
  'jszip/jszip.min.js': ['jszip', 'dist/jszip.min.js', 'application/javascript'],
};

function handleUrLib(req) {
  const u = new URL(req.url);
  const rel = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
  if (rel.startsWith('katex/fonts/') && /^[\w.-]+\.(woff2?|ttf)$/i.test(rel.split('/').pop())) {
    const f = path.join(appRootPath(), 'node_modules', 'katex', 'dist', 'fonts', rel.split('/').pop());
    if (fs.existsSync(f)) {
      return new Response(Readable.toWeb(fs.createReadStream(f)), { headers: { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000' } });
    }
    return new Response('Not Found', { status: 404 });
  }
  const entry = LIB_MAP[rel];
  if (!entry) return new Response('Forbidden', { status: 403 });
  const base = entry[0] === '@app' ? path.join(appRootPath(), 'src', 'renderer') : path.join(appRootPath(), 'node_modules', entry[0]);
  const f = path.join(base, entry[1]);
  if (!fs.existsSync(f)) return new Response('Not Found', { status: 404 });
  return new Response(Readable.toWeb(fs.createReadStream(f)), { headers: { 'Content-Type': entry[2], 'Cache-Control': 'no-store' } });
}

// 应用根目录：打包后为 resources/app，开发为项目根
function appRootPath() {
  const devRoot = path.resolve(__dirname, '..', '..');
  if (fs.existsSync(path.join(devRoot, 'package.json'))) return devRoot;
  return path.resolve(__dirname, '..', '..', '..');
}

// ---------------- 窗口 ----------------
let pageReady = false; // 主框架加载完成标志；iframe 等子资源加载也会令 isLoading() 为 true，不能用它判断

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 780,
    minHeight: 540,
    backgroundColor: '#14161c',
    autoHideMenuBar: true,
    title: 'LEA — Learn Everything Anywhere',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    pageReady = true;
    log('渲染页面加载完成');
    const q = pendingOpenQueue; pendingOpenQueue = [];
    for (const fn of q) fn();
  });
  win.webContents.on('did-start-navigation', (_e, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) pageReady = false;
  });
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) log(`[renderer] ${message} (${path.basename(String(sourceId))}:${line})`);
  });
  win.webContents.on('preload-error', (_e, p, err) => log(`preload 错误 ${p}: ${err.message}`));
  win.webContents.on('render-process-gone', (_e, details) => log(`渲染进程退出: ${JSON.stringify(details)}`));
  win.on('closed', () => { win = null; });
}

function sendToWindow(channel, data) {
  if (!win) {
    pendingOpenQueue.push(() => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); });
    createWindow();
    return;
  }
  if (!pageReady) {
    pendingOpenQueue.push(() => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); });
  } else {
    win.webContents.send(channel, data);
  }
}

// ---------------- 视图状态持久化 ----------------
async function loadStateStore() {
  statePath = path.join(app.getPath('userData'), 'view-state.json');
  try {
    const parsed = JSON.parse(await fsp.readFile(statePath, 'utf8'));
    stateStore.files = parsed.files || {};
  } catch { stateStore.files = {}; }
}

function flushStateStore() {
  if (!stateDirty || !statePath) return;
  stateDirty = false;
  try { fs.writeFileSync(statePath, JSON.stringify(stateStore)); } catch (e) { log(`状态写入失败: ${e.message}`); }
}

function persistFileState(payload) {
  if (!payload.path || !payload.state) return;
  const key = normPath(payload.path);
  stateStore.files[key] = { ...(stateStore.files[key] || {}), ...payload.state, updatedAt: Date.now() };
  stateDirty = true;
  clearTimeout(stateSaveTimer);
  stateSaveTimer = setTimeout(flushStateStore, 800);
}

// ---------------- 打开内容 ----------------
function registerTabMeta(payload) {
  tabsCache.set(payload.contentId, {
    contentId: payload.contentId,
    title: payload.title,
    format: payload.format,
    renderer: payload.rendererId,
    kind: payload.kind,
    path: payload.path || null,
    state: {},
    error: null,
  });
}

function waitAck(reqId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingAcks.delete(reqId);
      resolve({ status: 'timeout', state: null, error: null });
    }, timeoutMs);
    pendingAcks.set(reqId, (result) => {
      clearTimeout(timer);
      pendingAcks.delete(reqId);
      resolve(result || {});
    });
  });
}

function rendererRequest(payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!win || win.isDestroyed()) return reject(new AppError('WINDOW_CLOSED', '主窗口未打开'));
    const reqId = 'rr-' + (++seq);
    const timer = setTimeout(() => {
      pendingRr.delete(reqId);
      reject(new AppError('RENDERER_TIMEOUT', '渲染进程响应超时'));
    }, timeoutMs);
    pendingRr.set(reqId, { resolve, timer });
    win.webContents.send('mcp-request', { reqId, ...payload });
  });
}

async function activateTab(contentId) {
  await rendererRequest({ op: 'control', params: { action: 'activate_tab', value: contentId } }, 4000);
}

async function openLocalPath(rawPath, opts = {}) {
  const p = path.resolve(String(rawPath || '').trim().replace(/^"(.*)"$/, '$1'));
  let st;
  try { st = await fsp.stat(p); } catch {
    throw new AppError('FILE_NOT_FOUND', `文件不存在: ${p}`);
  }
  if (!st.isFile()) throw new AppError('NOT_A_FILE', `不是文件: ${p}`);

  const ext = path.extname(p).toLowerCase();
  const det = detectFormat(ext, path.basename(p).toLowerCase());
  if (!det) {
    throw new AppError('UNSUPPORTED_FORMAT', `暂不支持渲染 ${ext || '(无扩展名)'} 格式。当前支持：${supportedExtsString()}`);
  }
  if (det.planned) {
    throw new AppError('FORMAT_PLANNED', `${det.planned.name}（${ext}）已列入后续计划（${det.planned.note}），当前版本暂不支持。`);
  }
  const rendererId = opts.rendererId && rendererById(opts.rendererId) ? opts.rendererId : det.rendererId;
  const contentId = 'f-' + sha1(normPath(p)).slice(0, 12);
  const title = opts.title || path.basename(p);
  openedFiles.add(normPath(p));

  // 同一文件复用既有标签，避免重复渲染
  if (tabsCache.has(contentId)) {
    try { await activateTab(contentId); } catch {}
    return { ok: true, contentId, format: ext.slice(1), renderer: rendererId, title, tabId: contentId, status: 'already-open' };
  }

  const payload = {
    reqId: 'oa-' + (++seq),
    contentId,
    kind: 'file',
    path: p,
    sourceUrl: opts.sourceUrl || null,
    title,
    format: ext.slice(1),
    rendererId,
    activate: opts.activate !== false,
    initialState: stateStore.files[normPath(p)] || null,
  };

  if (TEXT_LIKE.has(rendererId) || rendererId === 'html') {
    if (st.size > TEXT_READ_CAP) throw new AppError('FILE_TOO_LARGE', `文本类文件过大（${Math.round(st.size / 1048576)}MB），上限 8MB`);
    const buf = await fsp.readFile(p);
    payload.text = decodeTextBest(buf).text;
  }
  if (rendererId === 'html') {
    const rid = 'r-' + contentId;
    virtualContents.set(rid, { html: wrapSandboxHtml(payload.text) });
    payload.renderUrl = 'ur-render://local/' + rid;
    delete payload.text;
  }
  if (rendererId === 'page') {
    let page;
    try { page = JSON.parse(payload.text); } catch {
      throw new AppError('PAGE_INVALID', '页面文件不是有效的 JSON（.urpage）');
    }
    if (!page || typeof page !== 'object' || (!page.doc && !page.blocks)) {
      throw new AppError('PAGE_INVALID', '页面文件缺少 doc/blocks 结构');
    }
    page.title = typeof page.title === 'string' ? page.title.slice(0, 200) : path.basename(p, ext);
    delete payload.text;
    payload.page = page;
    payload.pageFrom = page.doc ? 'doc' : 'blocks';
    // 页面引用的相对路径媒体加入白名单（仅展示用途；互动块沙箱仍无法访问它们）
    for (const abs of collectPageMedia(page, path.dirname(p))) {
      openedFiles.add(normPath(abs));
    }
  }

  registerTabMeta(payload);
  sendToWindow('open-content', payload);
  const ack = await waitAck(payload.reqId, 8000);
  const status = ack.error ? 'error' : ack.status === 'timeout' ? 'timeout' : 'rendered';
  return {
    ok: !ack.error,
    contentId,
    format: ext.slice(1),
    renderer: rendererId,
    title,
    tabId: contentId,
    status,
    error: ack.error || null,
    state: ack.state || null,
  };
}

// ---------------- URL 拉取（受限） ----------------
function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1|fe80:|fc00:|fd)/.test(h)) return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  const m = /^172\.(\d+)\./.exec(h);
  if (m) { const n = Number(m[1]); if (n >= 16 && n <= 31) return true; }
  return false;
}

function downloadToFile(urlObj, destFile, hopsLeft) {
  return new Promise((resolve, reject) => {
    if (isPrivateHost(urlObj.hostname)) {
      return reject(new AppError('INTRANET_BLOCKED', `拒绝访问内网地址 ${urlObj.hostname}`));
    }
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return reject(new AppError('PROTOCOL_BLOCKED', `不允许的协议 ${urlObj.protocol}`));
    }
    const rq = net.request({ method: 'GET', url: urlObj.toString(), redirect: 'manual' });
    const ws = fs.createWriteStream(destFile);
    let size = 0;
    let done = false;
    let contentType = '';
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { rq.abort(); } catch {}
      if (err) { try { ws.destroy(); fsp.unlink(destFile).catch(() => {}); } catch {} reject(err); }
      else { ws.end(); resolve({ contentType, finalUrl: urlObj.toString() }); }
    };
    const timer = setTimeout(() => finish(new AppError('DOWNLOAD_TIMEOUT', '下载超时（60s）')), 60000);
    rq.on('redirect', (code, method, redirectUrl) => {
      try {
        if (hopsLeft <= 0) throw new AppError('TOO_MANY_REDIRECTS', '重定向次数过多');
        const nu = new URL(redirectUrl, urlObj);
        done = true; clearTimeout(timer); try { rq.abort(); } catch {} ws.destroy();
        downloadToFile(nu, destFile, hopsLeft - 1).then(resolve, reject);
      } catch (e) { finish(e); }
    });
    rq.on('response', (resp) => {
      if (resp.statusCode >= 400) return finish(new AppError('DOWNLOAD_FAILED', `HTTP ${resp.statusCode}`));
      contentType = String(resp.headers['content-type'] || '');
      resp.on('data', (c) => {
        size += c.length;
        if (size > 200 * 1024 * 1024) finish(new AppError('FILE_TOO_LARGE', 'URL 内容超过 200MB 限制'));
      });
      resp.pipe(ws);
      ws.on('finish', () => finish(null));
      ws.on('error', (e) => finish(new AppError('DOWNLOAD_FAILED', `写入失败: ${e.message}`)));
    });
    rq.on('error', (e) => finish(new AppError('DOWNLOAD_FAILED', `下载失败: ${e.message}`)));
    rq.end();
  });
}

const CT_EXT = [
  ['application/pdf', '.pdf'], ['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/gif', '.gif'],
  ['image/webp', '.webp'], ['image/svg', '.svg'], ['video/mp4', '.mp4'], ['video/webm', '.webm'],
  ['audio/mpeg', '.mp3'], ['audio/wav', '.wav'], ['audio/wave', '.wav'], ['text/markdown', '.md'],
  ['text/html', '.html'], ['application/json', '.json'], ['text/plain', '.txt'],
];

async function openUrl(rawUrl, opts = {}) {
  let u;
  try { u = new URL(String(rawUrl)); } catch { throw new AppError('INVALID_URL', 'URL 无效'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new AppError('PROTOCOL_BLOCKED', `不允许的协议 ${u.protocol}，仅支持 http/https`);
  }
  const dlDir = path.join(app.getPath('userData'), 'downloads');
  await fsp.mkdir(dlDir, { recursive: true });
  const dest = path.join(dlDir, sha1(u.toString()).slice(0, 20) + '.dl');
  const { contentType, finalUrl } = await downloadToFile(u, dest, 5);
  let ext = path.extname(new URL(finalUrl).pathname).toLowerCase();
  if (!MIME[ext]) {
    ext = '';
    for (const [ct, e] of CT_EXT) { if (contentType.includes(ct)) { ext = e; break; } }
  }
  if (!ext) ext = '.bin';
  const finalPath = dest.replace(/\.dl$/, ext);
  await fsp.rename(dest, finalPath).catch(() => {});
  return openLocalPath(finalPath, { title: decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() || '网络内容'), sourceUrl: u.toString() });
}

// ---------------- Agent 直接渲染 ----------------
async function renderVirtual(params) {
  const content = params && params.content;
  if (typeof content !== 'string' || !content.trim()) throw new AppError('EMPTY_CONTENT', 'content 不能为空');
  if (content.length > 2 * 1024 * 1024) throw new AppError('CONTENT_TOO_LARGE', '传入内容超过 2MB 上限');
  const type = ['markdown', 'html', 'text', 'page'].includes(params.content_type) ? params.content_type : 'markdown';
  const title = (typeof params.title === 'string' && params.title.trim() ? params.title.trim() : 'Agent 内容').slice(0, 200);
  const vparams = {};
  const tp = params.params || {};
  if (['light', 'dark', 'sepia'].includes(tp.theme)) vparams.theme = tp.theme;
  if (Number.isInteger(tp.font_size) && tp.font_size >= 12 && tp.font_size <= 32) vparams.fontSize = tp.font_size;
  if (['reading', 'document'].includes(tp.view_mode)) vparams.viewMode = tp.view_mode;
  if (['edit', 'read'].includes(tp.mode)) vparams.mode = tp.mode;

  const contentId = 'v-' + (++seq).toString(36);
  const payload = {
    reqId: 'oa-' + (++seq),
    contentId,
    kind: 'virtual',
    virtualType: type,
    format: type,
    title,
    rendererId: type === 'markdown' ? 'markdown' : type === 'html' ? 'html' : type === 'page' ? 'page' : 'text',
    activate: true,
    initialState: vparams,
  };
  if (type === 'html') {
    const rid = 'r-' + contentId;
    virtualContents.set(rid, { html: wrapSandboxHtml(content) });
    payload.renderUrl = 'ur-render://local/' + rid;
  } else if (type === 'page') {
    payload.page = validatePageBlocks(content);
    payload.pageFrom = 'blocks';
  } else {
    payload.text = content;
  }

  registerTabMeta(payload);
  sendToWindow('open-content', payload);
  const ack = await waitAck(payload.reqId, 8000);
  const status = ack.error ? 'error' : ack.status === 'timeout' ? 'timeout' : 'rendered';
  return {
    ok: !ack.error,
    contentId,
    format: type,
    renderer: payload.rendererId,
    title,
    tabId: contentId,
    status,
    error: ack.error || null,
    state: ack.state || null,
  };
}

function listRenderersInfo() {
  return {
    version: app.getVersion(),
    renderers: RENDERERS.map((r) => ({ id: r.id, name: r.name, engine: r.engine, formats: r.exts, capabilities: r.caps })),
    planned: PLANNED.map((p) => ({ id: p.id, name: p.name, formats: p.exts, note: p.note })),
  };
}

// ---------------- 文件夹即内容单元（文件夹名就是名字） ----------------
async function openFolder(folderRaw) {
  const folderInfo = await apps.openFolder(folderRaw); // 权限在此快照
  const contentId = 'fd-' + folderInfo.id;
  folderInfo.contentId = contentId;

  // 已打开 → 激活并热重载到最新文件
  if (tabsCache.has(contentId)) {
    try { await activateTab(contentId); } catch {}
    sendToWindow('folder-changed', { contentId });
    return { ok: true, contentId, folder: folderInfo.name, entry: folderInfo.entry, permissions: folderInfo.permissions, path: folderInfo.folder, status: 'already-open' };
  }

  const payload = {
    reqId: 'oa-' + (++seq),
    contentId,
    kind: 'folder',
    title: folderInfo.name,
    format: 'folder',
    rendererId: 'folder',
    appUrl: `ur-app://${folderInfo.id}/${folderInfo.entry}`,
    folderInfo: { name: folderInfo.name, entry: folderInfo.entry, permissions: folderInfo.permissions, folder: folderInfo.folder },
    activate: true,
    initialState: null,
  };
  registerTabMeta(payload);
  sendToWindow('open-content', payload);
  const ack = await waitAck(payload.reqId, 8000);
  return {
    ok: !ack.error,
    contentId,
    folder: folderInfo.name,
    entry: folderInfo.entry,
    permissions: folderInfo.permissions,
    path: folderInfo.folder,
    status: ack.error ? 'error' : ack.status === 'timeout' ? 'timeout' : 'rendered',
    error: ack.error || null,
  };
}

// ---------------- 页面（.urpage）辅助 ----------------
const PAGE_MEDIA_KEYS = new Set(['src', 'url', 'poster']);

// 递归收集页面 JSON 中的相对路径媒体引用
function collectPageMedia(node, baseDir) {
  const found = [];
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, val] of Object.entries(v)) {
      if (PAGE_MEDIA_KEYS.has(k) && typeof val === 'string' && val && !/^(data:|blob:|https?:|ur-file:)/i.test(val)) {
        try {
          const abs = path.resolve(baseDir, val);
          if (fs.existsSync(abs)) found.push(abs);
        } catch {}
      } else if (typeof val === 'object') walk(val);
    }
  };
  walk(node);
  return [...new Set(found)];
}

function validatePageBlocks(content) {
  let page;
  try { page = JSON.parse(content); } catch {
    throw new AppError('PAGE_INVALID', 'page 内容不是有效的 JSON');
  }
  if (!page || !Array.isArray(page.blocks)) {
    throw new AppError('PAGE_INVALID', 'page 内容需要 { title, blocks: [...] } 结构');
  }
  if (page.blocks.length > 200) throw new AppError('PAGE_TOO_COMPLEX', '页面块数超过 200 上限');
  const known = ['text', 'image', 'video', 'audio', 'interactive'];
  for (const b of page.blocks) {
    if (!b || !known.includes(b.type)) throw new AppError('PAGE_INVALID', `未知块类型: ${b && b.type}（支持 ${known.join('/')}）`);
    if (b.type === 'text' && typeof b.html !== 'string') throw new AppError('PAGE_INVALID', 'text 块需要 html 字段');
    if (['image', 'video', 'audio'].includes(b.type) && typeof b.src !== 'string') throw new AppError('PAGE_INVALID', `${b.type} 块需要 src 字段`);
    if (b.type === 'interactive' && typeof b.html !== 'string') throw new AppError('PAGE_INVALID', 'interactive 块需要 html 字段');
  }
  page.title = typeof page.title === 'string' && page.title.trim() ? page.title.trim().slice(0, 200) : 'Agent 页面';
  return page;
}

async function writePageFile(target, page) {
  const json = JSON.stringify({ version: 1, ...page, savedAt: new Date().toISOString() }, null, 2);
  if (Buffer.byteLength(json) > 12 * 1024 * 1024) throw new AppError('PAGE_TOO_LARGE', '页面内容超过 12MB 上限');
  const tmp = target + '.tmp';
  await fsp.writeFile(tmp, json, 'utf8');
  await fsp.rename(tmp, target);
  return json.length;
}

function assertAuthorizedPath(p) {
  if (!openedFiles.has(normPath(p))) {
    throw new AppError('NOT_AUTHORIZED', '该文件未在客户端中打开，拒绝写入');
  }
}

// ---------------- 导出（MCP export_content） ----------------
function exportsDir() {
  const d = path.join(app.getPath('userData'), 'exports');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function resolveExportTarget(p, defaultName, ext, filters) {
  if (p && typeof p === 'string' && p.trim()) {
    const resolved = path.resolve(p.trim());
    if (!resolved.toLowerCase().startsWith(exportsDir().toLowerCase())) {
      throw new AppError('NOT_ALLOWED', `MCP 导出路径仅允许位于 ${exportsDir()}（用户界面导出可选择任意位置）`);
    }
    return resolved;
  }
  return null; // 由调用方走对话框
}

// 从渲染进程取目标标签页的导出数据（page 渲染器提供 buildExportHtml，库已内联进互动块 srcdoc）
async function gatherExportData(contentId, mode) {
  await rendererRequest({ op: 'control', params: { action: 'activate_tab', value: contentId } }, 4000);
  const r = await rendererRequest({ op: 'export', params: { mode } }, 30000).catch(() => null);
  if (!r || r.ok === false || !r.html) {
    throw new AppError('EXPORT_NOT_SUPPORTED', '当前内容不支持 HTML/ZIP 导出（PDF 导出适用于所有标签页）');
  }
  return r; // { html, libs, assets:[{rel}] }
}

async function exportContent(p) {
  const format = ['pdf', 'html', 'zip'].includes(p.format) ? p.format : 'pdf';
  const st = await rendererRequest({ op: 'state' }, 4000).catch(() => null);
  const tabs = (st && st.tabs) || [];
  const target = (p.content_id && tabs.find((t) => t.contentId === p.content_id)) || tabs.find((t) => t.contentId === st.activeContentId) || tabs[0];
  if (!target) throw new AppError('NO_ACTIVE_TAB', '没有可导出的标签页');
  const baseName = (target.title || '导出').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);

  if (format === 'pdf') {
    await activateTab(target.contentId).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    const buf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
    const dest = resolveExportTarget(p.path, baseName + '.pdf') || path.join(exportsDir(), baseName + '.pdf');
    await fsp.writeFile(dest, buf);
    return { ok: true, format: 'pdf', path: dest, bytes: buf.length };
  }

  const data = await gatherExportData(target.contentId, format === 'zip' ? 'zip' : 'single');

  if (format === 'html') {
    const dest = resolveExportTarget(p.path, baseName + '.html') || path.join(exportsDir(), baseName + '.html');
    await fsp.writeFile(dest, data.html, 'utf8');
    return { ok: true, format: 'html', path: dest, bytes: Buffer.byteLength(data.html), note: '单文件 HTML：本地媒体使用 file:// 绝对路径，请在本机打开' };
  }

  // zip 离线内容包：index.html + ./assets/（互动块的库已内联进 srcdoc）
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('index.html', data.html);
  for (const a of data.assets || []) {
    try {
      const abs = path.resolve(path.dirname(target.path || ''), a.rel);
      if (fs.existsSync(abs)) zip.file('assets/' + path.basename(abs), fs.readFileSync(abs));
    } catch {}
  }
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const dest = resolveExportTarget(p.path, baseName + '.zip') || path.join(exportsDir(), baseName + '.zip');
  await fsp.writeFile(dest, buf);
  return { ok: true, format: 'zip', path: dest, bytes: buf.length, note: '解压后打开 index.html 即可离线查看（互动块的库已内联）' };
}

// ---------------- 本地管道桥（供 MCP Server 调用） ----------------
const bridgeHandlers = {
  ping: async () => ({ pong: true, version: app.getVersion(), window: !!win && !win.isDestroyed() }),
  open: async (p) => {
    if (p && p.url) return openUrl(p.url, { tab: p.tab, rendererId: p.content_type });
    if (p && p.path) return openLocalPath(p.path, { tab: p.tab, rendererId: p.content_type });
    throw new AppError('MISSING_PARAM', 'open 需要 path 或 url 参数');
  },
  render: async (p) => renderVirtual(p),
  control: async (p) => {
    const r = await rendererRequest({ op: 'control', params: p || {} }, 8000);
    return r;
  },
  updateBlock: async (p) => {
    const r = await rendererRequest({ op: 'update_block', params: p || {} }, 10000);
    return r;
  },
  getSelection: async () => {
    try {
      return await rendererRequest({ op: 'get_selection' }, 4000);
    } catch (e) {
      return { ok: true, selection: null, note: '渲染进程无响应，无法读取选区' };
    }
  },
  exportContent: async (p) => exportContent(p || {}),
  // ---- 文件夹即内容单元（新架构） ----
  openFolder: async (p) => {
    if (!p || !p.path) throw new AppError('MISSING_PARAM', 'open_folder 需要 path 参数（文件夹；也可直接指向文件用内置渲染器打开）');
    let st = null;
    try { st = await fsp.stat(path.resolve(p.path)); } catch {
      throw new AppError('FOLDER_NOT_FOUND', `路径不存在: ${path.resolve(p.path)}`);
    }
    if (st.isDirectory()) return openFolder(p.path);
    return openLocalPath(p.path);
  },
  listFolders: async () => {
    const { root, folders } = await apps.listWorkspaceFolders();
    return { ok: true, root, folders, opened: [...apps.state.opened.values()].map((a) => ({ name: a.name, contentId: a.contentId, path: a.folder })) };
  },
  reloadFolder: async (p) => {
    const r = await rendererRequest({ op: 'control', params: { action: 'reload', content_id: p && p.content_id } }, 8000);
    return r;
  },
  navigateFolder: async (p) => {
    const target = (p && p.target) || {};
    if (typeof target === 'string' && target) {
      // 字符串目标：优先匹配已打开标签的 contentId，再匹配文件夹名（文件夹名就是身份），否则当作文件路径打开
      if (tabsCache.has(target)) { await activateTab(target).catch(() => {}); return { ok: true, switched: target }; }
      const byName = [...apps.state.opened.values()].find((a) => a.name === target);
      if (byName) { await activateTab(byName.contentId).catch(() => {}); return { ok: true, switched: byName.contentId }; }
      const { folders } = await apps.listWorkspaceFolders();
      const wf = folders.find((f) => f.name === target);
      if (wf) return openFolder(wf.path);
      return openLocalPath(target);
    }
    if (target && target.page) {
      const r = await rendererRequest({ op: 'control', params: { action: 'navigate', value: target.page, content_id: target.content_id } }, 8000);
      return r;
    }
    if (target && target.path) return openLocalPath(target.path);
    throw new AppError('INVALID_PARAM', 'navigate_folder 需要 target（文件夹名/文件路径，或 {page} / {path}）');
  },
  writeFile: async (p) => apps.writeFileSafe(p && p.path, p && p.content),
  readFile: async (p) => apps.readFileSafe(p && p.path),
  search: async (p) => apps.searchWorkspace(p && p.query, p && p.max_results),
  listVersions: async (p) => {
    const target = path.resolve(String((p && p.path) || ''));
    return { ok: true, path: target, versions: apps.listVersions(target) };
  },
  restoreVersion: async (p) => {
    const target = path.resolve(String((p && p.path) || ''));
    const version = String((p && p.version) || '');
    const versions = apps.listVersions(target);
    const v = versions.find(x => x.version === version);
    if (!v) throw new AppError('VERSION_NOT_FOUND', '未找到该历史版本');
    apps.snapshotVersion(target); // 恢复前也快照当前（可撤销恢复）
    const content = await fsp.readFile(v.path, 'utf8');
    await apps.writeFileSafe(target, content);
    return { ok: true, path: target, restored: version, note: '已恢复并触发客户端热更新' };
  },
  state: async () => {
    try {
      return await rendererRequest({ op: 'state' }, 4000);
    } catch {
      return {
        ok: true,
        stale: true,
        note: '渲染进程无响应，返回缓存状态',
        activeContentId: null,
        tabs: [...tabsCache.values()].map((t) => ({ ...t })),
      };
    }
  },
  listRenderers: async () => listRenderersInfo(),
};

// ---------------- IPC ----------------
function extractFileArgs(argv) {
  return (argv || [])
    .slice(1)
    .filter((a) => a && !a.startsWith('-') && path.extname(a) && !/\.exe$|\.dll$/i.test(a));
}

// 双击/关联打开失败必须可见：向窗口投递错误标签页，而不是静默吞掉
function openFailureFeedback(p, err) {
  log(`打开失败 ${p}: ${err.code || ''} ${err.message}`);
  try {
    sendToWindow('open-failed', { path: p, code: err.code || 'OPEN_FAILED', message: err.message });
  } catch {} // 窗口都起不来时只能留日志
}

ipcMain.handle('dialog:open', async () => {
  const exts = [...new Set(RENDERERS.flatMap((r) => r.exts.map((e) => e.slice(1))))];
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '支持的内容', extensions: exts }, { name: '所有文件', extensions: ['*'] }],
  });
  if (r.canceled) return [];
  const results = [];
  for (const p of r.filePaths) {
    results.push(await openLocalPath(p).catch((e) => ({ ok: false, error: { code: e.code || 'OPEN_FAILED', message: e.message } })));
  }
  return results;
});

ipcMain.handle('open:paths', async (_e, paths) => {
  if (!Array.isArray(paths)) return [];
  const results = [];
  for (const p of paths) {
    results.push(await openLocalPath(p).catch((e) => ({ ok: false, error: { code: e.code || 'OPEN_FAILED', message: e.message } })));
  }
  return results;
});

ipcMain.handle('app:info', () => {
  // 打包态返回本机 mcp-server.exe 真实路径（接入向导一键复制）；开发态为 null
  let mcpServerPath = null;
  try {
    const guess = path.join(path.dirname(process.execPath), 'mcp-server.exe');
    mcpServerPath = fs.existsSync(guess) ? guess : null;
  } catch {}
  return { version: app.getVersion(), platform: process.platform, mcpPipe: require('./mcp-stdio').PIPE_NAME, mcpServerPath };
});

// 剪贴板（接入向导复制配置）
ipcMain.handle('clipboard:write', (_e, text) => {
  const { clipboard } = require('electron');
  clipboard.writeText(String(text || ''));
  return true;
});

// 工作区（侧边栏）：列出 / 打开文件夹
ipcMain.handle('workspace:list', async () => {
  const { root, folders } = await apps.listWorkspaceFolders();
  return { ok: true, root, folders };
});

// 全局搜索（命令面板用）
ipcMain.handle('search:content', (_e, q) => apps.searchWorkspace(q, 20));

// 双链跳转（Obsidian 式 [[名字]]）：已打开文件夹 → 工作区文件夹 → 工作区文件
ipcMain.handle('wiki:open', async (_e, rawName) => {
  const hashIdx = String(rawName || '').indexOf('#');
  const name = hashIdx >= 0 ? String(rawName).slice(0, hashIdx) : rawName;
  const anchor = hashIdx >= 0 ? String(rawName).slice(hashIdx + 1).trim() : '';
  const target = apps.findWikiTarget(name);
  if (!target) {
    return { ok: false, error: { code: 'WIKI_NOT_FOUND', message: `未找到知识点「${name}」：工作区（文档\\LEA）中没有同名文件夹或文件` } };
  }
  if (target.type === 'folder') return openFolder(target.path).catch((e) => ({ ok: false, error: { code: e.code || 'OPEN_FAILED', message: e.message } }));
  return openLocalPath(target.path).catch((e) => ({ ok: false, error: { code: e.code || 'OPEN_FAILED', message: e.message } }));
});

ipcMain.handle('workspace:open', async (_e, folderPath) => {
  return openFolder(folderPath).catch((e) => ({ ok: false, error: { code: e.code || 'OPEN_FAILED', message: e.message } }));
});

// 已打开文件的二进制读取（base64）：供 EPUB/DOCX/XLSX/PPTX 渲染器使用
ipcMain.handle('file:read-b64', (_e, p) => {
  const target = path.resolve(String(p || ''));
  if (!openedFiles.has(normPath(target))) {
    throw new AppError('NOT_AUTHORIZED', '该文件未在客户端中打开，拒绝读取');
  }
  const buf = fs.readFileSync(target);
  return { ok: true, data: buf.toString('base64'), bytes: buf.length };
});

// 文件夹结构树（侧边栏树状图）：仅限已打开的文件夹应用，限深限宽
ipcMain.handle('folder:tree', (_e, p) => {
  const target = path.resolve(String(p || ''));
  const isWorkspace = !target.toLowerCase().localeCompare(apps.workspaceRoot().toLowerCase());
  const isOpened = [...apps.state.opened.values()].some((a) => path.resolve(a.folder).toLowerCase() === target.toLowerCase());
  if (!isOpened && !isWorkspace) {
    throw new AppError('NOT_ALLOWED', '仅支持已打开文件夹或工作区的结构树');
  }
  const SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv', 'dist', 'build', '.next', 'target']);
  let count = 0;
  const walk = (dir, depth) => {
    const node = { name: path.basename(dir) || dir, dir: true, children: [] };
    if (depth >= 4 || count > 400) return node;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return node; }
    entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      if (++count > 400) break;
      if (e.isDirectory()) {
        node.children.push(walk(path.join(dir, e.name), depth + 1));
      } else {
        node.children.push({ name: e.name, dir: false, path: path.join(dir, e.name) });
      }
    }
    return node;
  };
  return { ok: true, root: walk(target, 0) };
});

// 内置库源码（白名单精确映射；供沙箱互动块导出内联）
ipcMain.handle('lib:source', (_e, rel) => {
  if (typeof rel !== 'string') throw new AppError('INVALID_PARAM', 'lib:source 需要 rel');
  if (LIB_MAP[rel]) {
    const f = path.join(appRootPath(), 'node_modules', LIB_MAP[rel][0], LIB_MAP[rel][1]);
    if (!fs.existsSync(f)) throw new AppError('LIB_MISSING', `库文件缺失: ${rel}`);
    return { kind: 'text', data: fs.readFileSync(f, 'utf8') };
  }
  const fm = /^katex\/fonts\/([\w.-]+\.(?:woff2?|ttf))$/i.exec(rel);
  if (fm) {
    const f = path.join(appRootPath(), 'node_modules', 'katex', 'dist', 'fonts', fm[1]);
    if (!fs.existsSync(f)) throw new AppError('LIB_MISSING', `字体缺失: ${rel}`);
    return { kind: 'base64', data: fs.readFileSync(f).toString('base64') };
  }
  throw new AppError('NOT_ALLOWED', `不在内置库白名单: ${rel}`);
});

ipcMain.handle('shell:openExternal', async (_e, url) => {
  if (!/^https?:\/\//i.test(String(url || ''))) throw new AppError('PROTOCOL_BLOCKED', '仅允许 http/https 外部链接');
  await shell.openExternal(String(url));
  return true;
});

ipcMain.on('content:ack', (_e, reqId, result) => {
  const fn = pendingAcks.get(reqId);
  if (fn) { pendingAcks.delete(reqId); fn(result || {}); }
});

ipcMain.on('ui:log', (_e, msg) => log(`[ui] ${msg}`));

ipcMain.on('tab:state', (_e, payload) => {
  if (!payload || !payload.contentId) return;
  const entry = tabsCache.get(payload.contentId);
  if (entry) {
    if (payload.title) entry.title = payload.title;
    if (payload.state) entry.state = payload.state;
    entry.error = (payload.state && payload.state.error) || null;
  }
  persistFileState(payload);
});

ipcMain.on('tab:closed', (_e, contentId) => {
  tabsCache.delete(contentId);
  virtualContents.delete('r-' + contentId);
  for (const [id, a] of apps.state.opened) {
    if (a.contentId === contentId) apps.closeFolder(id);
  }
});

ipcMain.on('mcp:reply', (_e, reqId, result) => {
  const p = pendingRr.get(reqId);
  if (p) { clearTimeout(p.timer); pendingRr.delete(reqId); p.resolve(result); }
});

// ---------------- 页面编辑 IPC ----------------
ipcMain.handle('page:save', async (_e, filePath, page) => {
  if (typeof filePath !== 'string' || !filePath) throw new AppError('INVALID_PARAM', '缺少保存路径');
  if (!page || !page.doc) throw new AppError('PAGE_INVALID', '页面数据缺少 doc');
  assertAuthorizedPath(filePath);
  const bytes = await writePageFile(filePath, page);
  return { ok: true, path: filePath, bytes };
});

ipcMain.handle('page:save-as', async (_e, page) => {
  if (!page || !page.doc) throw new AppError('PAGE_INVALID', '页面数据缺少 doc');
  const r = await dialog.showSaveDialog(win, {
    title: '保存页面',
    defaultPath: path.join(app.getPath('documents'), `${String(page.title || '页面').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '页面'}.urpage`),
    filters: [{ name: 'LEA 页面', extensions: ['urpage'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  const target = r.filePath.toLowerCase().endsWith('.urpage') ? r.filePath : r.filePath + '.urpage';
  await writePageFile(target, page);
  openedFiles.add(normPath(target));
  return { ok: true, path: target };
});

ipcMain.handle('page:pick-media', async (_e, params) => {
  const kind = params && params.kind;
  const filtersByKind = {
    image: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'] }],
    video: [{ name: '视频', extensions: ['mp4', 'webm', 'm4v', 'mov', 'mkv'] }],
    audio: [{ name: '音频', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac'] }],
  };
  const filters = filtersByKind[kind] ? [...filtersByKind[kind], { name: '所有文件', extensions: ['*'] }] : undefined;
  const r = await dialog.showOpenDialog(win, { title: `选择${{ image: '图片', video: '视频', audio: '音频' }[kind] || '文件'}`, properties: ['openFile'], filters });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  const src = r.filePaths[0];
  const size = (await fsp.stat(src)).size;

  if (params && params.pagePath) {
    // 文件页面：拷贝进页面目录 assets/，形成自包含页面
    const dir = path.dirname(params.pagePath);
    const assetsDir = path.join(dir, 'assets');
    await fsp.mkdir(assetsDir, { recursive: true });
    let name = path.basename(src);
    let target = path.join(assetsDir, name);
    let i = 1;
    while (fs.existsSync(target)) {
      const ext = path.extname(name);
      target = path.join(assetsDir, `${path.basename(name, ext)}(${i++})${ext}`);
    }
    if (size > 500 * 1024 * 1024) throw new AppError('FILE_TOO_LARGE', '媒体文件超过 500MB 上限');
    await fsp.copyFile(src, target);
    openedFiles.add(normPath(target));
    return { ok: true, rel: './assets/' + path.basename(target), abs: target, size };
  }

  // 虚拟页面（Agent 创建、未落盘）：小文件转 dataURL
  const caps = { image: 8, audio: 10, video: 20 };
  const capMB = caps[kind] || 8;
  if (size > capMB * 1024 * 1024) {
    throw new AppError('MEDIA_TOO_LARGE', `未保存的页面内嵌${kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片'}上限 ${capMB}MB，请先保存页面后再引用文件路径`);
  }
  const buf = await fsp.readFile(src);
  const mime = MIME[path.extname(src).toLowerCase()] || 'application/octet-stream';
  return { ok: true, dataUrl: `data:${mime};base64,${buf.toString('base64')}`, size };
});

ipcMain.on('tab:rebind', (_e, contentId, newPath) => {
  const entry = tabsCache.get(contentId);
  if (entry && typeof newPath === 'string' && newPath) {
    entry.path = newPath;
    openedFiles.add(normPath(newPath));
  }
});

// ---------------- 启动 ----------------
if (MCP_MODE) {
  // Windows GUI 子系统进程的 stdio 不可用（stdin 立即 EOF、stdout 失联），
  // 因此 GUI exe 不能直接充当 stdio MCP Server —— 给出明确指引而不是静默挂起。
  const msg = [
    'Windows 上请将 MCP 命令配置为安装目录下的 mcp-server.exe（推荐）',
    '或 resources\\app\\mcp-server.cmd（备选）。',
    'GUI 主进程 LEA.exe --mcp-stdio 不支持 stdio 直连。',
  ].join('\n');
  try { console.error('[ur-mcp] ' + msg.replace(/\n/g, ' ')); } catch {}
  try { require('electron').dialog.showErrorBox('LEA — MCP 配置提示', msg); } catch {}
  process.exit(2);
} else if (gotLock) {
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  // 覆盖安装/升级后 file:// 资源可能命中旧磁盘缓存（样式/脚本不更新），禁用以根治
  app.commandLine.appendSwitch('disable-http-cache');
  protocol.registerSchemesAsPrivileged([
    { scheme: 'ur-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
    { scheme: 'ur-render', privileges: { standard: true, secure: true, supportFetchAPI: false } },
    { scheme: 'ur-lib', privileges: { standard: true, secure: true, supportFetchAPI: true } },
    { scheme: 'ur-app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
  app.on('second-instance', (_e, argv) => {
    const files = extractFileArgs(argv);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    for (const f of files) openLocalPath(f).catch((e) => openFailureFeedback(f, e));
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', flushStateStore);
  app.whenReady().then(async () => {
    protocol.handle('ur-file', handleUrFile);
    protocol.handle('ur-render', handleUrRender);
    protocol.handle('ur-lib', handleUrLib);
    protocol.handle('ur-app', apps.handleUrApp);
    apps.setBroadcast((contentId) => {
      if (win && !win.isDestroyed()) win.webContents.send('folder-changed', { contentId });
      log(`文件夹内容变化，已触发重载: ${contentId}`);
    });
    apps.state.debugLog = log;
    startBridge(bridgeHandlers, log);
    await loadStateStore();
    createWindow();
    log(`LEA ${app.getVersion()} 启动 argv=${JSON.stringify(process.argv.slice(1))}`);
    if (process.argv.includes('--agent-wizard')) {
      setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.send('open-agent-wizard'); }, 800);
    }
    for (const f of extractFileArgs(process.argv)) {
      openLocalPath(f).catch((e) => openFailureFeedback(f, e));
    }
  });
}
