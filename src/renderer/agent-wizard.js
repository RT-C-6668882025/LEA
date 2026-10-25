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
            <div class="aw-step"><span class="aw-n">1</span><div><b>复制豆包启动命令</b><p>点下面“复制豆包启动命令”，自动使用本机安装路径</p></div></div>
            <div class="aw-step"><span class="aw-n">2</span><div><b>打开豆包桌面版</b><p>左侧「技能 · 连接器 · 伙伴」→「新建自定义连接器」→「本地命令 (stdio)」</p></div></div>
            <div class="aw-step"><span class="aw-n">3</span><div><b>填写启动命令</b><p>粘贴到“命令”输入框，参数和环境变量留空。不要把 JSON 粘进命令框。保存后信任并启用。</p></div></div>
            <div class="aw-step"><span class="aw-n">4</span><div><b>验证连接</b><p>连接成功应显示 10 个工具。对豆包说：“用 lea 列出工作区文件夹”。</p></div></div>
          </div>
          <div class="aw-cfg">
            <div class="aw-cfg-head"><span>豆包桌面版 · 本地启动命令</span></div>
            <pre class="aw-code" id="aw-command"></pre>
            <div class="aw-cfg-actions">
              <button class="aw-copy" id="aw-copy-cmd">${window.urIcon('copy', 14)}复制豆包启动命令</button>
            </div>
          </div>
          <details class="aw-cfg"><summary>其他客户端：标准 MCP JSON 配置</summary>
            <pre class="aw-code" id="aw-json"></pre>
            <div class="aw-cfg-actions"><button class="aw-copy ghost" id="aw-copy-json">${window.urIcon('copy', 14)}复制 JSON 配置</button></div>
          </details>
          <p class="aw-note">JSON 供 Claude Desktop / Cline 等客户端的 MCP 配置文件使用。豆包的命令框只填写上方启动命令。</p>
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
    const commandEl = overlay.querySelector('#aw-command');
    if (p) {
      // 豆包按命令行解析输入；带空格的安装路径需要双引号。
      const command = /\s/.test(p) ? `"${p}"` : p;
      commandEl.textContent = command;
      jsonEl.textContent = buildJson(p);
      overlay.querySelector('#aw-copy-json').addEventListener('click', async () => {
        await window.urAPI.clipboardWrite(buildJson(p));
        flash(overlay.querySelector('#aw-copy-json'));
      });
      cmdBtn.addEventListener('click', async () => {
        await window.urAPI.clipboardWrite(command);
        flash(cmdBtn);
      });
    } else {
      commandEl.textContent = '开发模式：请安装正式版后复制启动命令。';
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
