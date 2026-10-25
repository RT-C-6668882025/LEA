# LEA — Learn Everything Anywhere · 随处学习一切

**任何内容，任何文件夹，任何 Agent 生成的应用，都可以打开。**

一个基于 Windows 的轻量级原生桌面客户端：**文件夹即内容 —— Agent 写文件，客户端沙箱运行**。
本地渲染文档与媒体，通过 MCP Server 供外部 AI Agent 生成交互式学习内容并操控展示。

核心原则：**客户端只负责运行与展示，内容全部是文件**。
AI 推理与内容生成交给外部 Agent（如豆包桌面版）：Agent 创建文件夹、修改文件，客户端负责
隔离执行、权限控制、热更新与状态保留。客户端本身没有任何 AI、没有聊天窗口、不做内容推荐。

## 下载与安装

前往 [GitHub Releases](https://github.com/RT-C-6668882025/LEA/releases/latest)，下载 `LEA-Setup-0.2.1.exe` 并安装。默认安装目录为 `%LOCALAPPDATA%\Programs\LEA`，安装包已包含独立的 `mcp-server.exe`，使用时无需另装 Node.js。

### v0.2.1：豆包桌面版接入修复

- 接入向导默认复制豆包需要的启动命令，路径包含空格时自动加双引号。
- 明确提示参数与环境变量留空，避免将 JSON 当成命令导致 `COMMAND_NOT_FOUND`。
- 其他客户端使用的标准 MCP JSON 配置保留在独立折叠区。

```
外部 AI Agent                    LEA 客户端
────┬───────────────    ┌─────────────────────────────────────────┐
    │ write_file        │  文件监听（fs.watch 递归）               │
    │  ↓ 写文件          │    ↓ 变化触发自动热重载                  │
    │ open_folder       │  ur-app://<id>/ 每文件夹独立源沙箱       │
    │  ↓ 打开文件夹      │  权限化 CSP（storage/network 按快照）    │
    │ get_view_state ←──┤  运行时脚本：滚动/媒体/输入状态保留       │
    │ （状态/选区回传）   │  无 Node、无系统命令、默认无网络         │
────┴───────────────    └─────────────────────────────────────────┘
        MCP(stdio, 10 工具) ── 命名管道 ── GUI 客户端；未运行自动拉起
```

文件夹结构（只有两个约定——**文件夹名就是内容的名字**，没有"应用"概念）：

```text
我的课件/
├── index.html          # 入口（必需）
├── app.json            # 可选：{"entry":"index.html","permissions":["storage"]}
├── assets/             # 可选：图片/音视频/脚本，页面内相对路径引用
└── data/               # 可选：内容数据
```

## 支持的格式（19 种，全部实测）

| 类别 | 格式 | 渲染引擎 | 状态 |
|---|---|---|---|
| 文档 | Markdown（.md/.markdown） | marked + DOMPurify | ✅ |
| 文档 | PDF | PDF.js 3.11 | ✅ |
| 图片 | PNG / JPG / GIF / WebP / SVG / BMP / AVIF | Chromium 内置（缩放/平移/适应窗口） | ✅ |
| 音视频 | MP4 / WebM / MP3 / WAV / OGG / M4A / FLAC | Chromium 内置（H.264/AAC/VP9/Opus） | ✅ |
| 网页 | HTML（自动识别 GBK/GB2312/Big5/UTF-16 编码） | 沙箱 iframe（禁网络/禁文件） | ✅ |
| **可编辑页面** | **.urpage** | Tiptap 内容块 + 媒体/互动组件 | ✅ |
| 文本 | TXT / CSV / 日志 / 常见代码文件 / JSON | 内置 | ✅ |
| **电子书** | **EPUB** | JSZip（OPF/NCX 解析 + 章节渲染 + 目录面板 + 进度记忆） | ✅ |
| **Office** | **DOCX** | mammoth（大纲面板） | ✅ |
| **Office** | **XLSX / XLS / ODS / FODS** | SheetJS（表格 + 工作表切换） | ✅ |
| **Office** | **PPTX** | 基础预览（文本与图片提取） | ✅ 基础 |
| **幻灯片** | **.slides.md** | `---` 分页 Markdown → reveal.js 内嵌放映 | ✅ |
| **文档** | **ODT** | ODF 文本层预览 | ✅ 基础 |
| 文件夹 | 含 index.html 的文件夹 | ur-app:// 沙箱（热更新） | ✅ |

> MKV/MOV 取决于容器内编码（H.264/AAC 可播，HEVC 等不支持时**明确报错**，不假装成功）。
> 不支持的格式（如 ODP）一律明确提示，绝不假装渲染成功。

## 交互式学习内容（14 种区块，一页复合 + 各自独立）

Agent 生成的文件夹页面里，**所有交互组件开箱即用**——库由客户端内置（`ur-lib://` 协议直引，无需下载/复制/CDN，完全离线）：

| 区块 | 内置库 | 引用（页面里一行） | 实测 |
| PDF | PDF.js（+worker） |  | ✅ |
| Word | mammoth |  | ✅ |
| Excel | SheetJS |  | ✅ |
| PPT | JSZip 文本提取 |  | ✅ |
|---|---|---|---|
| 3D 交互（拖拽旋转/滚轮缩放） | Three.js | `<script src="ur-lib://local/three/three.min.js">` | ✅ |
| 数学公式 | KaTeX（含字体） | `ur-lib://local/katex/katex.min.js` | ✅ |
| 动态几何/函数图像（可拖动点） | JSXGraph | `ur-lib://local/jsxgraph/jsxgraphcore.js` | ✅ |
| 拖拽排序练习 | SortableJS | `ur-lib://local/sortable/sortable.min.js` | ✅ |
| 统计图表（柱/线/饼） | Chart.js | `ur-lib://local/chartjs/chart.umd.js` | ✅ |
| 选择测验/进度条/视频 | 内置 | 模板自带 | ✅ |

- **复合展示**：14 种区块（图文/图片/音频/视频/公式/几何/3D/图表/拖拽/测验/**PDF/Word/Excel/PPT**）可同时放在一个页面——全家福实测 14/14 同页工作（SKILL 提供完整模板，含学习进度条、答题即时反馈、localStorage 进度持久化）
- **独立展示**：每个区块是独立 `<section>`，删掉其余照常工作（已逐一验证）
- 用户只需对 Agent 说"**我想学 XX**"，Agent 按模板自动生成全部内容——零技术术语

**双链（Obsidian 式）**：正文里写 `[[知识点]]` 或 `[[知识点|显示文字]]`，客户端自动转为可点击链接，点击跳转工作区同名内容——用于**前置知识**（学微积分时点 `[[极限]]` 跳去补课，学完从反向双链跳回）。**Markdown 图文区块**：内置 marked（ur-lib 直引），富文本讲解与 3D/公式/测验同页共存。

## 可编辑页面（.urpage）

用户驱动的页面编辑能力（内容可来自用户手写或 Agent 文件提供）：

- Tiptap（ProseMirror）管理可编辑内容块；**图片/视频/音频/互动组件是原子节点**——编辑器只存属性、从不重排内部内容，**HTML/CSS/JS 互动块不会被编辑器破坏**
- 互动组件：独立沙箱 iframe（仅内联脚本/样式 + ur-lib 库；禁网络、禁本地文件）
- 媒体增强：视频 ArtPlayer、音频 wavesurfer.js 波形、图片 Viewer.js；插入本地媒体自动复制进 `assets/` 形成自包含页面
- 保存：Ctrl+S；未落盘页面走"另存为"；文件格式为 JSON（可版本管理）

## 安装与使用

1. 双击 `dist/LEA-Setup-0.2.0.exe` 安装（无需 Python / Node.js / 任何开发环境）。
2. 全部本地功能**离线可用**；无需登录、无需配置模型。

**界面**（米白暖色主题，ui-ux-pro-max 生成配色 "Warm ink + amber on cream"）：
顶部标签栏（多内容切换）+ 右侧边栏（**功能面板**：大纲/目录/外观/工作表/页面导航，随内容类型自动出现；**工作区**文件夹列表，点击即打开）+ 状态栏。

### 功能怎么用（操作速查）

**打开内容**
- 拖文件进窗口 / 点"打开文件"按钮（含开屏大按钮）/ 双击已关联文件（md/pdf/图片/音视频/html/urpage…）
- 侧边栏"工作区"列表点文件夹即打开（⟳ 按钮刷新列表）

**标签页**
- `Ctrl+Tab` 下一个 / `Ctrl+Shift+Tab` 上一个 / `Ctrl+W` 关闭 / 中键点标签关闭

**命令面板（全局搜索一切）**
- 按 **`Ctrl+K`** → 输入关键词 → 列出：已打开的标签、工作区文件夹、**全局内容搜索结果**（跨所有文件夹的命中行）→ ↑↓ 选择 → Enter 打开

**侧边栏功能面板（随内容自动出现）**
- Markdown/页面：**大纲**（标题树点击跳转）、**外观**（主题：米白/暗色/羊皮纸；字号 A+/A−；行距：紧/松）
- PDF：**页面**（页码树跳页）；EPUB：**目录**（章节跳转）、字号；XLSX：**工作表**切换；图片：**视图**（缩放/适应）；音视频：**播放**（进度/音量）；文件夹：**信息**（权限/沙箱状态）

**阅读与播放**
- 快捷键：`F11` 全屏、`+/-` 字号或缩放、`←/→` 翻页或快进、空格 播放/暂停、`0` 复位
- 图片：滚轮缩放、拖动平移、双击适应窗口
- 阅读位置/播放进度/缩放/主题/字号/行距 **按文件自动记忆**

**双链与前置知识（Agent 生成的学习页里）**
- 看到带 ⟡ 标记的链接（如 `⟡ 极限`）→ 点击即跳转到该知识点页面，学完可从对方页面的反向双链跳回
- 带 ¶ 的链接是**块引用**（如 `⟡ question-103 ¶`）→ 跳转后自动**滚动定位到那道题/那个段落并琥珀色高亮**

**让 Agent 做事（连接 MCP 后，对豆包直接说）**
- "我想学 XX" → 自动生成含 3D/公式/测验等的交互课件并打开
- "找一下所有关于 XX 的内容" → `search_content` 全局搜索并打开结果
- "刚才改坏了，撤销" → Agent 查 `list_versions` 并 `restore_version` 回滚，页面自动恢复

## 接入 AI Agent（MCP）

**最简接入（30 秒）**：打开 LEA → 点顶栏 🔌（或空状态页「接入 AI Agent」按钮）→ 点「复制豆包启动命令」（自动填好你电脑的路径）→ 到豆包桌面版「技能·连接器·伙伴」→「新建自定义连接器」→「本地命令 (stdio)」的命令框粘贴，参数和环境变量留空后启用（不要粘贴 JSON）。命令行启动 `LEA.exe --agent-wizard` 可直接弹出向导。

### 豆包桌面版：填写启动命令

命令框只填写本机 `mcp-server.exe` 的路径，例如：

```text
C:\Users\你的用户名\AppData\Local\Programs\LEA\mcp-server.exe
```

参数和环境变量留空。路径含空格时，用双引号包住整条路径；向导会自动处理。

**不要把下面的 JSON 粘进豆包的命令框。** 若旧连接器报启动失败，编辑它并替换原先的 JSON，再保存重试。日志中的 `command="{"`、`COMMAND_NOT_FOUND` 正是将 JSON 当成命令解析的表现。

连接成功后应能发现 10 个工具。对豆包说“用 lea 列出工作区文件夹”验证实际调用。

### Codex：安装本地 MCP

将路径替换为实际安装目录，在 PowerShell 中执行：

```powershell
codex mcp add lea -- "$env:LOCALAPPDATA\Programs\LEA\mcp-server.exe"
codex mcp get lea
```

配置后重新打开会话或重启客户端以加载新增工具。LEA 未运行时，工具调用会自动启动它。

### 其他支持 JSON 配置的客户端

以下配置用于 Claude Desktop / Cline 等支持 MCP JSON 配置的客户端；用户名及安装目录需替换为本机实际值。

```json
{
  "mcpServers": {
    "lea": {
      "command": "C:\\Users\\<用户名>\\AppData\\Local\\Programs\\LEA\\mcp-server.exe",
      "args": []
    }
  }
}
```

### MCP 工具（10 个）

**核心理念：Agent 写文件，客户端沙箱运行。** Agent 修改文件 → 客户端**自动热更新**（保留滚动位置、媒体进度、输入内容与 localStorage）。

| 工具 | 作用 |
|---|---|
| `open_folder {path}` | 打开文件夹（沙箱运行+热更新）或本地文件（内置渲染器） |
| `list_folders {}` | 工作区（`文档\LEA`）文件夹列表 + 已打开内容 |
| `reload_folder {content_id?}` | 强制重载（通常不需要——自动热更新） |
| `get_view_state {}` | 标签页 + 运行时交互状态（标题/滚动/选区/媒体进度/localStorage 键） |
| `navigate_folder {target}` | 按文件夹名切换 / 打开文件 / 文件夹内页面跳转 |
| `write_file {path, content}` | 受限写入（仅工作区与已打开文件夹；自动建目录，≤10MB；**写前自动历史快照**） |
| `read_file {path}` | 受限读取（≤8MB，自动识别编码） |
| `search_content {query}` | **全局搜索**：跨工作区全部文件夹文本检索（命中行+片段） |
| `list_versions {path}` | 查看文件**历史版本**（自动快照保留 20 份） |
| `restore_version {path, version}` | **恢复**到历史版本（恢复可撤销，恢复即热更新） |

工具 Schema、学习页模板与零术语工作流见 [skill/lea/SKILL.md](skill/lea/SKILL.md)；
配置步骤与故障排查见 [docs/02-MCP配置示例.md](docs/02-MCP配置示例.md)。

## 知识管理五件套

| 能力 | 说明 |
|---|---|
| **双链 + 块引用** | `[[知识点]]`、`[[路径/嵌套#锚点|显示]]`：点击跳转工作区同名内容并**滚动定位到具体段落/题目**（琥珀高亮）；用于前置知识与错题引用 |
| **全局搜索** | `search_content` MCP 工具：跨工作区全部分文件夹文本检索（命中行+片段）；客户端内 Ctrl+K 命令面板同源 |
| **命令面板** | **Ctrl+K**：搜已打开标签/工作区文件夹/全局内容，回车即开 |
| **历史快照** | 每次 write_file **自动版本**（保留 20 份）；`list_versions` + `restore_version` 一键回退（恢复可撤销，恢复即热更新） |
| **统一内容标识** | 文件夹名（+嵌套路径）= 内容 ID；元素 id/data-block = 块 ID；双链/搜索/命令面板共用 |

## 安全设计

**文件夹内容是不可信代码**，安全层不因极简而省略：

- 每文件夹独立源（`ur-app://<id>/`）沙箱 iframe：无 Node、无系统命令面
- 权限快照：`app.json` 的 `permissions` 在打开时固化——`storage` 授予隔离的 localStorage；`network` 才允许 https；**默认无网络**；**write_file 改 app.json 不能提权**
- 协议层白名单：路径穿越与跨文件夹读取返回 403；write_file/read_file 限工作区与已打开文件夹（归一化防逃逸）
- 渲染进程 sandbox + contextIsolation；本地文件经 ur-file 白名单；Markdown 经 DOMPurify；URL 拉取拒绝内网地址与超 5 跳重定向
- 外部内容无法获得 MCP 调用权

## 验证状态

| 测试 | 结果 |
|---|---|
| MCP 冒烟测试（工具全流程 + 格式 + 权限边界 + 热重载 + 重启恢复） | ✅ 44/44 |
| 全格式逐一打开验证 | ✅ 19/19 |
| 交互式内容（3D 交互/公式/几何/拖拽/复合页运行时标志） | ✅ 5/5 + 图表 |
| 官方 @modelcontextprotocol/sdk 第三方客户端（握手/工具/调用全链路） | ✅ 7/7 |
| 安装版探针（mcp-server.exe → 自动拉起 → 打开 → 状态） | ✅ 6/6 |

> 豆包桌面版本机已安装；其连接器配置位于加密存储，需按 docs/02 在界面内添加一次（协议层已由官方 SDK 验证兼容）。

## 仓库结构

```
src/main/          主进程（窗口、格式路由、ur-file/ur-app/ur-lib 协议、命名管道桥、导出）
src/main/mcp-stdio.js   MCP Server（stdio；SEA 打包为 mcp-server.exe）
src/main/apps.js   文件夹即内容（工作区扫描、权限快照、热重载监听、受限文件工具）
src/preload/       预加载桥（contextBridge）
src/renderer/      界面、渲染器（renderers/*.js）、公共树组件（tree.js）、图标（icons.js）
skill/             Agent Skill（学习页模板 + 零术语工作流）
docs/              选型矩阵 / MCP 配置 / 测试报告 / 构建说明 / 第三方许可
test/              夹具生成（19 种格式 + 6 类交互内容）、冒烟测试、SDK 客户端测试、探针
scripts/           图标生成、mcp-server.exe 构建（Node SEA）、编辑器打包
```

技术选型见 [docs/01-选型矩阵.md](docs/01-选型矩阵.md)；构建与开发见 [docs/04-构建与运行说明.md](docs/04-构建与运行说明.md)；
实测明细见 [docs/03-格式兼容性测试报告.md](docs/03-格式兼容性测试报告.md)。

## 许可证

本项目代码 MIT。第三方组件（Electron/PDF.js/marked/DOMPurify/Tiptap/ArtPlayer/wavesurfer/Viewer/Split.js/SortableJS/KaTeX/JSXGraph/Three.js/Chart.js/SheetJS/mammoth/reveal.js/JSZip）许可见
[docs/THIRD-PARTY-NOTICES.md](docs/THIRD-PARTY-NOTICES.md)。
