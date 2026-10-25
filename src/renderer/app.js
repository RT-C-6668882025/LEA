'use strict';
/* LEA 前端核心：标签页、渲染器路由、MCP 指令、拖拽与快捷键
   布局：顶部标签栏 + 左侧边栏（工作区/功能面板）+ 内容区 + 状态栏 */

const state = { tabs: [], activeId: null, appInfo: { version: '' } };

const $ = (sel) => document.querySelector(sel);
const viewsEl = $('#views');
const tabbarEl = $('#tabbar');
const sbToolsEl = $('#sb-tools');
const sbPanelEl = $('#sb-panel');
const sbToolsSection = $('#sb-tools-section');
const sbFoldersEl = $('#sb-folders');
const emptyEl = $('#empty-state');
const statusLeft = $('#status-left');
const statusRight = $('#status-right');
let openPanelId = null;

window.urFileUrl = (p) => 'ur-file://local/' + encodeURIComponent(String(p).replace(/\\/g, '/'));

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function findTab(id) { return state.tabs.find((t) => t.id === id) || null; }

/* ---------- 标签栏 ---------- */
function itemIcon(tab) {
  const map = { folder: 'folder', image: 'image', media: 'monitor', page: 'pencil', epub: 'book', docx: 'file', xlsx: 'columns', pptx: 'film', slides: 'film', odt: 'file' };
  return window.urIcon(map[tab.rendererId] || 'file', 14);
}

window.__UR_TABS__ = () => state.tabs.map(t => ({ id: t.id, title: t.title }));
window.__UR_ACTIVATE__ = (id) => activateTab(id);

function renderTabbar() {
  tabbarEl.innerHTML = '';
  for (const tab of state.tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (tab.id === state.activeId ? ' active' : '');
    el.title = tab.path || tab.title;
    const icon = document.createElement('span');
    icon.className = 'tab-icon';
    icon.innerHTML = itemIcon(tab);
    const span = document.createElement('span');
    span.className = 'tab-title';
    span.textContent = tab.title;
    const close = document.createElement('button');
    close.className = 'tab-close';
    close.title = '关闭 (Ctrl+W)';
    close.innerHTML = window.urIcon('x', 12);
    close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(tab.id); });
    el.append(icon, span, close);
    el.addEventListener('click', () => activateTab(tab.id));
    el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(tab.id); });
    tabbarEl.appendChild(el);
  }
  emptyEl.style.display = state.tabs.length ? 'none' : '';
}

function setStatus(text) { statusLeft.textContent = text; }

function activateTab(id) {
  const tab = findTab(id);
  if (!tab) return;
  state.activeId = id;
  for (const t of state.tabs) t.viewEl.classList.toggle('active', t.id === id);
  renderTabbar();
  renderTools();
  document.title = `${tab.title} - LEA`;
  setStatus(`${tab.title} · ${tab.format} · ${tab.rendererId}${tab.path ? ' · ' + tab.path : tab.sourceUrl ? ' · ' + tab.sourceUrl : ''}`);
}

function createTab(payload) {
  const viewEl = document.createElement('section');
  viewEl.className = 'view';
  viewEl.dataset.tabId = payload.contentId;
  viewsEl.appendChild(viewEl);
  const tab = {
    id: payload.contentId,
    title: payload.title,
    format: payload.format || payload.virtualType || '',
    rendererId: payload.rendererId,
    kind: payload.kind,
    path: payload.path || null,
    sourceUrl: payload.sourceUrl || null,
    error: null,
    uiState: {},
    initialState: payload.initialState || null,
    viewEl,
    handle: null,
    payload,
  };
  state.tabs.push(tab);
  return tab;
}

function closeTab(id) {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  const tab = state.tabs[idx];
  try { if (tab.handle && tab.handle.destroy) tab.handle.destroy(); } catch {}
  tab.viewEl.remove();
  state.tabs.splice(idx, 1);
  window.urAPI.tabClosed(id);
  if (state.activeId === id) {
    state.activeId = state.tabs.length ? state.tabs[Math.min(idx, state.tabs.length - 1)].id : null;
    if (state.activeId) activateTab(state.activeId);
    else { renderTabbar(); document.title = 'LEA'; setStatus('就绪'); }
  } else {
    renderTabbar();
  }
}

