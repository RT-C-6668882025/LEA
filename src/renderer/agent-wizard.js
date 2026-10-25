'use strict';
/* 「接入 Agent」向导：显示本机真实命令路径与完整 JSON，一键复制，粘贴即用 */
(function () {
  let overlay = null;
  let info = null; // { mcpServerPath, version }

  async function ensureInfo() {
    if (info) return info;
    try { info = await window.urAPI.appInfo(); } catch { info = {}; }
    return info;
  }

  function buildJson(p) {
    return JSON.stringify({ mcpServers: { lea: { command: p, args: [] } } }, null, 2);
  }

  async function show() {
    await ensureInfo();
    if (overlay) { overlay.style.display = ''; return; }
    overlay = document.createElement('div');
    overlay.id = 'agent-wizard';
    overlay.innerHTML = `
      <div class="aw-box">
        <div class="aw-head"><span class="aw-ic">${window.urIcon('plug', 20)}</span><b>接入 AI Agent</b><button class="aw-close" title="关闭">${window.urIcon('x', 15)}</button></div>
        <div class="aw-body">
          <div class="aw-steps">
            <div class="aw-step"><span class="aw-n">1</span><div><b>复制配置</b><p>点下面"复制配置"，自动填好你电脑的路径</p></div></div>
            <div class="aw-step"><span class="aw-n">2</span><div><b>打开豆包桌面版</b><p>左侧「技能 · 连接器 · 伙伴」→「新建自定义连接器」→「本地命令 (stdio)」</p></div></div>
            <div class="aw-step"><span class="aw-n">3</span><div><b>粘贴并启用</b><p>粘贴 JSON（或只填命令路径），保存后「信任 + 启用」</p></div></div>
            <div class="aw-step"><span class="aw-n">4</span><div><b>验证</b><p>对豆包说："用 lea 打开 C:\\Windows\\Media\\Alarm01.wav 并播放"</p></div></div>
          </div>
          <div class="aw-cfg">
            <div class="aw-cfg-head"><span>MCP 配置（标准 JSON）</span></div>
            <pre class="aw-code" id="aw-json"></pre>
            <div class="aw-cfg-actions">
              <button class="aw-copy" id="aw-copy-json">${window.urIcon('copy', 14)}复制配置</button>
              <button class="aw-copy ghost" id="aw-copy-cmd">${window.urIcon('copy', 14)}只复制命令路径</button>
            </div>
          </div>
          <p class="aw-note">Claude Desktop / Cline 等标准客户端：把 JSON 粘进它们的 MCP 配置文件即可。详细排查见 docs/02。</p>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) hide(); });
    overlay.querySelector('.aw-close').addEventListener('click', hide);
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape' && overlay && overlay.style.display !== 'none') hide(); });
    render();
  }

  function render() {
    const p = info && info.mcpServerPath;
    const jsonEl = overlay.querySelector('#aw-json');
    const cmdBtn = overlay.querySelector('#aw-copy-cmd');
    if (p) {
      jsonEl.textContent = buildJson(p);
      overlay.querySelector('#aw-copy-json').addEventListener('click', async () => {
        await window.urAPI.clipboardWrite(buildJson(p));
        flash(overlay.querySelector('#aw-copy-json'));
      });
      cmdBtn.addEventListener('click', async () => {
        await window.urAPI.clipboardWrite(p);
        flash(cmdBtn);
      });
    } else {
      jsonEl.textContent = '（开发模式：安装正式版后，这里会显示你电脑的一键配置）';
      overlay.querySelector('#aw-copy-json').disabled = true;
      cmdBtn.disabled = true;
    }
  }

  function flash(btn) {
    const old = btn.innerHTML;
    btn.innerHTML = window.urIcon('check', 14) + '已复制';
    setTimeout(() => { btn.innerHTML = old; }, 1400);
  }

  function hide() { if (overlay) overlay.style.display = 'none'; }

  window.urAgentWizard = { show, toggle: () => (!overlay || overlay.style.display === 'none') ? show() : hide() };
})();
