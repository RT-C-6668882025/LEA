'use strict';
/* PDF 渲染器：PDF.js 3.11，按需渲染可见页；支持翻页、缩放、滚动记忆 */
(function () {
  window.URRenderers = window.URRenderers || {};
  const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

  window.URRenderers.pdf = {
    mount(container, payload, api) {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          new URL('../../node_modules/pdfjs-dist/build/pdf.worker.min.js', window.location.href).href;
      } catch (e) {
        console.error('workerSrc 设置失败（将退回主线程渲染）', e);
      }

      const wrap = document.createElement('div');
      wrap.className = 'pdf-wrap';
      container.appendChild(wrap);

      const ui = api.uiState || {};
      const st = { page: 1, pages: 0, zoomIdx: 3, fit: true, fitScale: 1 };
      let doc = null;
      let io = null;
      const pageEls = [];
      const baseSizes = []; // scale=1 时的 {w, h}

      function displayScale() { return st.fit ? st.fitScale : ZOOMS[st.zoomIdx]; }
      function pushState() {
        api.saveState({ page: st.page, pages: st.pages, zoom: st.fit ? 'fit' : ZOOMS[st.zoomIdx] });
      }

      container.addEventListener('scroll', () => {
        const top = container.scrollTop;
        let cur = 1;
        for (let i = 0; i < pageEls.length; i++) {
          if (pageEls[i].offsetTop <= top + 100) cur = i + 1;
        }
        if (cur !== st.page) { st.page = cur; pushState(); }
      }, { passive: true });

      window.pdfjsLib.getDocument({ url: window.urFileUrl(payload.path) }).promise.then(async (d) => {
        doc = d;
        st.pages = d.numPages;
        for (let n = 1; n <= d.numPages; n++) {
          const page = await d.getPage(n);
          const vp = page.getViewport({ scale: 1 });
          baseSizes.push({ w: vp.width, h: vp.height });
          const ph = document.createElement('div');
          ph.className = 'pdf-page';
          ph.dataset.page = n;
          const canvas = document.createElement('canvas');
          ph.appendChild(canvas);
          const label = document.createElement('div');
          label.className = 'pdf-page-label';
          label.textContent = n;
          ph.appendChild(label);
          wrap.appendChild(ph);
          pageEls.push(ph);
        }
        computeFit();
        io = new IntersectionObserver((entries) => {
          for (const en of entries) if (en.isIntersecting) renderPage(Number(en.target.dataset.page));
        }, { root: container, rootMargin: '240px' });
        pageEls.forEach((el) => io.observe(el));
        layoutAll();
        if (ui.page && ui.page > 1 && ui.page <= st.pages) {
          setTimeout(() => gotoPage(Number(ui.page), true), 60);
        }
        pushState();
        api.ready({ state: { page: st.page, pages: st.pages } });
      }).catch((err) => {
        api.fail(`PDF 加载失败: ${err && err.message}`);
      });

      function computeFit() {
        if (!baseSizes.length) return;
        st.fitScale = Math.max(0.2, (container.clientWidth - 48) / baseSizes[0].w);
      }

      function layoutAll() {
        if (!doc) return;
        const s = displayScale();
        pageEls.forEach((ph, i) => {
          ph.style.width = Math.floor(baseSizes[i].w * s) + 'px';
          ph.style.height = Math.floor(baseSizes[i].h * s) + 'px';
          ph.dataset.rendered = '';
        });
        requestAnimationFrame(() => {
          pageEls.forEach((ph, i) => {
            const r = ph.getBoundingClientRect();
            if (r.bottom > 0 && r.top < container.clientHeight) renderPage(i + 1);
          });
        });
      }

      const inFlight = new Map(); // 页码 → 渲染 Promise，避免同一 canvas 并发 render
      async function renderPage(n) {
        if (!doc || !pageEls[n - 1]) return;
        if (inFlight.has(n)) return inFlight.get(n);
        const ph = pageEls[n - 1];
        const s = displayScale();
        if (ph.dataset.rendered === String(s)) return;
        const task = (async () => {
          try {
            const page = await doc.getPage(n);
            if (displayScale() !== s) return;
            const dpr = window.devicePixelRatio || 1;
            const vp = page.getViewport({ scale: s * dpr });
            const canvas = ph.querySelector('canvas');
            canvas.width = Math.floor(vp.width);
            canvas.height = Math.floor(vp.height);
            canvas.style.width = Math.floor(vp.width / dpr) + 'px';
            canvas.style.height = Math.floor(vp.height / dpr) + 'px';
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
            ph.dataset.rendered = String(s);
          } catch (err) {
            console.error(`第 ${n} 页渲染失败`, err);
          }
        })();
        inFlight.set(n, task);
        try { await task; } finally { inFlight.delete(n); }
      }

      function gotoPage(n) {
        if (!doc) return { ok: false, error: { code: 'NOT_READY', message: 'PDF 尚未加载完成' } };
        n = Math.max(1, Math.min(st.pages, parseInt(n, 10) || 1));
        st.page = n;
        pageEls[n - 1].scrollIntoView({ block: 'start' });
        pushState();
        return { ok: true, state: { page: st.page, pages: st.pages } };
      }

      const ro = new ResizeObserver(() => {
        if (st.fit) { computeFit(); layoutAll(); }
      });
      ro.observe(container);

      return {
        applyControl(action, value) {
          switch (action) {
            case 'goto_page': return gotoPage.call(this, value);
            case 'next_page': return gotoPage.call(this, st.page + 1);
            case 'prev_page': return gotoPage.call(this, st.page - 1);
            case 'zoom': {
              if (value === 'reset') { st.fit = true; }
              else {
                st.fit = false;
                if (value === 'in') st.zoomIdx = Math.min(ZOOMS.length - 1, st.zoomIdx + 1);
                else if (value === 'out') st.zoomIdx = Math.max(0, st.zoomIdx - 1);
                else { const z = parseFloat(value); const i = ZOOMS.findIndex((x) => x >= z); st.zoomIdx = i < 0 ? ZOOMS.length - 1 : i; }
              }
              layoutAll();
              pushState();
              return { ok: true, state: this.getState() };
            }
            case 'fit': {
              st.fit = true;
              computeFit();
              layoutAll();
              pushState();
              return { ok: true, state: this.getState() };
            }
            case 'scroll': {
              const v = value || {};
              const dir = v.direction === 'up' ? -1 : 1;
              if (v.amount === 'page') container.scrollBy({ top: dir * container.clientHeight * 0.9 });
              else if (v.amount === 'top') container.scrollTop = 0;
              else if (v.amount === 'bottom') container.scrollTop = container.scrollHeight;
              else container.scrollBy({ top: dir * (typeof v.amount === 'number' ? v.amount : 400) });
              return { ok: true };
            }
            default:
              return { ok: false, error: { code: 'NOT_SUPPORTED', message: `pdf 渲染器不支持 ${action}` } };
          }
        },
        getState() {
          return { page: st.page, pages: st.pages, zoom: st.fit ? 'fit' : ZOOMS[st.zoomIdx] };
        },
        onKey(e) {
          if (e.key === 'ArrowRight' || e.key === 'PageDown') this.applyControl('next_page');
          else if (e.key === 'ArrowLeft' || e.key === 'PageUp') this.applyControl('prev_page');
          else if (e.key === '+' || e.key === '=') this.applyControl('zoom', 'in');
          else if (e.key === '-') this.applyControl('zoom', 'out');
          else if (e.key === '0') this.applyControl('zoom', 'reset');
          else return;
          e.preventDefault();
        },
        getTree() {
          if (!doc) return { title: payload.title, root: { label: '加载中…', icon: 'file', children: [] } };
          return { title: payload.title, root: { label: 'PDF（' + st.pages + ' 页）', icon: 'file', count: st.pages, children: Array.from({ length: st.pages }, (_, k) => ({ label: '第 ' + (k + 1) + ' 页', icon: 'file', nav: { kind: 'pdf', page: k + 1 } })) } };
        },
        navigate(nav) {
          if (nav && nav.kind === 'pdf') return this.applyControl ? this.applyControl('goto_page', nav.page) : (gotoPage(nav.page), { ok: true });
          return { ok: false };
        },
        getPanels() {
          if (!doc) return [];
          return [{
            id: 'pages', icon: 'file', title: '页面',
            build(el) {
              window.urTree(el, [{
                label: '文档（' + st.pages + ' 页）',
                icon: 'file',
                count: st.pages,
                children: Array.from({ length: st.pages }, (_, k) => ({
                  label: '第 ' + (k + 1) + ' 页',
                  icon: 'file',
                  active: k + 1 === st.page,
                  onClick: () => gotoPage(k + 1),
                })),
              }]);
            },
          }];
        },
        capabilities: ['goto_page', 'zoom', 'scroll'],
        destroy() {
          if (io) io.disconnect();
          ro.disconnect();
          if (doc) { try { doc.destroy(); } catch {} }
        },
      };
    },
  };
})();
