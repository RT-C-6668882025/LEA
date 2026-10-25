// 第四阶段：用官方 @modelcontextprotocol/sdk 客户端（第三方协议实现）做真实客户端兼容测试
// 验证：官方握手/能力协商/tool 发现/调用 与我们的 server 完全兼容
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const F = (p) => join(root, 'test', 'fixtures', p);

// 目标：优先安装版 mcp-server.exe，否则开发态 node
let command, args;
if (process.argv[2]) { command = process.argv[2]; args = process.argv.slice(3); }
else {
  const installed = join(process.env.LOCALAPPDATA || '', 'Programs', 'LEA', 'mcp-server.exe');
  if (existsSync(installed)) { command = installed; args = []; }
  else { command = process.execPath; args = [join(root, 'src', 'main', 'mcp-stdio.js')]; }
}

let pass = 0, fail = 0;
const check = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, JSON.stringify(d ?? null).slice(0, 200)); } };

console.log('SDK 客户端连接:', command, args.join(' '));
const transport = new StdioClientTransport({ command, args });
const client = new Client({ name: 'ur-sdk-test', version: '1.0.0' });
await client.connect(transport);

const tl = await client.listTools();
check('官方 SDK listTools=10', tl.tools.length === 10, tl.tools.map((t) => t.name));

const la = await client.callTool({ name: 'list_folders', arguments: {} });
const laData = JSON.parse(la.content[0].text);
check('list_folders', !la.isError && laData.ok === true && typeof laData.root === 'string', laData);
const WS = laData.root;

const md = await client.callTool({ name: 'open_folder', arguments: { path: F('sample.md') } });
const mdData = JSON.parse(md.content[0].text);
check('open_folder 文件', mdData.ok === true && mdData.status !== 'error', mdData);

const st = await client.callTool({ name: 'get_view_state', arguments: {} });
const stData = JSON.parse(st.content[0].text);
check('get_view_state', stData.ok === true && Array.isArray(stData.tabs) && stData.tabs.length >= 1, stData);

const w = await client.callTool({ name: 'write_file', arguments: { path: join(WS, 'sdk-test', 'index.html'), content: '<!DOCTYPE html><html><head><meta charset="utf-8"><title>SDK App</title></head><body><h1>SDK OK</h1></body></html>' } });
check('write_file', !w.isError && JSON.parse(w.content[0].text).ok === true, w);

const oa = await client.callTool({ name: 'open_folder', arguments: { path: join(WS, 'sdk-test') } });
check('open_folder 文件夹应用', !oa.isError && JSON.parse(oa.content[0].text).ok === true, oa);
await new Promise((r) => setTimeout(r, 1200));
const st2 = await client.callTool({ name: 'get_view_state', arguments: {} });
const stData2 = JSON.parse(st2.content[0].text); const appTab = stData2.tabs.find((t) => t.state.folder && t.state.folder.name === 'sdk-test'); if (!appTab) console.log('DEBUG tabs:', JSON.stringify(stData2.tabs.map(t=>({r:t.renderer,f:t.state.folder,t:t.state.title}))), 'active:', stData2.activeContentId);
check('应用运行时标题（SDK 客户端全链路）', appTab && appTab.state.folder && appTab.state.folder.title === 'SDK App', appTab && appTab.state.folder);

// 资源清理：关闭 sdk-test 标签 + 删除文件夹
await client.callTool({ name: 'navigate_folder', arguments: { target: mdData.contentId } });
await client.callTool({ name: 'reload_folder', arguments: {} });

console.log(`\nSDK 兼容测试: ${pass} 通过, ${fail} 失败`);
await client.close();
process.exit(fail ? 1 : 0);