/* ---------- 内容装载 ---------- */
function showTabError(tab, message) {
  tab.viewEl.innerHTML = `<div class="error-card"><h3>无法渲染此内容</h3><p>${escapeHtml(message)}</p><p class="muted">${escapeHtml(tab.path || tab.sourceUrl || '')}</p></div>`;
}

function makeTabApi(tab) {
  let acked = false;
  return {
    ready(info) {
      if (acked) return;
      acked = true;
      tab.error = null;
      pushTabState(tab);
      ackTab(tab.payload, { state: (info && info.state) || null });
    },
    fail(err) {
      if (acked) return;
      acked = true;
      tab.error = typeof err === 'string' ? { code: 'RENDER_ERROR', message: err } : err;
      showTabError(tab, tab.error.message || '渲染失败');
      pushTabState(tab);
      ackTab(tab.payload, { error: tab.error });
    },
    saveState(patch) {
      tab.uiState = { ...(tab.uiState || {}), ...patch };
      pushTabState(tab);
    },
    get uiState() { return { ...(tab.initialState || {}), ...(tab.uiState || {}) }; },
    setStatus,
  };
}

function ackTab(payload, extra) {
  if (payload && payload.reqId) window.urAPI.contentAck(payload.reqId, extra || {});
}

function pushTabState(tab) {
  window.urAPI.sendTabState({
    contentId: tab.id,
    title: tab.title,
    path: tab.path,
    kind: tab.kind,
    state: { ...(tab.handle && tab.handle.getState ? tab.handle.getState() : {}), ...(tab.uiState || {}), error: tab.error || null },
  });
}

function mountTab(tab, payload) {
  const renderer = window.URRenderers && window.URRenderers[tab.rendererId];
  const api = makeTabApi(tab);
  if (!renderer) {
    showTabError(tab, `未找到渲染器: ${tab.rendererId}`);
    ackTab(payload, { error: { code: 'RENDERER_MISSING', message: `未找到渲染器 ${tab.rendererId}` } });
    return;
  }
  try {
    tab.handle = renderer.mount(tab.viewEl, payload, api);
  } catch (err) {
    showTabError(tab, `渲染器初始化失败: ${err.message}`);
    ackTab(payload, { error: { code: 'RENDERER_MOUNT_FAILED', message: String(err.message || err) } });
  }
}

function openContent(payload) {
  if (window.urAPI.log) window.urAPI.log(`open-content 收到: ${payload.contentId} ${payload.rendererId}`);
  let tab = findTab(payload.contentId);
  if (tab) {
    if (payload.initialState) tab.initialState = payload.initialState;
  } else {
    tab = createTab(payload);
    mountTab(tab, payload);
  }
  if (payload.activate !== false) activateTab(tab.id);
  else renderTabbar();
}

/* ---------- 打开失败反馈：显示错误标签页 ---------- */
window.urAPI.onOpenFailed((info) => {
  const base = String(info.path || '').split(/[\\/]/).pop() || '文件';
  const id = 'err-' + Math.abs(String(info.path + '|' + info.code).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)).toString(36);
  let tab = findTab(id);
  if (!tab) {
    tab = createTab({ contentId: id, title: base + ' （无法打开）', format: '', rendererId: 'none', kind: 'error', path: info.path, initialState: null });
    showTabError(tab, `${info.message}${info.code ? `（${info.code}）` : ''}\n\n双击打开的文件出错时都会在此提示，不会再静默失败。`);
  }
  activateTab(tab.id);
});

/* ---------- 文件夹：文件变化 → 热重载 ---------- */
window.urAPI.onFolderChanged((info) => {
  const tab = findTab(info.contentId);
  if (tab && tab.handle && tab.handle.onFolderChanged) {
    tab.handle.onFolderChanged();
    setStatus('文件夹内容已更新，自动重载（状态已保留）');
  }
});

