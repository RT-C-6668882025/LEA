'use strict';
// LEA MCP Server（stdio，JSON-RPC 2.0，换行分隔帧）
// 三种运行方式（同一份代码）：
//   1. 开发：node src/main/mcp-stdio.js
//   2. 打包后：LEA.exe --mcp-stdio（GUI 主进程检测该参数后进入本模块）
//   3. 打包后（备选）：mcp-server.cmd 以 ELECTRON_RUN_AS_NODE=1 运行本文件
// 与 GUI 客户端通过 Windows 命名管道交换指令；客户端未启动时自动拉起。

const net = require('net');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

const PIPE_NAME = '\\\\.\\pipe\\lea-ipc';
const SERVER_INFO = { name: 'lea', version: '0.2.0' };

function mlog(...args) {
  try { process.stderr.write(`[ur-mcp] ${args.join(' ')}\n`); } catch {}
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- 管道客户端 ----------------
let sock = null;
let seq = 0;
const pendingCalls = new Map();

function connect() {
  return new Promise((resolve, reject) => {
    const s = net.connect(PIPE_NAME);
    let buf = '';
    s.setEncoding('utf8');
    const to = setTimeout(() => { s.destroy(); reject(new Error('连接超时')); }, 3000);
    s.on('connect', () => { clearTimeout(to); sock = s; resolve(s); });
    s.on('error', (e) => { clearTimeout(to); if (sock === s) sock = null; reject(e); });
    s.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const p = pendingCalls.get(msg.id);
        if (p) { pendingCalls.delete(msg.id); clearTimeout(p.timer); p.resolve(msg); }
      }
    });
    s.on('close', () => {
      if (sock === s) {
        sock = null;
        for (const [, p] of pendingCalls) { clearTimeout(p.timer); p.reject(new Error('与客户端的连接已关闭')); }
        pendingCalls.clear();
      }
    });
  });
}

function findAppLaunch() {
  // 1) 就近查找 LEA.exe：覆盖 SEA 版 mcp-server.exe 位于安装根 / resources / resources/app 的布局
  const exeDir = path.dirname(process.execPath);
  const nearby = [
    path.join(exeDir, 'LEA.exe'),
    path.join(exeDir, '..', 'LEA.exe'),
    path.join(exeDir, '..', '..', 'LEA.exe'),
  ];
  for (const exe of nearby) {
    if (fs.existsSync(exe)) return { exe, args: [], cwd: path.dirname(exe) };
  }
  // 2) 开发环境：项目根下 node_modules 的 electron
  const appRoot = path.resolve(__dirname, '..', '..'); // 开发: 项目根
  const devElectron = path.join(appRoot, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (fs.existsSync(devElectron)) return { exe: devElectron, args: [appRoot], cwd: appRoot };
  return null;
}

async function launchApp() {
  const launch = findAppLaunch();
  if (!launch) {
    throw Object.assign(new Error('未找到 LEA 客户端，请先安装或手动启动'), { code: 'APP_NOT_FOUND' });
  }
  mlog(`客户端未运行，自动启动: ${launch.exe}`);
  const argStr = (launch.args || []).map((a) => `"${a}"`).join(' ');
  // 首选 WMI 创建：脱离调用方的作业对象与父进程生命周期（MCP 客户端退出/重启不影响 GUI）
  try {
    const ps = `(Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '"${launch.exe}" ${argStr}' }) | Out-Null`;
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 20000, windowsHide: true });
    if (r.status === 0) {
      mlog('WMI 启动成功');
      return;
    }
    mlog(`WMI 启动失败(status=${r.status})，回退 spawn`);
  } catch (e) {
    mlog(`WMI 启动异常: ${e.message}，回退 spawn`);
  }
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(launch.exe, launch.args, { cwd: launch.cwd, detached: true, stdio: 'ignore', env });
    child.on('error', (e) => mlog(`自动启动失败: ${e.message}`));
    child.unref();
  } catch (e) {
    mlog(`自动启动异常: ${e.message}`);
  }
}

async function ensureConnected() {
  if (sock) return sock;
  try { return await connect(); } catch {}
  await launchApp();
  const deadline = Date.now() + 25000;
  let lastErr = null;
  while (Date.now() < deadline) {
    await sleep(400);
    try { return await connect(); } catch (e) { lastErr = e; }
  }
  throw Object.assign(new Error(`无法连接 LEA 客户端（已尝试自动启动）: ${lastErr && lastErr.message}`), { code: 'APP_NOT_RUNNING' });
}

