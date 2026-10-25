'use strict';
/* 幻灯片渲染器（.slides.md）：`---` 分页的 Markdown → reveal.js（内嵌模式，离线） */
(function () {
  window.URRenderers = window.URRenderers || {};

  window.URRenderers.slides = {
    mount(container, payload, api) {
      if (!window.Reveal) { api.fail('reveal.js 未加载'); return {}; }
      const host = document.createElement('div');
      host.className = 'slides-host';
      const revealEl = document.createElement('div');
      revealEl.className = 'reveal';
      const slidesEl = document.createElement('div');
      slidesEl.className = 'slides';
      revealEl.appendChild(slidesEl);
      host.appendChild(revealEl);
      container.style.overflow = 'hidden';
      container.appendChild(host);

      const sections = String(payload.text || '')
        .split(/\r?\n---\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (!sections.length) { api.fail('幻灯片文件为空'); return {}; }

      for (const sec of sections) {
        const el = document.createElement('section');
        el.innerHTML = window.DOMPurify.sanitize(window.marked.parse(sec), {
          FORBID_TAGS: ['script', 'iframe', 'form', 'input', 'object', 'embed', 'link', 'meta'],
        });
        slidesEl.appendChild(el);
      }

      const st = { slides: sections.length, current: 1, ready: false };
      let reveal = window.Reveal;
      reveal.initialize({
        embedded: true,
        controls: true,
        progress: true,
        hash: false,
        keyboard: true,
        overview: true,
        center: true,
        width: '100%',
        height: '100%',
        margin: 0.05,
        transition: 'slide',
        backgroundTransition: 'fade',
      });
      reveal.addEventListener('ready', () => {
        st.ready = true;
        api.ready({ state: { slides: st.slides, current: 1 } });
        pushState();
      });
      reveal.addEventListener('slidechanged', (e) => {
        st.current = (e.indexh || 0) + 1;
        pushState();
      });

      function pushState() {
        window.urAPI.sendTabState({
          contentId: payload.contentId, title: payload.title, path: payload.path, kind: payload.kind,
          state: { slides: st.slides, current: st.current, error: null },
        });
      }

      return {
        applyControl(action, value) {
          switch (action) {
            case 'goto_page': {
              const n = Math.max(1, Math.min(st.slides, parseInt(value, 10) || 1));
              reveal.slide(n - 1);
              return { ok: true, state: this.getState() };
            }
            case 'next_page': reveal.next(); return { ok: true, state: this.getState() };
            case 'prev_page': reveal.prev(); return { ok: true, state: this.getState() };
            case 'scroll': return { ok: true };
            default: return { ok: false, error: { code: 'NOT_SUPPORTED', message: `slides 渲染器不支持 ${action}` } };
          }
        },
        getState() { return { slides: st.slides, current: st.current }; },
        getTree() {
          return { title: payload.title, root: { label: '幻灯片（' + st.slides + ' 页）', icon: 'film', count: st.slides, children: Array.from({ length: st.slides }, (_, k) => ({ label: '第 ' + (k + 1) + ' 页', icon: 'file', nav: { kind: 'slides', slide: k + 1 } })) } };
        },
        navigate(nav) {
          if (nav && nav.kind === 'slides') { reveal.slide(nav.slide - 1); return { ok: true }; }
          return { ok: false };
        },
        getPanels() {
          return [{
            id: 'slides', icon: 'tree', title: '结构树',
            build(el) {
              window.urTree(el, [{
                label: '幻灯片（' + st.slides + ' 页）',
                icon: 'film',
                count: st.slides,
                children: Array.from({ length: st.slides }, (_, k) => ({
                  label: '第 ' + (k + 1) + ' 页',
                  icon: 'file',
                  active: k + 1 === st.current,
                  onClick: () => reveal.slide(k),
                })),
              }]);
            },
          }];
        },
        capabilities: ['slides'],
        destroy() { try { reveal.removeEventListeners && reveal.removeEventListeners(); } catch {} },
      };
    },
  };
})();