/* ---------- MCP 指令 ---------- */
window.urAPI.onMcpRequest(async (req) => {
  let result;
  try {
    if (req.op === 'state') {
      result = buildState();
      // 活动标签是文件夹时，附带运行时交互状态（标题/选区/滚动/媒体/localStorage）
      const active = findTab(state.activeId);
      if (active && active.rendererId === 'folder' && active.handle && active.handle.getFolderState) {
        try {
          const r = await active.handle.getFolderState();
          if (r.ok) {
            const t = result.tabs.find((x) => x.contentId === active.id);
            if (t) t.state.folder = r.folder;
          }
        } catch {}
      }
    }
    else if (req.op === 'control') result = applyControl(req.params || {});
    else if (req.op === 'update_block') result = opUpdateBlock(req.params || {});
    else if (req.op === 'get_selection') result = opGetSelection(req.params || {});
    else if (req.op === 'export') {
      const tab = (req.params.content_id && findTab(req.params.content_id)) || findTab(state.activeId);
      result = tab && tab.handle && tab.handle.exportHtml
        ? await tab.handle.exportHtml(req.params.mode || 'single')
        : { ok: false, error: { code: 'EXPORT_NOT_SUPPORTED', message: '当前渲染器不支持 HTML/ZIP 导出' } };
    }
    else result = { ok: false, error: { code: 'UNKNOWN_OP', message: `未知操作 ${req.op}` } };
  } catch (e) {
    result = { ok: false, error: { code: e.code || 'INTERNAL', message: e.message } };
  }
  window.urAPI.mcpReply(req.reqId, result);
});

function buildState() {
  return {
    ok: true,
    activeContentId: state.activeId,
    tabs: state.tabs.map((t) => ({
      contentId: t.id,
      title: t.title,
      format: t.format,
      renderer: t.rendererId,
      kind: t.kind,
      path: t.path,
      sourceUrl: t.sourceUrl,
      state: { ...(t.handle && t.handle.getState ? t.handle.getState() : {}), ...(t.uiState || {}) },
      error: t.error || null,
    })),
    fullscreen: !!document.fullscreenElement,
  };
}

function opUpdateBlock(params) {
  const tab = (params.content_id && findTab(params.content_id)) || findTab(state.activeId);
  if (!tab) return { ok: false, error: { code: 'NO_ACTIVE_TAB', message: '没有活动标签页' } };
  if (!tab.handle || !tab.handle.updateBlock) {
    return { ok: false, error: { code: 'NOT_SUPPORTED', message: `渲染器 ${tab.rendererId} 不支持 update_block（当前仅 page 可编辑页面支持）` } };
  }
  return tab.handle.updateBlock(params);
}

function opGetSelection(params) {
  const tab = (params.content_id && findTab(params.content_id)) || findTab(state.activeId);
  if (!tab) return { ok: false, error: { code: 'NO_ACTIVE_TAB', message: '没有活动标签页' } };
  if (tab.handle && tab.handle.getSelection) return tab.handle.getSelection();
  const sel = window.getSelection();
  const text = sel ? String(sel).trim() : '';
  return { ok: true, format: tab.format, selection: { text, empty: !text, blockIndex: null } };
}

