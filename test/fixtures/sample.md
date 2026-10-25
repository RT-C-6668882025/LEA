# Universal Renderer 测试文档

这是一个用于验证 **Markdown 渲染** 的样例文件。

## 列表

1. 自动识别文件格式
2. 自动选择渲染器
3. 多标签页切换
4. MCP 接口供外部 Agent 调用

## 表格

| 格式 | 渲染引擎 | 状态 |
| ---- | -------- | ---- |
| Markdown | marked + DOMPurify | ✅ |
| PDF | PDF.js | ✅ |
| 图片/音视频 | Chromium 内置 | ✅ |
| EPUB | foliate-js（第三阶段） | 规划中 |

## 代码块

```js
function greet(name) {
  return `你好, ${name}!`;
}
console.log(greet('Universal Renderer'));
```

> 引用块：本客户端只负责渲染，不负责生成内容。

行内代码 `const x = 42` 与 [外部链接](https://github.com/mozilla/pdf.js) 示例。

## 中文排版

白日依山尽，黄河入海流。欲穷千里目，更上一层楼。

---

*完*
