'use strict';
/* HTML 沙箱渲染器：iframe sandbox（无同源权限），内容由主进程经 ur-render:// 提供，
   页内 CSP 禁止网络与本地文件访问，仅允许内联脚本与样式。 */
(function () {
  window.URRenderers = window.URRenderers || {};
  window.URRenderers.html = {
    mount(container, payload, api) {
      if (!payload.renderUrl) {
        api.fail('缺少沙箱渲染地址');
        return {};
      }
      container.style.overflow = 'hidden';
      const frame = document.createElement('iframe');
      frame.className = 'html-frame';
      frame.setAttribute('sandbox', 'allow-scripts allow-forms');
      frame.src = payload.renderUrl;
      frame.addEventListener('load', () => {
        api.ready({});
      });
      container.appendChild(frame);
      // 兜底：极少数情况下 load 不触发，避免 MCP 长时间等待
      const t = setTimeout(() => api.ready({}), 6000);
      return {
        applyControl(action) {
          return { ok: false, error: { code: 'NOT_SUPPORTED', message: `沙箱 HTML 不支持控制操作 ${action}（隔离环境不暴露内部状态）` } };
        },
        getState() { return { sandbox: true }; },
        capabilities: [],
        destroy() { clearTimeout(t); frame.src = 'about:blank'; },
      };
    },
  };
})();