function applyControl(params) {
  const { action, value } = params;
  const tab = (params.content_id && findTab(params.content_id)) || findTab(state.activeId);
  switch (action) {
    case 'activate_tab': {
      const t = findTab(value);
      if (!t) return { ok: false, error: { code: 'TAB_NOT_FOUND', message: `标签不存在: ${value}` } };
      activateTab(t.id);
      return { ok: true, activeContentId: state.activeId };
    }
    case 'next_tab':
    case 'prev_tab': {
      if (!state.tabs.length) return { ok: false, error: { code: 'NO_ACTIVE_TAB', message: '没有已打开的标签页' } };
      const i = state.tabs.findIndex((t) => t.id === state.activeId);
      const next = state.tabs[(i + (action === 'next_tab' ? 1 : state.tabs.length - 1)) % state.tabs.length];
      activateTab(next.id);
      return { ok: true, activeContentId: state.activeId };
    }
    case 'close_tab': {
      if (!tab) return { ok: false, error: { code: 'NO_ACTIVE_TAB', message: '没有活动标签页' } };
      closeTab(tab.id);
      return { ok: true, activeContentId: state.activeId };
    }
    default: {
      if (!tab) return { ok: false, error: { code: 'NO_ACTIVE_TAB', message: '没有活动标签页' } };
      if (!tab.handle || !tab.handle.applyControl) {
        return { ok: false, error: { code: 'NOT_SUPPORTED', message: `渲染器 ${tab.rendererId} 不支持控制操作 ${action}` } };
      }
      return tab.handle.applyControl(action, value) || { ok: true };
    }
  }
}

/* ---------- 侧边栏：功能面板（随活动标签） ---------- */
function renderTools() {
  const tab = findTab(state.activeId);
  const panels = tab && tab.handle && tab.handle.getPanels ? tab.handle.getPanels() : [];
  sbToolsSection.style.display = panels.length ? '' : 'none';
  sbToolsEl.innerHTML = '';
  sbPanelEl.innerHTML = '';
  sbPanelEl.style.display = 'none';
  openPanelId = null;
  for (const pn of panels) {
    const b = document.createElement('button');
    b.className = 'sb-tool';
    b.title = pn.title;
    const ic = document.createElement('span');
    ic.style.display = 'inline-flex';
    ic.innerHTML = window.urIcon(pn.icon, 15);
    const label = document.createElement('span');
    label.textContent = pn.title; // 显式文字：功能一目了然
    b.append(ic, label);
    b.addEventListener('click', async () => {
      if (openPanelId === pn.id) {
        sbPanelEl.innerHTML = '';
        sbPanelEl.style.display = 'none';
        openPanelId = null;
        b.classList.remove('active');
        return;
      }
      sbToolsEl.querySelectorAll('.sb-tool').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      openPanelId = pn.id;
      sbPanelEl.innerHTML = '<div class="sb-empty">加载中…</div>';
      sbPanelEl.style.display = '';
      await pn.build(sbPanelEl);
    });
    sbToolsEl.appendChild(b);
  }
}

/* ---------- 侧边栏：工作区 ---------- */
async function loadWorkspace() {
  try {
    const r = await window.urAPI.workspaceList();
    if (!r || !r.ok) return;
    sbFoldersEl.innerHTML = '';
    if (!r.folders.length) {
      sbFoldersEl.innerHTML = '<div class="sb-empty">暂无文件夹<span>write_file 创建后会出现在这里</span></div>';
      return;
    }
    for (const f of r.folders) {
      const item = document.createElement('div');
      item.className = 'sb-item';
      item.title = f.path;
      const icon = document.createElement('span');
      icon.className = 'sb-item-icon';
      icon.innerHTML = window.urIcon('folder', 14);
      const label = document.createElement('span');
      label.className = 'sb-item-label';
      label.textContent = f.name;
      item.append(icon, label);
      item.addEventListener('click', async () => {
        setStatus(`正在打开 ${f.name} …`);
        const res = await window.urAPI.workspaceOpen(f.path);
        if (res && res.ok === false) setStatus(`打开失败: ${res.error && res.error.message}`);
      });
      sbFoldersEl.appendChild(item);
    }
  } catch {}
}

/* ---------- 拖拽打开 ---------- */
let dragDepth = 0;
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#drop-overlay').classList.add('show'); });
document.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').classList.remove('show'); } });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').classList.remove('show');
  const paths = [];
  for (const f of e.dataTransfer.files) {
    const p = window.urAPI.pathForFile(f);
    if (p) paths.push(p);
  }
  if (!paths.length) return;
  setStatus('正在打开…');
  const results = await window.urAPI.openPaths(paths);
  const bad = results.filter((r) => r && r.ok === false);
  if (bad.length) setStatus(`打开失败: ${bad[0].error && bad[0].error.message}`);
});

