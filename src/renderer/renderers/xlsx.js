'use strict';
/* 表格渲染器：SheetJS（XLSX/XLS）→ 每工作表 HTML 表格；侧边栏切换工作表 */
(function () {
  window.URRenderers = window.URRenderers || {};
  const b64ToBuf = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };

  window.URRenderers.xlsx = {
    mount(container, payload, api) {
      const wrap = document.createElement('div');
      wrap.className = 'xlsx-wrap';
      container.appendChild(wrap);
      const st = { sheets: [], active: 0 };
      let wb = null;

      function renderSheet(i) {
        st.active = i;
        const ws = wb.Sheets[st.sheets[i]];
        let html = XLSX.utils.sheet_to_html(ws, { editable: false });
        const doc = new DOMParser().parseFromString(html, 'text/html');
        wrap.innerHTML = '';
        const table = doc.querySelector('table');
        if (table) wrap.appendChild(table);
        else wrap.innerHTML = '<div class="sb-empty">空工作表</div>';
        pushState();
      }

      (async () => {
        try {
          const r = await window.urAPI.fileReadB64(payload.path);
          wb = XLSX.read(new Uint8Array(b64ToBuf(r.data)), { type: 'array' });
          st.sheets = wb.SheetNames;
          renderSheet(0);
          pushState();
          api.ready({ state: { sheets: st.sheets.length } });
        } catch (e) {
          api.fail('表格解析失败: ' + (e && e.message));
        }
      })();

      function pushState() {
        window.urAPI.sendTabState({
          contentId: payload.contentId, title: payload.title, path: payload.path, kind: payload.kind,
          state: { sheets: st.sheets, active: st.active, error: null },
        });
      }

      return {
        applyControl(action, value) {
          if (action === 'goto_page') {
            const i = parseInt(value, 10) || 1;
            if (i >= 1 && i <= st.sheets.length) renderSheet(i - 1);
            return { ok: true, state: this.getState() };
          }
          return { ok: false, error: { code: 'NOT_SUPPORTED', message: `xlsx 渲染器不支持 ${action}` } };
        },
        getState() { return { sheets: st.sheets, active: st.active }; },
        getTree() {
          if (!wb) return { title: payload.title, root: { label: '解析中…', icon: 'columns', children: [] } };
          return { title: payload.title, root: { label: '工作簿', icon: 'columns', count: st.sheets.length, children: st.sheets.map((name, i) => ({ label: String(name), icon: 'columns', nav: { kind: 'xlsx', sheet: i } })) } };
        },
        navigate(nav) {
          if (nav && nav.kind === 'xlsx') { renderSheet(nav.sheet); return { ok: true }; }
          return { ok: false };
        },
        getPanels() {
          if (!wb) return [];
          return [{
            id: 'sheets', icon: 'tree', title: '结构树',
            build(el) {
              window.urTree(el, [{
                label: '工作簿',
                icon: 'columns',
                count: st.sheets.length,
                children: st.sheets.map((name, i) => ({
                  label: String(name),
                  icon: 'columns',
                  active: i === st.active,
                  onClick: () => renderSheet(i),
                })),
              }]);
            },
          }];
        },
        capabilities: ['sheets'],
        destroy() {},
      };
    },
  };
})();
