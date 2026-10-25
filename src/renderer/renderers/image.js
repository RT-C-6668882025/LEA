'use strict';
/* 图片查看器：滚轮缩放（以光标为中心）、拖拽平移、双击适应 */
(function () {
  window.URRenderers = window.URRenderers || {};
  window.URRenderers.image = {
    mount(container, payload, api) {
      container.classList.add('img-host');
      const wrap = document.createElement('div');
      wrap.className = 'img-wrap';
      const img = document.createElement('img');
      img.src = window.urFileUrl(payload.path);
      img.draggable = false;
      wrap.appendChild(img);
      const hint = document.createElement('div');
      hint.className = 'img-hint';
      wrap.appendChild(hint);
      container.style.overflow = 'hidden';
      container.appendChild(wrap);

      const ui = api.uiState || {};
      const st = { zoom: 1, fit: true, px: 0, py: 0, nw: 0, nh: 0 };
      let fitZoom = 1;

      function displayZoom() { return st.fit ? fitZoom : st.zoom; }
      function applyTransform() {
        const z = displayZoom();
        img.style.transform = `translate(${st.px}px, ${st.py}px) scale(${z})`;
        hint.textContent = st.fit ? '适应窗口' : Math.round(z * 100) + '%';
      }
      function computeFit() {
        if (!st.nw) return;
        fitZoom = Math.min((container.clientWidth - 40) / st.nw, (container.clientHeight - 40) / st.nh, 1);
        if (st.fit) { st.px = 0; st.py = 0; }
        applyTransform();
      }

      img.addEventListener('load', () => {
        st.nw = img.naturalWidth || 1;
        st.nh = img.naturalHeight || 1;
        computeFit();
        if (typeof ui.zoom === 'number' && ui.zoom > 0) {
          st.fit = false;
          st.zoom = ui.zoom;
          st.px = ui.px || 0;
          st.py = ui.py || 0;
          applyTransform();
        }
        api.saveState({ zoom: displayZoom(), fit: st.fit });
        api.ready({ state: { zoom: displayZoom(), fit: st.fit } });
      });
      img.addEventListener('error', () => {
        api.fail('图片加载失败：文件损坏或格式不受支持');
      });

      const ro = new ResizeObserver(() => computeFit());
      ro.observe(container);

      wrap.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        if (st.fit) { st.zoom = fitZoom; st.fit = false; }
        st.zoom = Math.min(40, Math.max(0.02, st.zoom * factor));
        applyTransform();
        api.saveState({ zoom: st.zoom, fit: false });
      }, { passive: false });

      let dragging = false, lx = 0, ly = 0;
      wrap.addEventListener('pointerdown', (e) => {
        dragging = true; lx = e.clientX; ly = e.clientY;
        wrap.setPointerCapture(e.pointerId);
      });
      wrap.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        st.px += e.clientX - lx;
        st.py += e.clientY - ly;
        lx = e.clientX; ly = e.clientY;
        if (st.fit) { st.zoom = fitZoom; st.fit = false; }
        applyTransform();
      });
      wrap.addEventListener('pointerup', () => {
        if (!dragging) return;
        dragging = false;
        api.saveState({ zoom: displayZoom(), fit: st.fit, px: st.px, py: st.py });
      });
      wrap.addEventListener('dblclick', () => {
        if (st.fit) { st.zoom = 1; st.fit = false; } else { st.fit = true; st.px = 0; st.py = 0; }
        applyTransform();
        api.saveState({ zoom: displayZoom(), fit: st.fit, px: st.px, py: st.py });
      });

      function zoomTo(target) {
        st.zoom = Math.min(40, Math.max(0.02, target));
        st.fit = false;
        applyTransform();
        api.saveState({ zoom: st.zoom, fit: false });
      }

      return {
        applyControl(action, value) {
          switch (action) {
            case 'zoom': {
              if (value === 'in') zoomTo(displayZoom() * 1.25);
              else if (value === 'out') zoomTo(displayZoom() / 1.25);
              else if (value === 'reset') zoomTo(1);
              else if (typeof value === 'number') zoomTo(value);
              else return { ok: false, error: { code: 'INVALID_PARAM', message: "zoom 需为 'in'|'out'|'reset'|数字" } };
              return { ok: true, state: this.getState() };
            }
            case 'fit': {
              st.fit = true; st.px = 0; st.py = 0;
              computeFit();
              api.saveState({ zoom: displayZoom(), fit: true, px: 0, py: 0 });
              return { ok: true, state: this.getState() };
            }
            case 'scroll': {
              const v = value || {};
              const dir = v.direction === 'up' ? -1 : 1;
              const amt = typeof v.amount === 'number' ? v.amount : 120;
              st.py -= dir * amt;
              if (st.fit) { st.zoom = fitZoom; st.fit = false; }
              applyTransform();
              return { ok: true, state: this.getState() };
            }
            default:
              return { ok: false, error: { code: 'NOT_SUPPORTED', message: `image 渲染器不支持 ${action}` } };
          }
        },
        getState() { return { zoom: Math.round(displayZoom() * 100) / 100, fit: st.fit }; },
        onKey(e) {
          if (e.key === '+' || e.key === '=') zoomTo(displayZoom() * 1.25);
          else if (e.key === '-') zoomTo(displayZoom() / 1.25);
          else if (e.key === '0') { st.fit = true; st.px = 0; st.py = 0; computeFit(); }
          else if (e.key === 'ArrowUp') this.applyControl('scroll', { direction: 'up', amount: 100 });
          else if (e.key === 'ArrowDown') this.applyControl('scroll', { direction: 'down', amount: 100 });
          else return;
          e.preventDefault();
        },
        getPanels() {
          const self = this;
          return [{
            id: 'view', icon: 'image', title: '视图',
            build(el) {
              el.innerHTML = '<div class="panel-group">缩放</div><div class="panel-btns"><button data-z="in">放大</button><button data-z="out">缩小</button><button data-z="reset">100%</button><button data-z="fit">适应窗口</button></div><div class="panel-kv"><b>当前</b><span>' + Math.round(self.getState().zoom * 100) + '%</span></div>';
              el.querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => self.applyControl('zoom', b.dataset.z)));
            },
          }];
        },
        capabilities: ['zoom', 'fit'],
        destroy() { ro.disconnect(); container.classList.remove('img-host'); img.src = ''; },
      };
    },
  };
})();
