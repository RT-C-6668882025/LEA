'use strict';
/* Markdown 渲染器：marked 解析 + DOMPurify 消毒；支持滚动、字号、主题 */
(function () {
  window.URRenderers = window.URRenderers || {};
  window.URRenderers.markdown = {
    mount(container, payload, api) {
      const body = document.createElement('div');
      body.className = 'markdown-body reading';
      container.appendChild(body);

      const ui = api.uiState || {};
      const p = payload.params || {};
      const st = {
        theme: ui.theme || p.theme || 'light',
        fontSize: ui.fontSize || p.fontSize || 17,
        lineHeight: ui.lineHeight || 1.75,
        viewMode: p.viewMode || 'reading',
      };
      body.dataset.theme = st.theme;
      if (st.viewMode === 'document') body.classList.remove('reading');
      body.style.fontSize = st.fontSize + 'px';
      body.style.lineHeight = String(st.lineHeight);

      let raw = '';
      try { raw = window.marked.parse(payload.text || ''); } catch (e) {
        api.fail(`Markdown 解析失败: ${e.message}`);
        return {};
      }
      const clean = window.DOMPurify.sanitize(raw, {
        FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'select', 'textarea', 'object', 'embed', 'video', 'audio', 'source', 'link', 'meta', 'script'],
        FORBID_ATTR: ['srcset'],
      });
      body.innerHTML = clean;
      body.querySelectorAll('a[href]').forEach((a) => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          const href = a.getAttribute('href') || '';
          if (/^https?:/i.test(href)) window.urAPI.openExternal(href);
        });
      });

      let saveTimer = null;
      container.addEventListener('scroll', () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => api.saveState({ scrollRatio: currentRatio() }), 400);
      }, { passive: true });

      function currentRatio() {
        const max = container.scrollHeight - container.clientHeight;
        return max > 0 ? container.scrollTop / max : 0;
      }

      // 恢复上次阅读位置
      const sr = Number(ui.scrollRatio || 0);
      if (sr > 0) {
        requestAnimationFrame(() => {
          container.scrollTop = sr * (container.scrollHeight - container.clientHeight);
        });
      }

      api.ready({ state: { scrollRatio: sr } });

      return {
        applyControl(action, value) {
          if (action === 'scroll') {
            const v = value || {};
            const dir = v.direction === 'up' ? -1 : 1;
            if (v.amount === 'top') container.scrollTop = 0;
            else if (v.amount === 'bottom') container.scrollTop = container.scrollHeight;
            else if (v.amount === 'page') container.scrollBy({ top: dir * container.clientHeight * 0.9, behavior: 'smooth' });
            else container.scrollBy({ top: dir * (typeof v.amount === 'number' ? v.amount : 340) });
            return { ok: true, state: this.getState() };
          }
          if (action === 'set_theme') {
            if (!['light', 'dark', 'sepia'].includes(value)) return { ok: false, error: { code: 'INVALID_PARAM', message: 'theme 需为 light/dark/sepia' } };
            st.theme = value;
            body.dataset.theme = value;
            api.saveState({ theme: value });
            return { ok: true, state: this.getState() };
          }
          if (action === 'set_font_size') {
            const n = parseInt(value, 10);
            if (!(n >= 12 && n <= 32)) return { ok: false, error: { code: 'INVALID_PARAM', message: 'font_size 需为 12~32 的整数' } };
            st.fontSize = n;
            body.style.fontSize = n + 'px';
            api.saveState({ fontSize: n });
            return { ok: true, state: this.getState() };
          }
          if (action === 'set_line_height') {
            const n = parseFloat(value);
            if (!(n >= 1.2 && n <= 2.6)) return { ok: false, error: { code: 'INVALID_PARAM', message: 'line_height 需为 1.2~2.6' } };
            st.lineHeight = n;
            body.style.lineHeight = String(n);
            api.saveState({ lineHeight: n });
            return { ok: true, state: this.getState() };
          }
          return { ok: false, error: { code: 'NOT_SUPPORTED', message: `markdown 渲染器不支持 ${action}` } };
        },
        getState() {
          return { scrollRatio: currentRatio(), theme: st.theme, fontSize: st.fontSize, lineHeight: st.lineHeight };
        },
        onKey(e) {
          if (e.key === 'ArrowDown' || e.key === 'PageDown') container.scrollBy({ top: container.clientHeight * 0.85 });
          else if (e.key === 'ArrowUp' || e.key === 'PageUp') container.scrollBy({ top: -container.clientHeight * 0.85 });
          else if (e.key === '=') this.applyControl('set_font_size', Math.min(32, st.fontSize + 1));
          else if (e.key === '-') this.applyControl('set_font_size', Math.max(12, st.fontSize - 1));
          else if (e.key === '0') this.applyControl('set_font_size', 17);
          else return;
          e.preventDefault();
        },
        getTree() {
          const heads = [...body.querySelectorAll('h1,h2,h3')].map((h, i) => ({ lvl: Number(h.tagName[1]), text: h.textContent.trim().slice(0, 50) || '(空)', i }));
          const root = { label: '文档', icon: 'book', children: [] };
          const stack = [root];
          for (const h of heads) {
            const node = { label: h.text, icon: 'file', nav: { kind: 'md', i: h.i } };
            while (stack.length > 1 && stack[stack.length - 1].lvl >= h.lvl) stack.pop();
            (stack[stack.length - 1].children || (stack[stack.length - 1].children = [])).push(node);
            stack.push({ ...node, lvl: h.lvl, children: [] });
          }
          return { title: payload.title, root };
        },
        navigate(nav) {
          if (nav && nav.kind === 'md') {
            const hs = [...body.querySelectorAll('h1,h2,h3')];
            if (hs[nav.i]) hs[nav.i].scrollIntoView({ block: 'start', behavior: 'smooth' });
            return { ok: true };
          }
          return { ok: false };
        },
        getPanels() {
          const self = this;
          const heads = () => [...body.querySelectorAll('h1,h2,h3')].map((h) => ({ lvl: Number(h.tagName[1]), text: h.textContent.trim().slice(0, 50) || '(空)', el: h }));
          const headTree = () => {
            const items = heads();
            const root = { label: '文档', icon: 'book', children: [], onClick: () => container.scrollTo({ top: 0 }) };
            const stack = [root];
            for (const h of items) {
              const node = { label: h.text, icon: 'file', onClick: () => h.el.scrollIntoView({ block: 'start', behavior: 'smooth' }) };
              while (stack.length > 1 && stack[stack.length - 1].lvl >= h.lvl) stack.pop();
              const parent = stack[stack.length - 1];
              node.lvl = h.lvl;
              (parent.children || (parent.children = [])).push(node);
              stack.push(node);
            }
            return [root];
          };
          return [
            {
              id: 'outline', icon: 'tree', title: '结构树',
              build(el) {
                const items = heads();
                if (!items.length) { el.innerHTML = '<div class="sb-empty">文档中没有标题</div>'; return; }
                window.urTree(el, headTree());
              },
            },
            {
              id: 'look', icon: 'eye', title: '外观',
              build(el) {
                el.innerHTML = '<div class="panel-group">主题</div><div class="panel-btns"><button data-t="light">米白</button><button data-t="dark">暗色</button><button data-t="sepia">羊皮纸</button></div><div class="panel-group">字号</div><div class="panel-btns"><button data-d="1">A＋</button><button data-d="-1">A−</button></div><div class="panel-group">行距</div><div class="panel-btns"><button data-l="-0.15">紧</button><button data-l="0.15">松</button></div>';
                el.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { self.applyControl('set_theme', b.dataset.t); el.querySelectorAll('[data-t]').forEach((x) => x.classList.remove('active')); b.classList.add('active'); }));
                el.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => self.applyControl('set_font_size', st.fontSize + Number(b.dataset.d))));
                el.querySelectorAll('[data-l]').forEach((b) => b.addEventListener('click', () => self.applyControl('set_line_height', Math.round((st.lineHeight + Number(b.dataset.l)) * 100) / 100)));
              },
            },
          ];
        },
        capabilities: ['scroll', 'set_theme', 'set_font_size'],
        destroy() {},
      };
    },
  };
})();