function bridgeCall(op, params, timeoutMs = 20000) {
  return ensureConnected()
    .then((s) => new Promise((resolve, reject) => {
      const id = 'c' + (++seq);
      const timer = setTimeout(() => {
        pendingCalls.delete(id);
        reject(Object.assign(new Error(`客户端响应超时（${op}）`), { code: 'BRIDGE_TIMEOUT' }));
      }, timeoutMs);
      pendingCalls.set(id, { resolve, timer });
      s.write(JSON.stringify({ id, op, params: params || {} }) + '\n');
    }))
    .then((m) => {
      if (m.ok) return m.data;
      const err = new Error((m.error && m.error.message) || '客户端返回错误');
      err.code = (m.error && m.error.code) || 'CLIENT_ERROR';
      throw err;
    });
}

// ---------------- MCP 工具定义 ----------------
// ---------------- MCP 工具定义（文件夹即应用架构：启动/导航/状态/交互反馈 + 受限文件工具） ----------------
const TOOLS = [
  {
    name: 'open_folder',
    description: '打开一个文件夹（含 index.html 即可运行：沙箱执行 + 文件监听热更新），或直接打开一个本地文件（PDF/MD/图片/音视频等用内置渲染器）。返回内容 ID、文件夹信息与渲染状态。',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: '应用文件夹绝对路径（含 index.html 或 app.json），或任意本地文件路径' },
      },
    },
  },
  {
    name: 'list_folders',
    description: '列出工作区（文档\\LEA）下的文件夹（含 index.html 的即为可运行内容），以及当前已打开的文件夹。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'reload_folder',
    description: '重载当前文件夹（修改文件后通常无需调用——文件监听会自动热重载并保留状态；此工具用于强制刷新）。',
    inputSchema: {
      type: 'object',
      properties: { content_id: { type: 'string', description: '应用内容 ID；缺省为当前活动标签页' } },
    },
  },
  {
    name: 'get_view_state',
    description: '读取客户端当前状态：所有标签页、活动内容、双栏布局；对文件夹返回其页面的标题/URL/滚动/选区/媒体进度/localStorage 键等交互状态（用于"选中解释/界面反馈"工作流）。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'navigate_folder',
    description: '切换文件夹或页面：字符串 target 为文件夹名（按文件夹名定位，文件夹名就是身份）或本地文件路径；对象 target {page: "sub.html"} 在当前文件夹内跳转页面。',
    inputSchema: {
      type: 'object',
      properties: {
        target: { description: "应用名称/ID/文件路径字符串，或 { page: '相对页面', content_id: '应用内容ID' }" },
      },
    },
  },
  {
    name: 'write_file',
    description: '在允许范围内写文件（自动创建父目录）：工作区（文档\\LEA）或已打开的文件夹内。修改文件会触发客户端自动热重载。app.json 的 permissions 修改不会热生效（权限在打开时快照，防止文件编辑绕过权限边界）。',
    inputSchema: {
      type: 'object',
      required: ['path', 'content'],
      properties: {
        path: { type: 'string', description: '绝对路径（必须在允许范围内）' },
        content: { type: 'string', description: 'UTF-8 文本内容（≤10MB）' },
      },
    },
  },
  {
    name: 'search_content',
    description: '全局搜索：跨工作区所有文件夹检索文本内容（HTML/MD/TXT/JSON 等），返回文件、命中行与片段。用于"找关于某主题的所有内容"、定位知识点。',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: '搜索关键词（不区分大小写）' },
        max_results: { type: 'integer', description: '最多返回文件数（默认 30）' },
      },
    },
  },
  {
    name: 'list_versions',
    description: '查看某文件的历史版本列表（每次 write_file 修改前自动快照，保留最近 20 份）。Agent 改坏内容时先查这个。',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string', description: '文件绝对路径' } },
    },
  },
  {
    name: 'restore_version',
    description: '把文件恢复到某个历史版本（恢复前会再快照当前版本，可撤销恢复；恢复后客户端自动热更新）。',
    inputSchema: {
      type: 'object',
      required: ['path', 'version'],
      properties: {
        path: { type: 'string', description: '文件绝对路径' },
        version: { type: 'string', description: '版本文件名（list_versions 返回的 version 字段）' },
      },
    },
  },
  {
    name: 'read_file',
    description: '读取允许范围内的文本文件（工作区或已打开应用文件夹内，≤8MB，自动识别编码）。',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: { path: { type: 'string', description: '绝对路径（必须在允许范围内）' } },
    },
  },
];

