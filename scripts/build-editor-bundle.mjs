// 打包 Tiptap 编辑器依赖为单文件 IIFE（无打包器架构下的唯一构建步骤）
import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
execSync(
  'npx esbuild src/renderer/editor-entry.js --bundle --format=iife --minify --outfile=src/renderer/editor.bundle.js --log-level=warning',
  { cwd: root, stdio: 'inherit' },
);
const out = join(root, 'src', 'renderer', 'editor.bundle.js');
if (!existsSync(out)) { console.error('打包产物缺失'); process.exit(1); }
console.log(`editor.bundle.js ${(statSync(out).size / 1024).toFixed(0)}KB 已生成`);
