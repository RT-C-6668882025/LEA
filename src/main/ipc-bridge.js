'use strict';
// 本地 IPC 桥：GUI 主进程监听 Windows 命名管道，接收 MCP Server 转发的指令。
// 帧格式：换行分隔 JSON。请求 {id, op, params} → 响应 {id, ok, data|error}。

const net = require('net');
const { PIPE_NAME } = require('./mcp-stdio');

function startBridge(handlers, log) {
  const server = net.createServer((socket) => {
    let buf = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (!msg || typeof msg.id === 'undefined' || !msg.op) continue;
        const fn = handlers[msg.op];
        if (!fn) {
          socket.write(JSON.stringify({ id: msg.id, ok: false, error: { code: 'UNKNOWN_OP', message: `未知操作: ${msg.op}` } }) + '\n');
          continue;
        }
        Promise.resolve()
          .then(() => fn(msg.params || {}))
          .then((data) => {
            if (!socket.destroyed) socket.write(JSON.stringify({ id: msg.id, ok: true, data }) + '\n');
          })
          .catch((err) => {
            if (!socket.destroyed) {
              socket.write(JSON.stringify({ id: msg.id, ok: false, error: { code: err.code || 'INTERNAL', message: String(err.message || err) } }) + '\n');
            }
          });
      }
    });
    socket.on('error', () => {});
  });
  server.on('error', (err) => log(`IPC 管道服务异常: ${err.message}`));
  server.listen(PIPE_NAME, () => log(`本地 IPC 管道就绪: ${PIPE_NAME}`));
  return server;
}

module.exports = { startBridge };
