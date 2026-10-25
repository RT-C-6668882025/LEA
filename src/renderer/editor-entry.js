// 编辑器依赖打包入口（esbuild --bundle 成 IIFE，挂到 window.UrEditorKit）
// 运行时零依赖：产物 editor.bundle.js 为静态文件，离线可用。
import { Editor, Node, Extension, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

window.UrEditorKit = { Editor, Node, Extension, mergeAttributes, StarterKit };
window.dispatchEvent(new Event('ur-editor-ready'));
