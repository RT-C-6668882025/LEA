// MCP 端到端冒烟测试 —— 文件夹即应用架构
// 前置：npm run fixtures（部分本地文件用例）；应用文件夹由测试通过 write_file 动态创建（即 Agent 真实工作流）
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const F = (p) => join(root, 'test', 'fixtures', p);

let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ✗ ${name}${detail ? ' — ' + JSON.stringify(detail).slice(0, 300) : ''}`); }
}

try { execSync('taskkill /IM electron.exe /F', { stdio: 'pipe' }); } catch {}
try { execSync('taskkill /IM LEA.exe /F', { stdio: 'pipe' }); } catch {}
const child = spawn(process.execPath, [join(root, 'src', 'main', 'mcp-stdio.js')], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.on('data', (d) => process.stderr.write(`  [mcp] ${d}`));
let buf = '';
const waiters = [];
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      const w = waiters.find((x) => x.id === msg.id);
      if (w) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
    } catch {}
  }
});
let rpcId = 0;
function rpc(method, params, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const id = ++rpcId;
    const timer = setTimeout(() => {
      const idx = waiters.findIndex((x) => x.id === id);
      if (idx >= 0) waiters.splice(idx, 1);
      reject(new Error(`RPC 超时: ${method}`));
    }, timeoutMs);
    waiters.push({ id, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try { execSync('taskkill /IM electron.exe /F', { stdio: 'pipe' }); } catch {}
try { execSync('taskkill /IM LEA.exe /F', { stdio: 'pipe' }); } catch {}
await sleep(500);
function parseResult(res) {
  const text = res.result && res.result.content && res.result.content[0] && res.result.content[0].text;
  try { return { isError: !!(res.result && res.result.isError), data: text ? JSON.parse(text) : null }; }
  catch { return { isError: !!(res.result && res.result.isError), data: text }; }
}
async function tool(name, args, timeoutMs) {
  const res = await rpc('tools/call', { name, arguments: args || {} }, timeoutMs);
  return parseResult(res);
}

console.log('== 1. 初始化与工具发现（文件夹即应用架构：5 核心 + 2 文件工具） ==');
const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke-test', version: '0' } });
check('initialize', !!init.result && init.result.serverInfo && init.result.serverInfo.name === 'lea');
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const tl = await rpc('tools/list', {});
const toolNames = (tl.result.tools || []).map((t) => t.name);
check('tools/list = 10（+search_content/list_versions/restore_version）',
  ['open_folder', 'list_folders', 'reload_folder', 'get_view_state', 'navigate_folder', 'write_file', 'search_content', 'list_versions', 'restore_version', 'read_file'].every((n) => toolNames.includes(n)) && toolNames.length === 10, toolNames);
check('旧内容操作工具已移除（render_content/update_block 等）', !toolNames.includes('render_content') && !toolNames.includes('update_block') && !toolNames.includes('control_view'));

console.log('== 2. 工作区与 write_file 动态创建应用（Agent 真实工作流） ==');
const la0 = await tool('list_folders');
check('list_folders 返回工作区路径', la0.data && la0.data.ok === true && typeof la0.data.root === 'string', la0);
const WS = la0.data.root;
const appDir = join(WS, 'hello-app');
const indexV1 = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Hello App v1</title></head>
<body><h1>Hello App v1</h1><p id="count"></p>
<script>
var n = parseInt(localStorage.getItem('visits') || '0', 10) + 1;
localStorage.setItem('visits', String(n));
document.getElementById('count').textContent = 'Loaded ' + n + ' times';
document.title = 'Hello App v1 · 第' + n + '次加载';
</script></body></html>`;
const w1 = await tool('write_file', { path: join(appDir, 'index.html'), content: indexV1 });
check('write_file 创建应用入口（自动建目录）', w1.data && w1.data.ok === true, w1);
await tool('write_file', { path: join(appDir, 'app.json'), content: JSON.stringify({ entry: 'index.html', permissions: ['storage'] }) });
await tool('write_file', { path: join(appDir, 'data', 'note.json'), content: JSON.stringify({ note: '应用私有数据' }) });
const la = await tool('list_folders');
check('list_folders 发现新文件夹', la.data && Array.isArray(la.data.folders) && la.data.folders.some((f) => f.name === 'hello-app'), la.data);

console.log('== 3. open_folder 打开应用 ==');
const oa = await tool('open_folder', { path: appDir });
check('open_folder 打开成功', oa.data && oa.data.ok === true && oa.data.status === 'rendered', oa);
check('权限快照包含 storage', oa.data && Array.isArray(oa.data.permissions) && oa.data.permissions.includes('storage'), oa);
const appId = oa.data && oa.data.contentId;
await sleep(1200);

