// 构建独立的 mcp-server.exe（Node SEA 单可执行应用）
// 产物：build/mcp-server.exe —— 纯控制台子系统，stdio 对所有 MCP 客户端可用，用户无需安装 Node.js
import { execSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(root, 'build');
mkdirSync(buildDir, { recursive: true });

writeFileSync(join(buildDir, 'sea-config.json'), JSON.stringify({
  main: 'src/main/mcp-stdio.js',
  output: 'build/sea-prep.blob',
  disableExperimentalSEAWarning: true,
}, null, 2));

console.log('[1/3] 生成 SEA blob…');
execSync('node --experimental-sea-config build/sea-config.json', { cwd: root, stdio: 'inherit' });

const nodeExe = process.execPath;
const target = join(buildDir, 'mcp-server.exe');
copyFileSync(nodeExe, target);
console.log(`[2/3] 复制 node.exe (${Math.round(statSync(nodeExe).size / 1048576)}MB) → mcp-server.exe`);

console.log('[3/3] 注入 blob (postject)…');
const r = spawnSync('npx', ['-y', 'postject', target, 'NODE_SEA_BLOB', join(buildDir, 'sea-prep.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'], { cwd: root, stdio: 'inherit', shell: true });
if (r.status !== 0) {
  console.error('postject 失败，退出码', r.status);
  process.exit(1);
}
if (!existsSync(target)) { console.error('产物缺失'); process.exit(1); }
console.log(`完成: ${target} (${Math.round(statSync(target).size / 1048576)}MB)`);
