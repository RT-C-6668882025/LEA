'use strict';
/* 文件夹运行器：ur-app://<folderId>/ 独立源的沙箱 iframe。
   - 文件夹名就是内容单元的名字（无"应用"概念）
   - 权限快照（打开时）：storage → allow-same-origin（localStorage 按文件夹隔离）；无 storage 时不授予同源
   - 文件变化热重载（主进程 fs.watch 广播），运行时脚本自动恢复滚动/媒体/输入
   - 查询桥：postMessage 读取文件夹内页面的标题/选区/交互状态（跨源安全） */
(function () {
  window.URRenderers = window.URRenderers || {};
  window.URRenderers.folder = {
    mount(container, payload, api) {
      const info = payload.folderInfo || { name: payload.title, entry: 'index.html', permissions: [] };
      const appUrl = payload.appUrl;
      const permissions = info.permissions || [];

      container.style.overflow = 'hidden';
      // 导航条：后退/前进/重载/主页（iframe 历史回退）
      const nav = document.createElement('div');
      nav.className = 'app-nav';
      nav.innerHTML = '<button data-a="back" title="后退">←</button><button data-a="fwd" title="前进">→</button><button data-a="reload" title="重载">⟳</button><button data-a="home" title="主页">⌂</button><span class="app-nav-url"></span>';
      const frame = document.createElement('iframe');
      frame.className = 'app-frame';
      const sandbox = ['allow-scripts', 'allow-forms', 'allow-modals', 'allow-downloads'];
      if (permissions.includes('storage')) sandbox.push('allow-same-origin'); // 唯一源 = 按文件夹隔离的 localStorage
      frame.setAttribute('sandbox', sandbox.join(' '));
      frame.src = appUrl;
      const urlSpan = nav.querySelector('.app-nav-url');
      const syncUrl = () => { urlSpan.textContent = frame.contentWindow && frame.contentWindow.location ? (frame.src || '').replace('ur-app://', '') : ''; };
      frame.addEventListener('load', syncUrl);
      nav.addEventListener('click', (e) => {
        const a = e.target && e.target.dataset && e.target.dataset.a;
        if (!a) return;
        try {
          if (a === 'back') frame.contentWindow.history.back();
          else if (a === 'fwd') frame.contentWindow.history.forward();
          else if (a === 'reload') frame.src = frame.src;
          else if (a === 'home') frame.src = appUrl;
        } catch {}
      });
      container.append(nav, frame);

      let lastState = { title: info.name, url: appUrl, selection: '', scroll: { x: 0, y: 0 }, media: [], inputs: 0, ls: {} };
      const pending = new Map();
      let querySeq = 0;

      function onMessage(e) {
        if (e.source !== frame.contentWindow) return;
        if (!e.data) return;
        if (e.data.type === 'ur-wikilink' && e.data.name) {
          // Obsidian 式双链：点击 [[知识点]] → 打开对应内容（未找到时状态栏提示）
          window.urAPI.wikiOpen(String(e.data.name)).then((r) => {
            if (r && r.ok === false) window.urAPI.log('双链未找到: ' + e.data.name + ' — ' + (r.error && r.error.message));
          }).catch(() => {});
          return;
        }
        if (e.data.type !== 'ur-state') return;
        lastState = e.data.state || lastState;
        const p = pending.get(e.data.id);
        if (p) { pending.delete(e.data.id); p(lastState); }
      }
      window.addEventListener('message', onMessage);
      const offAnchor = (info) => { if (info.contentId !== payload.contentId) return; try { frame.contentWindow.postMessage({ type: 'ur-anchor', id: info.anchor }, '*'); } catch {} };
      window.urAPI.onWikiAnchor(offAnchor);

      function queryRuntime(timeoutMs) {
        return new Promise((resolve) => {
          try {
            if (!frame.contentWindow) return resolve(lastState);
            const qid = 'q' + (++querySeq);
            const t = setTimeout(() => { pending.delete(qid); resolve(lastState); }, timeoutMs || 2500);
            pending.set(qid, (s) => resolve(s));
            frame.contentWindow.postMessage({ type: 'ur-query', id: qid }, '*');
          } catch { resolve(lastState); }
        });
      }

      frame.addEventListener('load', () => {
        api.ready({});
        queryRuntime(3000).then(() => pushState());
      });

      function pushState() {
        window.urAPI.sendTabState({
          contentId: payload.contentId,
          title: lastState.title || info.name,
          path: info.folder,
          kind: payload.kind,
          state: {
            folder: info.name,
            entry: info.entry,
            permissions,
            url: lastState.url,
            title: lastState.title,
            error: null,
          },
        });
      }

      return {
        applyControl(action, value) {
          switch (action) {
            case 'reload': {
              frame.src = frame.src; // 重载；运行时脚本自动恢复滚动/媒体/输入
              return { ok: true };
            }
            case 'navigate': {
              const page = String(value || '').replace(/^\/+/, '');
              if (!/^[\w./-]+$/.test(page)) return { ok: false, error: { code: 'INVALID_PARAM', message: 'page 需为文件夹内相对路径' } };
              frame.src = appUrl.replace(/[^/]*$/, '') + page;
              return { ok: true };
            }
            default:
              return { ok: false, error: { code: 'NOT_SUPPORTED', message: `folder 渲染器不支持 ${action}` } };
          }
        },
        getState() {
          return {
            folder: info.name,
            entry: info.entry,
            permissions,
            title: lastState.title,
            url: lastState.url,
          };
        },
        onFolderChanged() {
          frame.src = frame.src; // 文件内容变化 → 自动重载（状态由运行时恢复）
        },
        async getFolderState() {
          const s = await queryRuntime(2500);
          return {
            ok: true,
            folder: {
              name: info.name,
              entry: info.entry,
              permissions,
              url: s.url,
              title: s.title,
              scroll: s.scroll,
              selection: s.selection,
              media: s.media,
              inputs: s.inputs,
              storageKeys: Object.keys(s.ls || {}),
            },
          };
        },
        async getSelection() {
          const s = await queryRuntime(2500);
          return {
            ok: true,
            format: 'folder',
            selection: { text: s.selection || '', empty: !s.selection, blockIndex: null },
          };
        },
        getPanels() {
          const self = this;
          const folderPath = info.folder;
          return [
            {
              id: 'info', icon: 'file', title: '信息',
              build(el) {
                el.innerHTML =
                  '<div class="panel-kv"><b>文件夹</b><span>' + String(info.name).replace(/[<>&]/g, '') + '</span></div>' +
                  '<div class="panel-kv"><b>入口</b><span>' + String(info.entry).replace(/[<>&]/g, '') + '</span></div>' +
                  '<div class="panel-kv"><b>权限</b><span>' + (permissions.join(', ') || '无') + '</span></div>' +
                  '<div class="panel-kv"><b>页面标题</b><span>' + String(lastState.title || '').replace(/[<>&]/g, '') + '</span></div>' +
                  '<div class="panel-kv"><b>URL</b><span>' + String(lastState.url || '').replace(/[<>&]/g, '') + '</span></div>' +
                  '<div class="panel-kv"><b>沙箱</b><span>无 Node · 无系统命令' + (permissions.includes('network') ? ' · 允许网络' : ' · 无网络') + '</span></div>';
              },
            },
          ];
        },
        capabilities: ['folder', 'reload', 'navigate'],
        destroy() {
          window.removeEventListener('message', onMessage);
          frame.src = 'about:blank';
        },
      };
    },
  };
})();
