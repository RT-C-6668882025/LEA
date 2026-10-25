'use strict';
/* 命令面板（Ctrl+K）：统一入口——已打开标签、工作区文件夹、全局内容搜索、动作 */
(function () {
  let overlay = null;
  let debounceTimer = null;

  function ensureDom() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'cmdk';
    overlay.style.display = 'none';
    overlay.innerHTML = `
      <div class="cmdk-box">
        <input class="cmdk-input" placeholder="搜索内容 / 打开文件夹 / 定位知识点…" spellcheck="false">
        <div class="cmdk-list"></div>
        <div class="cmdk-foot">↑↓ 选择 · Enter 打开 · Esc 关闭</div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('.cmdk-input');
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => refresh(input.value), 250);
    });
    input.addEventListener('keydown', (e) => {
      const items = [...overlay.querySelectorAll('.cmdk-item')];
      const cur = overlay.querySelector('.cmdk-item.sel');
      const idx = items.indexOf(cur);
      if (e.key === 'ArrowDown') { e.preventDefault(); if (items[idx + 1]) { cur && cur.classList.remove('sel'); items[idx + 1].classList.add('sel'); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (idx > 0) { cur.classList.remove('sel'); items[idx - 1].classList.add('sel'); } }
      else if (e.key === 'Enter') { e.preventDefault(); if (cur) cur.click(); }
      else if (e.key === 'Escape') { e.preventDefault(); hide(); }
    });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) hide(); });
  }

  function show() {
    ensureDom();
    overlay.style.display = '';
    const input = overlay.querySelector('.cmdk-input');
    input.value = '';
    refresh('');
    setTimeout(() => input.focus(), 30);
  }
  function hide() { if (overlay) overlay.style.display = 'none'; }
  function toggle() { (!overlay || overlay.style.display === 'none') ? show() : hide(); }

  function addItem(list, { icon, title, sub, run }) {
    const el = document.createElement('div');
    el.className = 'cmdk-item';
    el.innerHTML = `<span class="cmdk-ic">${window.urIcon(icon, 14)}</span><span class="cmdk-tt">${title}</span><span class="cmdk-sub">${sub || ''}</span>`;
    el.addEventListener('click', () => { hide(); run(); });
    list.appendChild(el);
    return el;
  }

  async function refresh(q) {
    const list = overlay.querySelector('.cmdk-list');
    list.innerHTML = '';
    const ql = q.trim().toLowerCase();

    // 1. 已打开的标签
    let added = 0;
    const tabs = (window.__UR_TABS__ ? window.__UR_TABS__() : []);
    for (const t of tabs) {
      if (added >= 6) break;
      if (!ql || t.title.toLowerCase().includes(ql)) {
        const el = addItem(list, { icon: 'file', title: t.title, sub: '已打开', run: () => { if (window.__UR_ACTIVATE__) window.__UR_ACTIVATE__(t.id); } });
        if (!list.querySelector('.sel')) el.classList.add('sel');
        added++;
      }
    }

    // 2. 工作区文件夹
    try {
      const ws = await window.urAPI.workspaceList();
      for (const f of (ws.folders || []).slice(0, 20)) {
        if (added >= 12) break;
        if (!ql || f.name.toLowerCase().includes(ql)) {
          const el = addItem(list, { icon: 'folder', title: f.name, sub: '工作区', run: async () => {
            const r = await window.urAPI.workspaceOpen(f.path);
            if (r && r.ok === false) window.urAPI.log('打开失败: ' + (r.error && r.error.message));
          } });
          if (!list.querySelector('.sel')) el.classList.add('sel');
          added++;
        }
      }
    } catch {}

    // 3. 全局内容搜索（有关键词时）
    if (ql) {
      try {
        const r = await window.urAPI.searchContent(q.trim());
        for (const hit of (r.results || []).slice(0, 8)) {
          const el = addItem(list, {
            icon: 'book',
            title: `${hit.folder}/${hit.name} : ${hit.hits[0].line}行`,
            sub: hit.hits[0].snippet,
            run: async () => {
              const res = await window.urAPI.openPaths([hit.path]);
              if (res && res[0] && res[0].ok === false) window.urAPI.log('搜索结果打开失败');
            },
          });
          if (!list.querySelector('.sel')) el.classList.add('sel');
        }
      } catch {}
    }

    if (!list.children.length) list.innerHTML = '<div class="cmdk-empty">无匹配</div>';
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); toggle(); }
    else if (e.key === 'Escape' && overlay && overlay.style.display !== 'none') hide();
  });

  window.urCmdk = { toggle };
})();
