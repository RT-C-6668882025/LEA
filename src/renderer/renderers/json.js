'use strict';
/* JSON 渲染器：格式化缩进展示；解析失败时明确提示并按原文显示 */
(function () {
  window.URRenderers = window.URRenderers || {};
  window.URRenderers.json = {
    mount(container, payload, api) {
      let pretty = null;
      let invalid = false;
      try {
        pretty = JSON.stringify(JSON.parse(payload.text), null, 2);
      } catch {
        invalid = true;
        pretty = payload.text || '';
      }
      if (invalid) {
        const banner = document.createElement('div');
        banner.className = 'json-banner';
        banner.textContent = 'JSON 解析失败：文件不是有效的 JSON，已按原文显示。';
        container.appendChild(banner);
      }
      const sub = {
        text: pretty,
      };
      const textRenderer = window.URRenderers.code;
      const handle = textRenderer.mount(container, sub, api, { code: true });
      return handle;
    },
  };
})();
