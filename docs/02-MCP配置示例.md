# MCP 接入配置指南

**最简方式**：打开 LEA 客户端 → 顶栏 🔌「接入 AI Agent」按钮（或 `LEA.exe --agent-wizard`）→ 「复制豆包启动命令」→ 粘贴到豆包的命令输入框。其他客户端的 JSON 位于向导的折叠区。路径自动填好，无需手写。

以下为手动配置说明：

LEA 内置标准 MCP Server（stdio 传输，JSON-RPC 2.0，换行分隔帧）。
当前工具集为**文件夹即内容**架构（10 个工具）：`open_folder` / `list_folders` / `reload_folder` /
`get_view_state` / `navigate_folder` / `write_file` / `read_file` / `search_content` / `list_versions` / `restore_version` —— Agent 写文件，客户端沙箱运行并热更新（全局搜索与历史回退内置）。

它与桌面上已安装的客户端通过 Windows 命名管道 `\\.\pipe\lea-ipc` 通信；
**客户端未运行时会自动拉起**，客户端重启后 MCP 会自动重连，无需人工干预。
工作区默认为 `文档\LEA\`（list_folders 返回 root 字段）。

## 启动命令（安装目录下）

安装完成后（默认目录 `%LOCALAPPDATA%\Programs\LEA\`）：

| 优先级 | command | args | 说明 |
|---|---|---|---|
| 推荐 | `...\mcp-server.exe` | `[]` | 独立 MCP Server（Node SEA 打包），所有客户端均可直接 spawn |
| 备选 | `...\resources\app\mcp-server.cmd` | `[]` | 以 ELECTRON_RUN_AS_NODE 运行，功能相同 |

> ⚠️ 不要把 GUI 主进程 `LEA.exe --mcp-stdio` 配置为 MCP 命令：
> Windows GUI 子系统进程的 stdio 不可用，该方式会在运行时弹窗提示并退出。

## 豆包桌面版

入口：豆包桌面版左侧「技能 · 连接器 · 伙伴」→「新建自定义连接器」→ 选择「本地命令（stdio）」，
在命令输入框中只填写 mcp-server.exe 的绝对路径，参数和环境变量留空；保存后**信任并启用**该连接器。

**不要将下方 JSON 粘贴到豆包的命令输入框。** 豆包会将 `{` 当成程序名，报 `COMMAND_NOT_FOUND`。路径包含空格时，用双引号包住整条路径。

例如：

```text
C:\Users\Administrator\AppData\Local\Programs\LEA\mcp-server.exe
```
（不同版本菜单文案可能有差异，以实际界面为准；配置后务必用"打开一个本地文件"实测。）

以下 JSON 仅用于支持 MCP JSON 配置导入的客户端：

```json
{
  "mcpServers": {
    "lea": {
      "command": "C:\\Users\\<你的用户名>\\AppData\\Local\\Programs\\LEA\\mcp-server.exe",
      "args": []
    }
  }
}
```

## 通用 JSON 配置（Claude Desktop / Cline / 其他兼容客户端）

```json
{
  "mcpServers": {
    "lea": {
      "command": "C:\\Users\\<你的用户名>\\AppData\\Local\\Programs\\LEA\\mcp-server.exe",
      "args": []
    }
  }
}
```

备选（.cmd 方式，部分客户端无法直接 spawn .cmd 时请用上面的 exe 方式）：

```json
{
  "mcpServers": {
    "lea": {
      "command": "C:\\Users\\<你的用户名>\\AppData\\Local\\Programs\\LEA\\resources\\app\\mcp-server.cmd",
      "args": []
    }
  }
}
```

提示：安装时若自定义了目录，替换为实际路径即可。

## 验证连接是否成功

配置后向 Agent 发一句：

> 用 lea 列出工作区文件夹

预期：客户端自动启动（若未运行），返回工作区路径和文件夹列表。

再试一句（验证可编辑页面能力）：

> 在 LEA 工作区创建“勾股定理”文件夹，写入 index.html，包含讲解文字和可点击的直角三角形演示，再用 lea 打开它。

预期：Agent 通过 write_file 写入页面、open_folder 打开文件夹，页面在沙箱中运行。后续修改文件会自动热更新。
若失败，按下表排查：

| 现象 | 原因 | 处理 |
|---|---|---|
| Agent 工具列表里没有 10 个工具 | 配置未生效/未启用 | 重启 Agent 客户端，确认连接器已"信任+启用" |
| command="{" / COMMAND_NOT_FOUND | 将 JSON 粘进了命令框 | 清空命令框，改为 mcp-server.exe 的实际路径；参数留空 |
| 弹出「MCP 配置提示」对话框 | 误用了 LEA.exe --mcp-stdio | 改用 mcp-server.exe |
| 调用报 APP_NOT_RUNNING | 自动启动被安全软件拦截 | 手动启动客户端再试 |
| 调用超时 | 杀毒软件拦截命名管道通信 | 加入白名单后重试 |
| 客户端弹窗但内容不渲染 | 个别文件编码/编码器问题 | 查看客户端错误卡片与日志 |

## 日志位置

- 应用日志：`%APPDATA%\LEA\oea.log`
- 视图状态：`%APPDATA%\LEA\view-state.json`
- MCP Server 运行日志走 stderr（由 Agent 客户端决定是否展示）

## 安全边界（Agent 侧须知）

1. Agent 只能打开**用户通过对话框授权过的文件**与显式传入 `path` 的文件；
   渲染进程无法借道读取磁盘其他文件（协议层白名单校验）。
2. URL 仅允许 http/https，拒绝内网地址（127.x/10.x/192.168.x/172.16-31.x/localhost 等）与重定向超 5 跳。
3. Agent 传入的 HTML 在沙箱 iframe 中运行：无网络、无本地文件、无同源权限。
4. Agent 无法通过渲染内容间接获得 MCP 调用权。
