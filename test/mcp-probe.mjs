// MCP 探针（文件夹即应用架构）：快速验证 7 工具与应用开闭
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [, , cmd, ...cmdArgs] = process.argv;
if (!cmd) { console.error('用法: node test/mcp-probe.mjs <command> [args...]'); process.exit(2); }

const child = spawn(cmd, cmdArgs, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
child.stderr.on('data', (d) => process.stderr.write(`  [srv] ${d}`));
child.on('error', (e) => { console.error('spawn 失败:', e.message); process.exit(2); });

let buf = '';
const waiters = [];
child.stdout.setEncoding('utf8');
child.stdout.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    try { const m = JSON.parse(line); const w = waiters.find((x) => x.id === m.id); if (w) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); } } catch {}
  }
});
let id = 0;
const rpc = (method, params, timeout = 90000) => new Promise((res, rej) => {
  const mid = ++id;
  const t = setTimeout(() => rej(new Error('timeout ' + method)), timeout);
  waiters.push({ id: mid, resolve: (x) => { clearTimeout(t); res(x); } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: mid, method, params }) + '\n');
});
const tool = async (n, a) => {
  const r = await rpc('tools/call', { name: n, arguments: a || {} });
  return { isError: r.result.isError, data: JSON.parse(r.result.content[0].text) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail ? JSON.stringify(detail).slice(0, 200) : ''}`); }
};

console.log(`探针目标: ${cmd} ${cmdArgs.join(' ')}`);
const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } });
check('initialize', !!init.result && init.result.serverInfo.name === 'lea');
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const tl = await rpc('tools/list', {});
check('tools/list=10', tl.result.tools.length === 10, tl.result.tools.map((t) => t.name));

const la = await tool('list_folders');
check('list_folders', la.data && la.data.ok === true && typeof la.data.root === 'string', la);

const md = await tool('open_folder', { path: join(root, 'test', 'fixtures', 'sample.md') });
check('open_folder 打开本地文件（内置渲染器）', md.data && md.data.ok === true && md.data.status !== 'error', md);

const appDir = join(la.data.root, 'probe-app');
await tool('write_file', { path: join(appDir, 'index.html'), content: '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Probe App</title></head><body><h1>Probe OK</h1></body></html>' });
await tool('write_file', { path: join(appDir, 'app.json'), content: JSON.stringify({ name: 'Probe App', entry: 'index.html', permissions: [] }) });
const oa = await tool('open_folder', { path: appDir });
check('open_folder 打开文件夹', oa.data && oa.data.ok === true && oa.data.status === 'rendered', oa);
await sleep(1200);
const st = await tool('get_view_state');
const at = st.data.tabs.find((t) => t.contentId === oa.data.contentId);
check('文件夹运行时标题', at && at.state && at.state.folder && at.state.folder.title === 'Probe App', at && at.state);

child.stdin.end();
await sleep(300);
console.log(`\n探针结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
