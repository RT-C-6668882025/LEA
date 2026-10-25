'use strict';
// 文件夹即应用：工作区扫描、应用注册表、ur-app:// 协议（权限化 CSP + 每应用源隔离 + 运行时脚本）、文件监听。
// 安全模型：应用内容视为不可信代码 —— 沙箱 iframe 执行、无 Node、无系统命令面、
// 网络与存储按 app.json permissions 快照授权（打开时快照，write_file 改 app.json 不提权）。

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { Readable } = require('stream');
const { decodeTextBest } = require('./helpers');
const { MIME } = require('./formats');

const state = {
  opened: new Map(),   // appId → { id, folder, name, entry, permissions, contentId, title }
  watchers: new Map(), // appId → FSWatcher
  broadcast: null,     // (contentId, appId) → void；由 main 注入
};

function setBroadcast(fn) { state.broadcast = fn; }

function workspaceRoot() {
  // 惰性引入避免循环依赖（Electron app 对象）
  const { app } = require('electron');
  return path.join(app.getPath('documents'), 'LEA');
}

function appIdFor(folder) {
  return 'a-' + crypto.createHash('sha1').update(path.win32.normalize(folder).toLowerCase()).digest('hex').slice(0, 12);
}

function inFolder(folder, target) {
  const rel = path.relative(folder, target);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function readAppManifest(folder) {
  // app.json 可选：只认 entry 与 permissions；文件夹名就是内容单元的名字（不再引入"应用"概念）
  let manifest = {};
  const mf = path.join(folder, 'app.json');
  if (fs.existsSync(mf)) {
    try { manifest = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch { manifest = {}; }
  }
  const entry = typeof manifest.entry === 'string' && manifest.entry.trim() ? manifest.entry.trim().replace(/\\/g, '/').replace(/^\/+/, '') : 'index.html';
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions.filter((p) => ['storage', 'network'].includes(p)) : [];
  const icon = typeof manifest.icon === 'string' && manifest.icon.trim() ? manifest.icon.trim() : '';
  return { entry, permissions, icon };
}

// ---------- 打开 / 关闭 ----------
async function openFolder(folderRaw) {
  const folder = path.resolve(String(folderRaw || '').trim());
  let st;
  try { st = await fsp.stat(folder); } catch {
    const e = new Error(`文件夹不存在: ${folder}`); e.code = 'FOLDER_NOT_FOUND'; throw e;
  }
  if (!st.isDirectory()) { const e = new Error('需要的是一个文件夹'); e.code = 'NOT_A_FOLDER'; throw e; }
  const manifest = readAppManifest(folder);
  if (!fs.existsSync(path.join(folder, manifest.entry))) {
    const e = new Error(`文件夹缺少入口文件 ${manifest.entry}（需要 index.html 或在 app.json 声明 entry）`); e.code = 'NO_ENTRY'; throw e;
  }
  const id = appIdFor(folder);
  const name = path.basename(folder); // 文件夹名就是名字
  const app = { id, folder, name, ...manifest, openedAt: Date.now() };
  state.opened.set(id, app);
  startWatcher(id, folder);
  return app;
}

function getApp(id) {
  return state.opened.get(id) || null;
}

function closeApp(id) {
  state.opened.delete(id);
  const w = state.watchers.get(id);
  if (w) { try { w.close(); } catch {} state.watchers.delete(id); }
}

// ---------- 文件监听：Agent 改文件 → 自动重载（防抖） ----------
function startWatcher(id, folder) {
  if (state.watchers.has(id)) return;
  try {
    let timer = null;
    const w = fs.watch(folder, { recursive: true }, (_event, filename) => {
      if (filename && /(^|[\\/])app\.json$/i.test(filename)) return; // 清单变更不触发热重载（权限不热更新）
      clearTimeout(timer);
      timer = setTimeout(() => {
        const app = state.opened.get(id);
        if (app && state.broadcast) state.broadcast(app.contentId, id);
      }, 350);
    });
    w.on('error', () => {});
    state.watchers.set(id, w);
  } catch {}
}

// ---------- 工作区扫描（list_folders） ----------
async function listWorkspaceFolders() {
  const root = workspaceRoot();
  const out = [];
  if (!fs.existsSync(root)) return { root, folders: out };
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    try {
      if (!fs.statSync(dir).isDirectory()) continue;
      const mf = path.join(dir, 'app.json');
      const index = path.join(dir, 'index.html');
      if (!fs.existsSync(mf) && !fs.existsSync(index)) continue;
      const m = readAppManifest(dir);
      out.push({ name, entry: m.entry, permissions: m.permissions, path: dir });
    } catch {}
  }
  return { root, folders: out };
}

// ---------- ur-app:// 协议 ----------
function cspFor(permissions) {
  const net = permissions.includes('network');
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' ur-app: ur-lib:",
    "style-src 'unsafe-inline' ur-app: ur-lib:",
    `img-src data: blob: ur-app: ur-lib:${net ? ' https:' : ''}`,
    `media-src blob: data: ur-app: ur-lib:${net ? ' https:' : ''}`,
    `font-src data: ur-app: ur-lib:${net ? ' https:' : ''}`,
    `connect-src ur-app: ur-lib:${net ? ' https:' : ''}`,
    "worker-src blob: ur-app: ur-lib:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

// 注入每个应用的运行时：状态保存/恢复（重载后保留滚动、媒体进度、输入）+ 父窗口查询桥
const RUNTIME_SOURCE = `(function () {
  if (window.__UR_RUNTIME__) return; window.__UR_RUNTIME__ = 1;
  var KEY = 'ur-runtime-state';
  function snapshot() {
    try {
      var s = { scroll: { x: window.scrollX, y: window.scrollY }, media: [], inputs: [] };
      document.querySelectorAll('video,audio').forEach(function (m, i) { s.media.push({ i: i, t: m.currentTime, paused: m.paused }); });
      document.querySelectorAll('input,textarea').forEach(function (el, i) { if (el.type !== 'password') s.inputs.push({ i: i, v: el.value }); });
      s.sel = String(window.getSelection ? window.getSelection() : '');
      s.title = document.title;
      s.ls = {}; for (var k = 0; k < localStorage.length; k++) { var kk = localStorage.key(k); s.ls[kk] = localStorage.getItem(kk); }
      sessionStorage.setItem(KEY, JSON.stringify(s));
    } catch (e) {}
  }
  function restore() {
    try {
      var raw = sessionStorage.getItem(KEY); if (!raw) return;
      var s = JSON.parse(raw);
      if (s.scroll) window.scrollTo(s.scroll.x, s.scroll.y);
      document.querySelectorAll('video,audio').forEach(function (m, i) { var d = (s.media || []).find(function (x) { return x.i === i; }); if (d) { try { m.currentTime = d.t; if (!d.paused) m.play(); } catch (e) {} } });
      document.querySelectorAll('input,textarea').forEach(function (el, i) { var d = (s.inputs || []).find(function (x) { return x.i === i; }); if (d) { el.value = d.v; el.dispatchEvent(new Event('input', { bubbles: true })); } });
    } catch (e) {}
  }
  setInterval(snapshot, 1200);
  window.addEventListener('pagehide', snapshot);
  document.addEventListener('DOMContentLoaded', restore);
  window.addEventListener('load', restore);

  // ---- Obsidian 式双链：[[知识点]] / [[路径/知识点#锚点|显示文字]] → 可点击链接（前置知识跳转与块引用） ----
  function renderWikilinks() {
    if (window.__UR_WIKI__) return; window.__UR_WIKI__ = 1;
    var WIKI_RE = /\\[\\[([^\\]\\|\\n#]+)(?:#([^\\]\\|\\n]+))?(?:\\|([^\\]\\n]+))?\\]\\]/g;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var texts = [];
    while (walker.nextNode()) { var n = walker.currentNode; if (WIKI_RE.test(n.nodeValue)) { WIKI_RE.lastIndex = 0; texts.push(n); } }
    texts.forEach(function (t) {
      WIKI_RE.lastIndex = 0;
      var frag = document.createDocumentFragment();
      var last = 0, m;
      while ((m = WIKI_RE.exec(t.nodeValue)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(t.nodeValue.slice(last, m.index)));
        var a = document.createElement('a');
        a.className = 'ur-wikilink';
        a.href = '#';
        a.dataset.wiki = m[1].trim(); a.dataset.anchor = (m[2] || '').trim();
        a.textContent = (m[3] || m[2] || m[1]).trim() + (m[2] ? ' ¶' : '');
        frag.appendChild(a);
        last = m.index + m[0].length;
      }
      if (last < t.nodeValue.length) frag.appendChild(document.createTextNode(t.nodeValue.slice(last)));
      t.parentNode.replaceChild(frag, t);
    });
    if (texts.length) try { snapshot(); } catch (e) {}
  }
  document.addEventListener('DOMContentLoaded', renderWikilinks);
  window.addEventListener('load', function () { setTimeout(renderWikilinks, 200); });
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a.ur-wikilink');
    if (!a) return;
    e.preventDefault();
    if (window.parent !== window) window.parent.postMessage({ type: 'ur-wikilink', name: a.dataset.wiki, anchor: a.dataset.anchor || '' }, '*');
    try { snapshot(); } catch (e2) {}
  });

  window.addEventListener('message', function (e) {
    if (!e.data) return;
    if (e.data.type === 'ur-anchor' && e.data.id) {
      // 块引用定位：滚动到 id/data-block 匹配元素并高亮
      var el = document.getElementById(e.data.id) || document.querySelector('[data-block="' + e.data.id + '"]');
      if (el) { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); el.style.transition = 'background .8s'; el.style.background = 'rgba(217,119,6,.18)'; setTimeout(function () { el.style.background = ''; }, 1800); }
      return;
    }
    if (e.data.type !== 'ur-query') return;
    snapshot();
    var s = {}; try { s = JSON.parse(sessionStorage.getItem(KEY) || '{}'); } catch (e2) {}
    if (e.source) e.source.postMessage({ type: 'ur-state', id: e.data.id, state: {
      title: document.title, url: location.href, scroll: s.scroll || { x: 0, y: 0 },
      selection: s.sel || '', media: s.media || [], inputs: (s.inputs || []).length, ls: s.ls || {}
    } }, '*');
  });
})();`;

function handleUrApp(req) {
  try {
    const u = new URL(req.url);
    const appId = u.hostname.toLowerCase();
    const app = state.opened.get(appId);
    if (!app) return new Response('App not opened', { status: 404 });
    // 源隔离：其他应用发起的跨应用请求拒绝（初次加载无 Origin，放行）
    const origin = req.headers.get('origin');
    if (origin && /^ur-app:\/\/([^/]+)/i.test(origin) && RegExp.$1.toLowerCase() !== appId) {
      return new Response('Cross-app access denied', { status: 403 });
    }
    let rel = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    if (!rel) rel = app.entry;
    if (rel === '__ur_runtime.js') {
      if (state.debugLog) state.debugLog('ur-app 运行时脚本已请求: ' + appId);
      return new Response(RUNTIME_SOURCE, { headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    const target = path.resolve(app.folder, rel);
    if (!inFolder(app.folder, target)) return new Response('Forbidden', { status: 403 });
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return new Response('Not Found', { status: 404 });
    const ext = path.extname(target).toLowerCase();
    if (ext === '.html' || ext === '.htm') {
      const { text } = decodeTextBest(fs.readFileSync(target));
      const runtime = '<script src="ur-app://' + appId + '/__ur_runtime.js"></script>';
      const body = /<\/body>/i.test(text) ? text.replace(/<\/body>/i, runtime + '</body>') : text + runtime;
      if (state.debugLog) state.debugLog(`ur-app HTML 已服务（注入运行时）: ${appId} ${rel} CSP=${app.permissions.join(',') || '无'}`);
      return new Response(body, { headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': cspFor(app.permissions),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      } });
    }
    const type = MIME[ext] || { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
    return new Response(Readable.toWeb(fs.createReadStream(target)), { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
  } catch (err) {
    return new Response('Error: ' + err.message, { status: 500 });
  }
}

// ---------- 受限文件工具（write_file / read_file） ----------
function assertWritableTarget(target) {
  const root = workspaceRoot();
  const openedFolders = [...state.opened.values()].map((a) => a.folder);
  const ok = [root, ...openedFolders].some((base) => inFolder(path.resolve(base), path.resolve(target)));
  if (!ok) {
    const e = new Error(`路径不在允许范围内（工作区 ${root} 或已打开的应用文件夹）`); e.code = 'NOT_ALLOWED'; throw e;
  }
}

function historyDirFor(target) {
  // 快照目录：<工作区>/.history/<相对路径转义>/<时间戳>.<ext>
  const root = workspaceRoot();
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..')) return null; // 仅工作区内文件做版本
  const dir = path.join(root, '.history', rel.replace(/[\/:*?"<>|]/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function snapshotVersion(target) {
  try {
    if (!fs.existsSync(target)) return; // 新文件无旧版本
    const dir = historyDirFor(target);
    if (!dir) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = path.extname(target) || '';
    fs.copyFileSync(target, path.join(dir, stamp + ext));
    // 只保留最近 20 份
    const versions = fs.readdirSync(dir).sort();
    while (versions.length > 20) fs.unlinkSync(path.join(dir, versions.shift()));
  } catch {}
}

function listVersions(target) {
  const dir = historyDirFor(target);
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().reverse().map(f => ({
    version: f,
    time: f.replace(/.([^.]+)$/, '').replace(/-/g, ':'),
    path: path.join(dir, f),
  }));
}

async function writeFileSafe(p, content) {
  const target = path.resolve(String(p || ''));
  assertWritableTarget(target);
  if (typeof content !== 'string') { const e = new Error('content 需为字符串（UTF-8 文本）'); e.code = 'INVALID_PARAM'; throw e; }
  if (Buffer.byteLength(content, 'utf8') > 10 * 1024 * 1024) { const e = new Error('内容超过 10MB 上限'); e.code = 'FILE_TOO_LARGE'; throw e; }
  await fsp.mkdir(path.dirname(target), { recursive: true });
  snapshotVersion(target); // 历史快照：Agent 改坏可回退
  await fsp.writeFile(target, content, 'utf8');
  return { ok: true, path: target, bytes: Buffer.byteLength(content, 'utf8') };
}

async function readFileSafe(p) {
  const target = path.resolve(String(p || ''));
  assertWritableTarget(target);
  const st = await fsp.stat(target).catch(() => { const e = new Error(`文件不存在: ${target}`); e.code = 'FILE_NOT_FOUND'; throw e; });
  if (!st.isFile()) { const e = new Error('不是文件'); e.code = 'NOT_A_FILE'; throw e; }
  if (st.size > 8 * 1024 * 1024) { const e = new Error('超过 8MB 读取上限'); e.code = 'FILE_TOO_LARGE'; throw e; }
  return { ok: true, path: target, content: decodeTextBest(await fsp.readFile(target)).text, bytes: st.size };
}

// 全局搜索：递归扫描工作区文本文件（跳过 .history/. 开头/二进制/大文件）
const SEARCH_TEXT_EXT = new Set(['.html', '.htm', '.md', '.markdown', '.txt', '.json', '.csv', '.js', '.css', '.urpage', '.xml']);
function searchWorkspace(query, maxResults) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return { ok: true, query, results: [] };
  const root = workspaceRoot();
  const results = [];
  const cap = maxResults || 30;
  const walk = (dir, depth) => {
    if (depth > 6 || results.length >= cap) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (results.length >= cap) break;
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '.history') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (!SEARCH_TEXT_EXT.has(ext)) continue;
      try {
        const st = fs.statSync(p);
        if (st.size > 2 * 1024 * 1024) continue;
        const text = fs.readFileSync(p, 'utf8');
        const lines = text.split(/\r?\n/);
        const hits = [];
        for (let i = 0; i < lines.length && hits.length < 3; i++) {
          const idx = lines[i].toLowerCase().indexOf(q);
          if (idx >= 0) {
            const s = Math.max(0, idx - 20);
            hits.push({ line: i + 1, snippet: lines[i].slice(s, s + 70).trim() });
          }
        }
        if (hits.length) {
          results.push({ path: p, name: e.name, folder: path.basename(path.dirname(p)), hits });
        }
      } catch {}
    }
  };
  if (fs.existsSync(root)) walk(root, 0);
  return { ok: true, query, results };
}

// 双链查找：按名字定位目标（已打开文件夹 → 工作区文件夹 → 工作区文件，名称去扩展名匹配）
function findWikiTarget(name) {
  // 支持嵌套路径：'英语/动词/一般现在时' → 工作区下逐级匹配（每段可部分匹配目录名）
  const raw = String(name || '').trim();
  if (!raw) return null;
  if (raw.includes('/')) {
    const segs = raw.split('/').map(s => s.trim()).filter(Boolean);
    let base = workspaceRoot();
    for (let i = 0; i < segs.length; i++) {
      const last = i === segs.length - 1;
      let found = null;
      try {
        for (const e of fs.readdirSync(base)) {
          const p = path.join(base, e);
          const st = fs.statSync(p);
          const cmp = last ? e.replace(/.[^.]+$/, '') : e;
          if (cmp.toLowerCase() === segs[i].toLowerCase()) {
            found = { type: last ? (st.isDirectory() ? 'folder' : 'file') : 'dir', path: p };
            if (last) break;
          }
        }
      } catch {}
      if (!found) return null;
      if (found.type === 'dir') { base = found.path; continue; }
      return found;
    }
    // 全是目录：最后一级作为文件夹
    return { type: 'folder', path: base };
  }
  const key = raw.toLowerCase();
  if (!key) return null;
  for (const a of state.opened.values()) {
    if (a.name.toLowerCase() === key) return { type: 'folder', path: a.folder };
  }
  const root = workspaceRoot();
  if (fs.existsSync(root)) {
    const dir = path.join(root, name.trim());
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return { type: 'folder', path: dir };
    for (const f of fs.readdirSync(root)) {
      const base = f.replace(/\.[^.]+$/, '').toLowerCase();
      if (base === key) {
        const p = path.join(root, f);
        try { if (fs.statSync(p).isFile()) return { type: 'file', path: p }; } catch {}
      }
    }
  }
  return null;
}

module.exports = { searchWorkspace, listVersions, snapshotVersion, historyDirFor, state, setBroadcast, workspaceRoot, appIdFor, openFolder, getFolder: getApp, closeFolder: closeApp, listWorkspaceFolders, handleUrApp, writeFileSafe, readFileSafe, cspFor, readAppManifest, findWikiTarget };
