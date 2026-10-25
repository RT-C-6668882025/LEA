'use strict';
/* 纯文本 / 代码渲染器 */
(function () {
  window.URRenderers = window.URRenderers || {};

  function mountText(container, payload, api, opts) {
    const pre = document.createElement('pre');
    pre.className = 'text-body' + (opts.code ? ' code' : '');
    pre.textContent = payload.text || '';
    container.appendChild(pre);

    const ui = api.uiState || {};
    const st = { fontSize: Number(ui.fontSize) || (opts.code ? 14 : 16) };
    pre.style.fontSize = st.fontSize + 'px';

    let saveTimer = null;
    container.addEventListener('scroll', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => api.saveState({ scrollRatio: currentRatio(), fontSize: st.fontSize }), 400);
    }, { passive: true });

    function currentRatio() {
      const max = container.scrollHeight - container.clientHeight;
      return max > 0 ? container.scrollTop / max : 0;
    }
    const sr = Number(ui.scrollRatio || 0);
    if (sr > 0) requestAnimationFrame(() => { container.scrollTop = sr * (container.scrollHeight - container.clientHeight); });

    api.ready({ state: { scrollRatio: sr } });

    return {
      applyControl(action, value) {
        if (action === 'scroll') {
          const v = value || {};
          const dir = v.direction === 'up' ? -1 : 1;
          if (v.amount === 'top') container.scrollTop = 0;
          else if (v.amount === 'bottom') container.scrollTop = container.scrollHeight;
          else if (v.amount === 'page') container.scrollBy({ top: dir * container.clientHeight * 0.9 });
          else container.scrollBy({ top: dir * (typeof v.amount === 'number' ? v.amount : 340) });
          return { ok: true, state: this.getState() };
        }
        if (action === 'set_font_size') {
          const n = parseInt(value, 10);
          if (!(n >= 12 && n <= 32)) return { ok: false, error: { code: 'INVALID_PARAM', message: 'font_size 需为 12~32' } };
          st.fontSize = n;
          pre.style.fontSize = n + 'px';
          api.saveState({ fontSize: n });
          return { ok: true, state: this.getState() };
        }
        return { ok: false, error: { code: 'NOT_SUPPORTED', message: `文本渲染器不支持 ${action}` } };
      },
      getState() { return { scrollRatio: currentRatio(), fontSize: st.fontSize }; },
      onKey(e) {
        if (e.key === 'ArrowDown' || e.key === 'PageDown') container.scrollBy({ top: container.clientHeight * 0.85 });
        else if (e.key === 'ArrowUp' || e.key === 'PageUp') container.scrollBy({ top: -container.clientHeight * 0.85 });
        else if (e.key === '=' ) this.applyControl('set_font_size', Math.min(32, st.fontSize + 1));
        else if (e.key === '-') this.applyControl('set_font_size', Math.max(12, st.fontSize - 1));
        else return;
        e.preventDefault();
      },
      capabilities: ['scroll', 'set_font_size'],
      destroy() {},
    };
  }

  window.URRenderers.text = {
    mount(container, payload, api) { return mountText(container, payload, api, { code: false }); },
  };
  window.URRenderers.code = {
    mount(container, payload, api) { return mountText(container, payload, api, { code: true }); },
  };
})();
