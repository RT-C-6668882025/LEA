'use strict';
/* ODT 基础预览：JSZip 解压 content.xml → ODF 文本提取（标题/段落/列表/内嵌图片）。
   定位为基础预览（文本层），不还原精确排版。 */
(function () {
  window.URRenderers = window.URRenderers || {};
  const b64ToBuf = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };

  window.URRenderers.odt = {
    mount(container, payload, api) {
      const body = document.createElement('div');
      body.className = 'markdown-body reading';
      container.appendChild(body);
      body.innerHTML = '<p style="color:var(--text-2)">正在解析 ODT…</p>';

      (async () => {
        try {
          const r = await window.urAPI.fileReadB64(payload.path);
          const zip = await window.JSZip.loadAsync(b64ToBuf(r.data));
          const contentXml = await zip.file('content.xml').async('string');
          const doc = new DOMParser().parseFromString(contentXml, 'application/xml');
          const textBody = doc.getElementsByTagName('office:text')[0] || doc.getElementsByTagName('office:body')[0];
          if (!textBody) { api.fail('ODT 中没有文本主体'); return; }

          const images = {};
          for (const img of [...doc.getElementsByTagName('draw:image')]) {
            const bin = img.getElementsByTagName('office:binary-data')[0];
            if (bin && bin.textContent) {
              const clean = bin.textContent.replace(/\s+/g, '');
              images[img] = 'data:image/png;base64,' + clean; // 占位，渲染时按元素映射
            }
          }

          const out = [];
          const walk = (node) => {
            for (const child of node.children) {
              const local = child.localName;
              if (local === 'h') {
                const lvl = Math.min(4, parseInt(child.getAttribute('text:outline-level') || '1', 10));
                out.push(`<h${lvl}>${esc(child.textContent)}</h${lvl}>`);
              } else if (local === 'p') {
                if (child.textContent.trim()) out.push(`<p>${inlineOf(child)}</p>`);
              } else if (local === 'list') {
                const items = [...child.getElementsByTagName('text:p')].map((p) => `<li>${esc(p.textContent)}</li>`).join('');
                out.push(`<ul>${items}</ul>`);
              } else if (local === 'sequence-decls') {
                // 跳过声明
              } else if (child.children && child.children.length) {
                walk(child);
              } else if (child.textContent && child.textContent.trim()) {
                out.push(`<p>${esc(child.textContent)}</p>`);
              }
            }
          };
          const esc = (s) => String(s).replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]));
          const inlineOf = (p) => {
            let html = '';
            for (const n of p.childNodes) {
              if (n.nodeType === 3) html += esc(n.textContent);
              else if (n.localName === 'span' || n.localName === 'h' || n.localName === 'a') html += inlineOf(n);
              else html += esc(n.textContent || '');
            }
            return html || esc(p.textContent);
          };
          walk(textBody);
          body.innerHTML = out.join('\n') || '<p class="muted">（空文档）</p>';
          pushState();
          api.ready({});
        } catch (e) {
          api.fail('ODT 解析失败: ' + (e && e.message));
        }
      })();

      function pushState() {
        window.urAPI.sendTabState({ contentId: payload.contentId, title: payload.title, path: payload.path, kind: payload.kind, state: { words: body.textContent.length, error: null } });
      }

      return {
        applyControl(action, value) {
          if (action === 'scroll') {
            const dir = value && value.direction === 'up' ? -1 : 1;
            container.scrollBy({ top: dir * (typeof (value && value.amount) === 'number' ? value.amount : 400) });
            return { ok: true };
          }
          return { ok: false, error: { code: 'NOT_SUPPORTED', message: `odt 渲染器不支持 ${action}` } };
        },
        getState() { return { words: body.textContent.length }; },
        capabilities: ['basic'],
        destroy() {},
      };
    },
  };
})();
