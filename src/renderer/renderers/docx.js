'use strict';
/* Word 文档渲染器：mammoth（DOCX → HTML，图片内联 data URI）+ DOMPurify 消毒 */
(function () {
  window.URRenderers = window.URRenderers || {};
  const b64ToBuf = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };

  window.URRenderers.docx = {
    mount(container, payload, api) {
      const body = document.createElement('div');
      body.className = 'markdown-body reading';
      container.appendChild(body);
      body.innerHTML = '<p style="color:var(--text-2)">正在解析 Word 文档…</p>';

      (async () => {
        try {
          const r = await window.urAPI.fileReadB64(payload.path);
          const result = await window.mammoth.convertToHtml({ arrayBuffer: b64ToBuf(r.data) });
          const html = window.DOMPurify.sanitize(result.value || '', {
            FORBID_TAGS: ['script', 'iframe', 'form', 'input', 'button', 'select', 'textarea', 'object', 'embed', 'link', 'meta', 'style'],
          });
          body.innerHTML = html || '<p class="muted">文档内容为空</p>';
          container.scrollTop = 0;
          pushState();
          api.ready({});
        } catch (e) {
          api.fail('Word 文档解析失败: ' + (e && e.message));
        }
      })();

      function outlineItems() {
        return [...body.querySelectorAll('h1,h2,h3')].map((h) => ({ text: h.textContent.trim().slice(0, 60) || '(空标题)', el: h, lvl: 'H' + h.tagName[1] }));
      }
      function pushState() {
        window.urAPI.sendTabState({ contentId: payload.contentId, title: payload.title, path: payload.path, kind: payload.kind, state: { words: body.textContent.length, error: null } });
      }
      let container_ = null;

      return {
        applyControl(action, value) {
          if (action === 'scroll') {
            const dir = value && value.direction === 'up' ? -1 : 1;
            container.scrollBy({ top: dir * (typeof (value && value.amount) === 'number' ? value.amount : 400) });
            return { ok: true };
          }
          return { ok: false, error: { code: 'NOT_SUPPORTED', message: `docx 渲染器不支持 ${action}` } };
        },
        getState() { return { words: body.textContent.length }; },
        getPanels() {
          return [{
            id: 'outline', icon: 'book', title: '大纲',
            build: (el) => {
              container_ = el;
              el.innerHTML = '';
              const items = outlineItems();
              if (!items.length) { el.innerHTML = '<div class="sb-empty">文档中没有标题</div>'; return; }
              for (const it of items) {
                const row = document.createElement('div');
                row.className = 'panel-item';
                row.innerHTML = `<span class="lvl">${it.lvl}</span><span class="txt">${String(it.text).replace(/[<>&]/g, '')}</span>`;
                row.addEventListener('click', () => it.el.scrollIntoView({ block: 'start', behavior: 'smooth' }));
                el.appendChild(row);
              }
            },
          }];
        },
        capabilities: ['outline'],
        destroy() {},
      };
    },
  };
})();