/* ---------- 打开按钮与快捷键 ---------- */
$('#btn-open').addEventListener('click', async () => {
  setStatus('正在打开…');
  const results = await window.urAPI.openDialog();
  const bad = results.filter((r) => r && r.ok === false);
  if (bad.length) setStatus(`打开失败: ${bad[0].error && bad[0].error.message}`);
  else if (results.length) setStatus('已打开');
});

const btnAgent = document.getElementById('btn-agent');
if (btnAgent) btnAgent.addEventListener('click', () => { if (window.urAgentWizard) window.urAgentWizard.show(); });
const esAgent = document.getElementById('es-agent');
if (esAgent) esAgent.addEventListener('click', () => { if (window.urAgentWizard) window.urAgentWizard.show(); });

// 快捷键显式按钮：标签切换 / 命令面板 / 全屏
const tabPrev = document.getElementById('tab-prev');
if (tabPrev) tabPrev.addEventListener('click', () => applyControl({ action: 'prev_tab' }));
const tabNext = document.getElementById('tab-next');
if (tabNext) tabNext.addEventListener('click', () => applyControl({ action: 'next_tab' }));
const btnCmdk = document.getElementById('btn-cmdk');
if (btnCmdk) btnCmdk.addEventListener('click', () => { if (window.urCmdk) window.urCmdk.toggle(); });
const btnFs = document.getElementById('btn-fullscreen');
if (btnFs) btnFs.addEventListener('click', () => toggleFullscreen());

// 侧边栏工作区刷新
const sbRefresh = $('#sb-refresh');
if (sbRefresh) sbRefresh.addEventListener('click', () => { setStatus('刷新工作区…'); loadWorkspace(); });

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.shiftKey && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); $('#btn-open').click(); }
  else if (e.ctrlKey && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); if (state.activeId) closeTab(state.activeId); }
  else if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); applyControl({ action: e.shiftKey ? 'prev_tab' : 'next_tab' }); }
  else if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
  else {
    const tab = findTab(state.activeId);
    if (tab && tab.handle && tab.handle.onKey) tab.handle.onKey(e);
  }
});

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

/* ---------- 初始化 ---------- */
window.urAPI.onOpenContent(openContent);
// --agent-wizard 启动参数：直接打开接入向导
if (window.urAPI.onOpenAgentWizard) window.urAPI.onOpenAgentWizard(() => { if (window.urAgentWizard) window.urAgentWizard.show(); });
window.urAPI.onOpenFailed((info) => {
  const base = String(info.path || '').split(/[\\/]/).pop() || '文件';
  const id = 'err-' + Math.abs(String(info.path + '|' + info.code).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)).toString(36);
  let tab = findTab(id);
  if (!tab) {
    tab = createTab({ contentId: id, title: base + ' （无法打开）', format: '', rendererId: 'none', kind: 'error', path: info.path, initialState: null });
    showTabError(tab, `${info.message}${info.code ? `（${info.code}）` : ''}\n\n双击打开的文件出错时都会在此提示，不会再静默失败。`);
  }
  activateTab(tab.id);
});
window.urAPI.onFolderChanged((info) => {
  const tab = findTab(info.contentId);
  if (tab && tab.handle && tab.handle.onFolderChanged) {
    tab.handle.onFolderChanged();
    setStatus('文件夹内容已更新，自动重载（状态已保留）');
  }
});

window.urAPI.appInfo().then((info) => {
  state.appInfo = info;
  statusRight.textContent = `v${info.version} · 本地 MCP 管道监听中`;
}).catch(() => {});

// 静态图标（data-icon）初始化
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = window.urIcon(el.dataset.icon, 14); });
window.urSetTabTitle = (contentId, title) => {
  const t = findTab(contentId);
  if (t && t.title !== title) { t.title = title; renderTabbar(); }
};

loadWorkspace();
