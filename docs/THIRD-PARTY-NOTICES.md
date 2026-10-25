# 第三方组件许可声明（THIRD-PARTY NOTICES）

本应用集成以下开源组件，各自的许可证与项目地址如下。本应用自身代码以 MIT 许可证发布。

## 运行时组件

### Electron
- 版本：33.4.x
- 用途：桌面应用框架（Chromium + Node.js 运行时）
- 许可证：MIT
- 地址：https://github.com/electron/electron
- 说明：Electron 随附 Chromium 与 FFmpeg（含专有编解码器 H.264/AAC 支持），相关组件授权见
  https://www.electronjs.org/docs/latest/legal ，Chromium 许可证见
  https://chromium.googlesource.com/chromium/src/+/main/LICENSE

### PDF.js (pdfjs-dist)
- 版本：3.11.174
- 用途：PDF 渲染引擎
- 许可证：Apache-2.0
- 地址：https://github.com/mozilla/pdf.js

### marked
- 版本：14.x
- 用途：Markdown → HTML 解析
- 许可证：MIT
- 地址：https://github.com/markedjs/marked

### DOMPurify
- 版本：3.x
- 用途：HTML 消毒（XSS 防护）
- 许可证：Apache-2.0 / MPL-2.0 双许可（按 Apache-2.0 使用）
- 地址：https://github.com/cure53/DOMPurify

### Tiptap（@tiptap/core、@tiptap/starter-kit、@tiptap/pm）
- 版本：2.27.x
- 用途：可编辑页面（.urpage）的内容块编辑引擎（ProseMirror 封装）
- 许可证：MIT
- 地址：https://github.com/ueberdosis/tiptap
- 说明：底层 ProseMirror（MIT）随其分发。

### ArtPlayer
- 版本：5.4.x
- 用途：页面内视频播放器（阅读/编辑模式）
- 许可证：MIT
- 地址：https://github.com/zhw2590582/ArtPlayer

### wavesurfer.js
- 版本：6.6.4
- 用途：页面内音频播放与波形显示
- 许可证：BSD-3-Clause
- 地址：https://github.com/katspaugh/wavesurfer.js

### Viewer.js
- 版本：1.15.x
- 用途：页面图片查看（缩放/旋转/翻转）
- 许可证：MIT
- 地址：https://github.com/fengyuanchen/viewerjs

### esbuild（仅构建期，不随应用分发）
- 用途：将 Tiptap 依赖打包为单文件 IIFE（editor.bundle.js）
- 许可证：MIT
- 地址：https://github.com/evanw/esbuild

## 第二轮集成（学习场景增强）

### Split.js
- 版本：1.6.x · 许可证：MIT · 用途：双栏对照分栏拖拽
- 地址：https://github.com/nathancahill/split

### SortableJS
- 版本：1.15.x · 许可证：MIT · 用途：互动块内拖拽排序练习（沙箱内注入）
- 地址：https://github.com/SortableJS/Sortable

### KaTeX
- 版本：0.16.x · 许可证：MIT · 用途：互动块内数学公式渲染（含字体内联）
- 地址：https://github.com/KaTeX/KaTeX

### JSXGraph
- 版本：1.10.x · 许可证：(MIT OR LGPL-3.0)（按 MIT 使用）· 用途：互动块内交互式几何
- 地址：https://github.com/jsxgraph/jsxgraph

### Three.js
- 版本：0.147.0（UMD 构建锁定）· 许可证：MIT · 用途：互动块内 3D 场景（沙箱内注入 window.THREE）
- 地址：https://github.com/mrdoob/three.js

### JSZip
- 版本：3.10.x · 许可证：(MIT OR GPL-3.0)（按 MIT 使用）· 用途：ZIP 离线内容包导出
- 地址：https://github.com/Stuk/jszip

### 第三轮集成（电子书 / Office / 幻灯片）

### mammoth
- 版本：1.x · 许可证：BSD-2-Clause · 用途：DOCX → HTML 转换（图片内联 data URI）
- 地址：https://github.com/mwilliamson/mammoth.js

### SheetJS (xlsx)
- 版本：0.18.x · 许可证：Apache-2.0 · 用途：XLSX/XLS 表格解析与渲染
- 地址：https://github.com/SheetJS/sheetjs

### reveal.js
- 版本：4.5.0（UMD 构建锁定）· 许可证：MIT · 用途：.slides.md 幻灯片渲染（内嵌模式）
- 地址：https://github.com/hakimel/reveal.js

### 未集成的候选组件与替代方案（第二轮选型结论）
- Swiper / Embla：页面沉浸流改用原生 CSS scroll-snap 实现（Swiper 会克隆 DOM，与 ProseMirror 冲突）
- TanStack Virtual：暂无长列表场景，未集成
- Dexie.js：阅读状态已有 view-state.json 持久化，IndexedDB 暂无必要
- html2pdf.js / FileSaver.js：由 Chromium 原生 printToPDF 与主进程保存对话框替代
- Plyr：ArtPlayer 已覆盖播放器 UI；画中画使用原生 Picture-in-Picture API
- React Three Fiber / Drei：需要 React 技术栈，与本客户端零框架架构不符；3D 场景由 Agent 生成 Three.js 代码 + 沙箱注入实现
- model-viewer / Web3DViewer / Rapier：待第三阶段评估（model-viewer 需要 ES module 构建链）

## 构建期工具（不随应用分发）

### electron-builder
- 用途：Windows NSIS 安装包构建
- 许可证：MIT
- 地址：https://github.com/electron-userland/electron-builder
- 说明：安装包内含 NSIS（zlib/libpng 许可）与 NSIS Resources 组件。

## 许可证合规说明

- 本应用不修改上述组件源码，均按原样集成。
- PDF.js 的 NOTICE（Apache-2.0 要求）随包内 node_modules/pdfjs-dist 一并分发。
- 若未来集成 foliate-js（MIT）、reveal.js（MIT）、ArtPlayer（MIT），需在此同步登记；
  明确不集成 AGPL/GPL 或自定义非商用许可证组件（详见 docs/01-选型矩阵.md）。