console.log('== 4. get_view_state：运行时交互状态（标题/localStorage） ==');
const st1 = await tool('get_view_state');
const appTab = st1.data.tabs.find((t) => t.contentId === appId);
check('应用标签页存在', !!appTab, st1.data.tabs);
const app1 = appTab && appTab.state && appTab.state.folder;
check('运行时上报标题（含加载次数，localStorage 跨运行持久）', app1 && /Hello App v1 · 第\d+次加载/.test(app1.title || ''), app1);
check('运行时上报 localStorage（含 visits）', app1 && app1.storageKeys && app1.storageKeys.includes('visits'), app1);
check('运行时上报选区字段', app1 && typeof app1.selection === 'string', app1);
const visits1 = app1 ? (parseInt((app1.title.match(/第(\d+)次/) || [])[1], 10) || 0) : 0;

console.log('== 5. 文件监听热重载（write_file → 自动更新 + 状态保留） ==');
const indexV2 = indexV1.replace(/Hello App v1/g, 'Hello App v2');
const w2 = await tool('write_file', { path: join(appDir, 'index.html'), content: indexV2 });
check('write_file 更新应用文件', w2.data && w2.data.ok === true, w2);
await sleep(1600); // 防抖 350ms + 重载
const st2 = await tool('get_view_state');
const app2 = (st2.data.tabs.find((t) => t.contentId === appId) || {}).state && st2.data.tabs.find((t) => t.contentId === appId).state.folder;
check('热重载后标题变为 v2', app2 && /Hello App v2 · 第\d+次加载/.test(app2.title || ''), app2);
const visits2 = app2 ? (parseInt((app2.title.match(/第(\d+)次/) || [])[1], 10) || 0) : 0;
check('localStorage 跨重载保留（次数严格增加）', visits2 > visits1, { visits1, visits2, title: app2 && app2.title });

console.log('== 6. reload_app / navigate_app ==');
const rl = await tool('reload_folder', { content_id: appId });
check('reload_app', rl.data && rl.data.ok === true, rl);
await sleep(1000);
const w3 = await tool('write_file', { path: join(appDir, 'about.html'), content: '<!DOCTYPE html><html><head><meta charset="utf-8"><title>About</title></head><body><h1>About Page</h1></body></html>' });
check('写入第二页面', w3.data && w3.data.ok === true, w3);
const nv = await tool('navigate_folder', { target: { page: 'about.html', content_id: appId } });
check('navigate_app 应用内跳转', nv.data && nv.data.ok === true, nv);
await sleep(800);
const st3 = await tool('get_view_state');
const app3 = (st3.data.tabs.find((t) => t.contentId === appId) || {}).state && st3.data.tabs.find((t) => t.contentId === appId).state.folder;
check('应用内跳转后 URL 更新', app3 && /about\.html$/.test(app3.url || ''), app3);
const nv2 = await tool('navigate_folder', { target: 'hello-app' });
check('navigate_app 按文件夹名切回', nv2.data && nv2.data.ok === true, nv2);

console.log('== 7. read_file / 权限边界 ==');
const rf = await tool('read_file', { path: join(appDir, 'data', 'note.json') });
check('read_file 应用数据', rf.data && rf.data.ok === true && /应用私有数据/.test(rf.data.content), rf);
const wfOut = await tool('write_file', { path: 'C:/Windows/ur-evil.txt', content: 'no' });
check('write_file 工作区外拒绝', wf4isError(wfOut) && wfOut.data && wfOut.data.error && wfOut.data.error.code === 'NOT_ALLOWED', wfOut);
function wf4isError(x) { return x.isError === true; }
const rfOut = await tool('read_file', { path: 'C:/Windows/win.ini' });
check('read_file 工作区外拒绝', rfOut.isError === true && rfOut.data && rfOut.data.error && rfOut.data.error.code === 'NOT_ALLOWED', rfOut);
const trav = await tool('write_file', { path: join(appDir, '..', '..', '..', 'escaped.txt'), content: 'x' });
check('路径逃逸被拦截（归一化越界）', trav.isError === true, trav);
const permUp = await tool('write_file', { path: join(appDir, 'app.json'), content: JSON.stringify({ entry: 'index.html', permissions: ['storage', 'network'] }) });
check('write_file 修改 app.json 被接受（文件本身可写）', permUp.data && permUp.data.ok === true, permUp);
await tool('reload_folder', { content_id: appId });
await sleep(800);
const st4 = await tool('get_view_state');
const app4 = (st4.data.tabs.find((t) => t.contentId === appId) || {}).state && st4.data.tabs.find((t) => t.contentId === appId).state.folder;
check('权限快照不随文件修改提权（仍无 network）', app4 && !app4.permissions.includes('network'), app4);