// ---------------- 工具调用 ----------------
async function callTool(name, args) {
  args = args || {};
  switch (name) {
    case 'open_folder':
      if (!args.path) throw Object.assign(new Error('open_folder 需要 path 参数'), { code: 'MISSING_PARAM' });
      return await bridgeCall('openFolder', { path: args.path }, 75000);
    case 'list_folders':
      return await bridgeCall('listFolders', {}, 15000);
    case 'reload_folder':
      return await bridgeCall('reloadFolder', { content_id: args.content_id }, 15000);
    case 'get_view_state':
      return await bridgeCall('state', {}, 10000);
    case 'navigate_folder':
      if (!args.target) throw Object.assign(new Error('navigate_folder 需要 target 参数'), { code: 'MISSING_PARAM' });
      return await bridgeCall('navigateFolder', { target: args.target }, 30000);
    case 'write_file':
      if (!args.path || typeof args.content !== 'string') throw Object.assign(new Error('write_file 需要 path 与 content 参数'), { code: 'MISSING_PARAM' });
      return await bridgeCall('writeFile', { path: args.path, content: args.content }, 30000);
    case 'search_content':
      if (!args.query) throw Object.assign(new Error('search_content 需要 query 参数'), { code: 'MISSING_PARAM' });
      return await bridgeCall('search', { query: args.query, max_results: args.max_results }, 30000);
    case 'list_versions':
      if (!args.path) throw Object.assign(new Error('list_versions 需要 path 参数'), { code: 'MISSING_PARAM' });
      return await bridgeCall('listVersions', { path: args.path }, 15000);
    case 'restore_version':
      if (!args.path || !args.version) throw Object.assign(new Error('restore_version 需要 path 与 version 参数'), { code: 'MISSING_PARAM' });
      return await bridgeCall('restoreVersion', { path: args.path, version: args.version }, 30000);
    case 'read_file':
      if (!args.path) throw Object.assign(new Error('read_file 需要 path 参数'), { code: 'MISSING_PARAM' });
      return await bridgeCall('readFile', { path: args.path }, 15000);
    default:
      throw Object.assign(new Error(`未知工具: ${name}`), { code: 'UNKNOWN_TOOL' });
  }
}

function toolResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError: !!(data && data.ok === false),
  };
}

function toolError(err) {
  const payload = { ok: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } };
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
}

function jsonResp(msg) {
  try { process.stdout.write(JSON.stringify(msg) + '\n'); } catch (e) { mlog(`stdout 写入失败: ${e.message}`); }
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  const respondErr = (code, message) => jsonResp({ jsonrpc: '2.0', id, error: { code, message } });
  try {
    switch (method) {
      case 'initialize':
        jsonResp({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: (params && params.protocolVersion) || '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        });
        break;
      case 'ping':
        jsonResp({ jsonrpc: '2.0', id, result: {} });
        break;
      case 'tools/list':
        jsonResp({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
        break;
      case 'tools/call': {
        const name = params && params.name;
        try {
          const result = await callTool(name, params && params.arguments);
          jsonResp({ jsonrpc: '2.0', id, result: toolResult(result) });
        } catch (e) {
          jsonResp({ jsonrpc: '2.0', id, result: toolError(e) });
        }
        break;
      }
      default:
        respondErr(-32601, `方法不存在: ${method}`);
    }
  } catch (e) {
    respondErr(-32603, e.message || '内部错误');
  }
}

function onLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (!msg || typeof msg !== 'object') return;
  if (typeof msg.method === 'string' && msg.method.startsWith('notifications/')) return; // initialized/cancelled 等通知
  if (typeof msg.id === 'undefined') return;
  handleRequest(msg).catch((e) => mlog(`请求处理异常: ${e.message}`));
}

function run() {
  mlog('MCP Server 启动，等待客户端连接…');
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  });
  process.stdin.on('end', () => { mlog('stdin 关闭，退出'); process.exit(0); });
  process.stdin.on('error', (e) => { mlog(`stdin 错误: ${e.message}`); process.exit(1); });
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

module.exports = { run, PIPE_NAME };

if (require.main === module) run();
