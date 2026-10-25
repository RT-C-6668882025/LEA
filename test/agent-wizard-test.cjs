'use strict';
// 在无 GUI 环境验证剪贴板内容，防止豆包命令框再次收到 JSON。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

async function check(commandPath) {
  const nodes = new Map();
  const clipboard = [];
  const element = () => ({
    style: {}, innerHTML: '', textContent: '', disabled: false,
    addEventListener(event, handler) { this[event] = handler; },
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    },
  });
  const overlay = element();
  const window = {
    urAPI: {
      appInfo: async () => ({ mcpServerPath: commandPath }),
      clipboardWrite: async (value) => clipboard.push(value),
    },
    urIcon: () => '',
  };
  const document = {
    createElement: () => overlay,
    body: { appendChild() {} },
    addEventListener() {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/agent-wizard.js'), 'utf8'), {
    window, document, setTimeout() {},
  });
  await window.urAgentWizard.show();
  const commandButton = nodes.get('#aw-copy-cmd');
  const jsonButton = nodes.get('#aw-copy-json');
  if (!commandPath) {
    assert.equal(commandButton.disabled, true);
    assert.equal(jsonButton.disabled, true);
    return;
  }
  await commandButton.click();
  const command = clipboard.pop();
  assert.equal(command, /\s/.test(commandPath) ? `"${commandPath}"` : commandPath);
  assert.equal(command, nodes.get('#aw-command').textContent);
  await jsonButton.click();
  assert.deepEqual(JSON.parse(clipboard.pop()), { mcpServers: { lea: { command: commandPath, args: [] } } });
}

(async () => {
  for (const command of ['C:\\Users\\User\\LEA\\mcp-server.exe', 'C:\\Program Files\\LEA\\mcp-server.exe', null]) {
    await check(command);
  }
  console.log('PASS: 豆包命令、含空格路径、标准 JSON 和开发模式');
})().catch((error) => { console.error(error); process.exitCode = 1; });