console.log('== 8. open_folder 兼容：本地文件 / 错误处理 / 旧工具已移除 ==');
const of = await tool('open_folder', { path: F('sample.md') });
check('open_folder 直接打开本地文件（内置渲染器）', of.data && of.data.ok === true && (of.data.status === 'rendered' || of.data.status === 'already-open'), of);
const nf = await tool('open_folder', { path: F('not-exist-dir') });
check('不存在的应用明确报错', nf.isError === true && nf.data && nf.data.error && nf.data.error.code === 'FOLDER_NOT_FOUND', nf);
const old = await tool('render_content', { content: '# x' });
check('旧工具 render_content 已移除（UNKNOWN_TOOL）', old.isError === true && old.data && old.data.error && old.data.error.code === 'UNKNOWN_TOOL', old);

console.log('== 8.5 第二阶段格式：电子书 / Office / 幻灯片 ==');
const odp = await tool('open_folder', { path: F('sample.odp') });
check('odp 明确提示规划中且不假装成功', odp.isError === true && odp.data && odp.data.ok === false && odp.data.error && odp.data.error.code === 'FORMAT_PLANNED', odp);
const epub = await tool('open_folder', { path: F('sample.epub') });
check('epub 打开成功（epub 渲染器）', epub.data && epub.data.ok === true && epub.data.renderer === 'epub', epub);
await sleep(1200);
const epubSt = (await tool('get_view_state')).data.tabs.find((t) => t.contentId === epub.data.contentId);
check('epub 章节=2', epubSt && epubSt.state.chapters === 2, epubSt && epubSt.state);

const dx = await tool('open_folder', { path: F('sample.docx') });
check('docx 打开成功（mammoth）', dx.data && dx.data.ok === true && dx.data.renderer === 'docx', dx);
const xl = await tool('open_folder', { path: F('sample.xlsx') });
check('xlsx 打开成功（SheetJS）', xl.data && xl.data.ok === true && xl.data.renderer === 'xlsx', xl);
const xlSt = (await tool('get_view_state')).data.tabs.find((t) => t.contentId === xl.data.contentId);
check('xlsx 工作表=2', xlSt && Array.isArray(xlSt.state.sheets) && xlSt.state.sheets.length === 2, xlSt && xlSt.state);
const px = await tool('open_folder', { path: F('sample.pptx') });
check('pptx 打开成功（基础预览）', px.data && px.data.ok === true && px.data.renderer === 'pptx', px);
const pxSt = (await tool('get_view_state')).data.tabs.find((t) => t.contentId === px.data.contentId);
check('pptx 幻灯片=2', pxSt && pxSt.state.slides === 2, pxSt && pxSt.state);
const sl = await tool('open_folder', { path: F('sample.slides.md') });
check('slides.md 打开成功（reveal.js）', sl.data && sl.data.ok === true && sl.data.renderer === 'slides', sl);
await sleep(1000);
const slSt = (await tool('get_view_state')).data.tabs.find((t) => t.contentId === sl.data.contentId);
check('slides 页数=3', slSt && slSt.state.slides === 3, slSt && slSt.state);
const ods = await tool('open_folder', { path: F('sample.ods') });
check('ods 打开成功（SheetJS 路由 xlsx）', ods.data && ods.data.ok === true && ods.data.renderer === 'xlsx', ods);
await sleep(800);
const odsSt = (await tool('get_view_state')).data.tabs.find((t) => t.contentId === ods.data.contentId);
check('ods 工作表=1', odsSt && Array.isArray(odsSt.state.sheets) && odsSt.state.sheets.length === 1, odsSt && odsSt.state);
const odt = await tool('open_folder', { path: F('sample.odt') });
check('odt 基础预览打开成功', odt.data && odt.data.ok === true && odt.data.renderer === 'odt', odt);
const dx2 = await tool('open_folder', { path: F('sample.docx') });
check('docx 重复打开复用（already-open）', dx2.data.status === 'already-open', dx2);

console.log('== 9. 客户端重启后 MCP 自动恢复连接 ==');
try { execSync('taskkill /IM electron.exe /F', { stdio: 'pipe' }); } catch (e) { console.log('  (kill 输出:', String(e.stdout || e.message).trim().slice(0, 80), ')'); }
await sleep(2500);
const st5 = await tool('get_view_state', {}, 120000);
check('客户端被杀后 MCP 自动重新拉起并恢复服务', st5.data && st5.data.ok !== false && Array.isArray(st5.data.tabs), st5.data);

child.stdin.end();
await sleep(300);
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failures.length) { console.log('失败用例:', failures.join(' | ')); process.exit(1); }
process.exit(0);
