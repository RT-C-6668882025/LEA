---
name: oea
description: 通过 MCP 操作 LEA 客户端：为用户生成交互式学习页面（3D 演示、公式、动态几何、拖拽练习、测验、视频），以及打开本地文件。当用户说"我想学/给我讲/做个演示/出几道题/做个小工具"时使用本技能。
---

# LEA —— 交互式学习内容生成

客户端负责渲染与运行，你（Agent）负责**生成内容**。用户只会说"我想学 XXX"，**不需要懂任何技术术语**——选题、结构、代码、交互全部由你完成。

## 核心工作流（用户视角零术语）

用户："我想学勾股定理" / "给我讲讲太阳系" / "出几道化学题"

你做三步：
1. **write_file** 在工作区创建文件夹，写入 `index.html`（用下面的模板，替换成对应主题的内容）
2. **open_folder** 打开它 → 客户端自动弹出运行
3. 用户说"再加一节练习" → 直接 write_file 改文件 → **自动热更新**，用户进度不丢

工作区路径用 `list_folders` 的 `root` 获得。

## 学习页模板（复制后改内容即可）

```html
<!DOCTYPE html><html><head><meta charset="utf-8"><title>主题名</title>
<link rel="stylesheet" href="ur-lib://local/katex/katex.min.css">
<link rel="stylesheet" href="ur-lib://local/jsxgraph/jsxgraph.css">
<style>
*{box-sizing:border-box}body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;margin:0;padding:0 0 60px;background:#fffdf8;color:#292524}
.hero{background:linear-gradient(135deg,#d97706,#f59e0b);color:#fff;padding:36px 32px}
.hero h1{margin:0 0 6px}.hero p{margin:0;opacity:.9}
section{max-width:860px;margin:24px auto;padding:22px 26px;background:#fff;border:1px solid #d6ccb8;border-radius:14px}
h2{margin:0 0 14px;color:#b45309;border-bottom:2px solid #f5e9d3;padding-bottom:8px}
.hint{color:#78716c;font-size:13px}
.f{margin:14px 0;font-size:1.2em}
.quiz-q{margin:10px 0;padding:12px 16px;border:1px solid #d6ccb8;border-radius:10px;cursor:pointer}
.quiz-q:hover{border-color:#d97706}.quiz-q.right{border-color:#22c55e;background:#f0fdf4}.quiz-q.wrong{border-color:#ef4444;background:#fef2f2}
.item{background:#fff;border:1px solid #d6ccb8;border-radius:8px;padding:12px 16px;margin:8px 0;cursor:grab}
.item.ok{border-color:#22c55e;background:#f0fdf4}
video{max-width:100%;border-radius:10px}canvas{border-radius:10px;max-width:100%}
#box{width:100%;height:380px;border:1px solid #d6ccb8;border-radius:10px;background:#fff}
#progress{position:fixed;top:0;left:0;height:4px;background:#22c55e;transition:width .3s;z-index:99;width:0}
.score{font-weight:700;color:#22c55e}
</style></head><body>
<div id="progress"></div>
<div class="hero"><h1>这里写主题</h1><p>这里写一句话简介</p></div>

<!-- 每个区块独立，不需要的整段删除 -->

<!-- 讲解文字 -->
<section><h2>讲解</h2><p>正文…</p></section>

<!-- 数学公式（库由客户端内置，直接引用） -->
<section><h2>公式</h2><div class="f"><span id="fx1"></span></div>
<script src="ur-lib://local/katex/katex.min.js"></script>
<script>katex.render('a^2 + b^2 = c^2', document.getElementById('fx1'), { displayMode: true });</script></section>

<!-- 3D 交互（可拖拽旋转/滚轮缩放） -->
<section><h2>3D 演示</h2><p class="hint">拖动旋转 · 滚轮缩放</p><canvas id="c3d"></canvas>
<script src="ur-lib://local/three/three.min.js"></script>
<script>
(function(){try{
  var cv=document.getElementById('c3d'),rd=new THREE.WebGLRenderer({canvas:cv,antialias:true}),
  sc=new THREE.Scene();sc.background=new THREE.Color(0x1a1c22);
  var cam=new THREE.PerspectiveCamera(60,1,.1,100),g=new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1.6,1.6,1.6),new THREE.MeshStandardMaterial({color:0xd97706,roughness:.35})));
  g.add(new THREE.AxesHelper(2.2));sc.add(g);
  sc.add(new THREE.AmbientLight(0xffffff,.5));var dl=new THREE.DirectionalLight(0xffffff,1);dl.position.set(2,3,4);sc.add(dl);
  var rx=.5,ry=.6,d=4.2,dr=false,lx=0,ly=0;
  function rs(){var w=Math.min(760,cv.parentElement.clientWidth-52);cv.width=w;cv.height=Math.round(w*.56);cam.aspect=w/cv.height;cam.updateProjectionMatrix()}
  window.addEventListener('resize',rs);rs();cv.style.touchAction='none';
  cv.addEventListener('pointerdown',function(e){dr=true;lx=e.clientX;ly=e.clientY});
  window.addEventListener('pointermove',function(e){if(!dr)return;ry+=(e.clientX-lx)*.008;rx+=(e.clientY-ly)*.008;lx=e.clientX;ly=e.clientY});
  window.addEventListener('pointerup',function(){dr=false});
  cv.addEventListener('wheel',function(e){e.preventDefault();d=Math.max(2.2,Math.min(9,d+e.deltaY*.004))},{passive:false});
  var t=0;(function lp(){requestAnimationFrame(lp);t+=.016;g.rotation.x=rx;g.rotation.y=ry+t*.3;cam.position.set(0,0,d);cam.lookAt(0,0,0);rd.render(sc,cam)})();
}catch(e){}})();
</script></section>

<!-- 动态几何（可拖动的点） -->
<section><h2>动态几何</h2><p class="hint">拖动点观察变化</p><div id="box" class="jxgbox"></div>
<script src="ur-lib://local/jsxgraph/jsxgraphcore.js"></script>
<script>
(function(){try{
  var b=JXG.JSXGraph.initBoard('box',{boundingbox:[-3,3,8,-3],axis:true,showCopyright:false});
  var O=b.create('point',[0,0],{fixed:true,size:1,name:''});
  var A=b.create('point',[1,0],{size:4,name:'P'});
  b.create('circle',[O,A],{strokeColor:'#d97706'});
  b.create('segment',[O,A],{strokeColor:'#78716c'});
}catch(e){}})();
</script></section>

<!-- 拖拽排序练习 -->
<section><h2>排序练习</h2><p class="hint">把步骤拖成正确顺序</p>
<div id="list">
  <div class="item" data-k="1">步骤一</div>
  <div class="item" data-k="3">步骤三</div>
  <div class="item" data-k="2">步骤二</div>
</div>
<div id="sortmsg" class="hint"></div>
<script src="ur-lib://local/sortable/sortable.min.js"></script>
<script>
Sortable.create(document.getElementById('list'),{animation:150,onEnd:function(){
  var ks=[].map.call(document.querySelectorAll('.item'),function(el){return el.dataset.k}).join('');
  if(ks==='123'){document.getElementById('sortmsg').innerHTML='<span class="score">✓ 正确！</span>';document.querySelectorAll('.item').forEach(function(el){el.classList.add('ok')})}
}});
</script></section>

<!-- 选择题测验 -->
<section><h2>测验</h2><div id="quiz"></div><div id="qmsg"></div>
<script>
(function(){
  var qs=[{q:'题目1？',opts:['A','B','C'],a:0},{q:'题目2？',opts:['A','B','C'],a:1}];
  var s=0,dn=0,w=document.getElementById('quiz');
  qs.forEach(function(it,qi){var d=document.createElement('div');
    d.innerHTML='<b>'+(qi+1)+'. '+it.q+'</b>';
    it.opts.forEach(function(o,oi){var b=document.createElement('div');b.className='quiz-q';b.textContent=o;
      b.addEventListener('click',function(){if(d.dataset.done)return;d.dataset.done='1';dn++;
        if(oi===it.a){b.classList.add('right');s++}else b.classList.add('wrong');
        if(dn===qs.length)document.getElementById('qmsg').innerHTML='得分：<span class="score">'+s+' / '+qs.length+'</span>'});
      d.appendChild(b)});w.appendChild(d)});
})();
</script></section>

<!-- 视频讲解（视频文件放同目录 assets/，或让用户提供路径） -->
<section><h2>视频</h2><video src="assets/demo.mp4" controls width="100%"></video></section>

<script>
function bump(){var m=['__D3INT','__KATEX','__GEO','__SORT','__QUIZ'].filter(function(k){return window[k]}).length;
  document.getElementById('progress').style.width=Math.round(m/5*100)+'%'}
setTimeout(bump,800);
</script>
</body></html>
```

写入时配套：`write_file {path: root+"/主题名/app.json", content: "{\"entry\":\"index.html\",\"permissions\":[\"storage\"]}"}`（storage 用于记住学习进度）。

## 可用内置库（页面里直接引用，无需下载复制）

| 引用 | 用途 |
|---|---|
| `<script src="ur-lib://local/katex/katex.min.js">` | 数学公式 |
| `<script src="ur-lib://local/three/three.min.js">` | 3D 场景 |
| `<script src="ur-lib://local/jsxgraph/jsxgraphcore.js">` | 动态几何/函数图像 |
| `<script src="ur-lib://local/sortable/sortable.min.js">` | 拖拽排序 |
| `<script src="ur-lib://local/chartjs/chart.umd.js">` | 统计图表（柱状/折线/饼图等，全局 window.Chart） |
| `<script src="ur-lib://local/marked/marked.min.js">` | Markdown 图文区块（全局 window.marked） |
| 对应 CSS：`ur-lib://local/katex/katex.min.css`、`ur-lib://local/jsxgraph/jsxgraph.css` | |

## 复合页可容纳的全部区块（14 种）

图文 Markdown（marked）/ 图片 / 音频 / 视频 / 公式（KaTeX）/ 几何（JSXGraph）/ 3D（Three.js）/ 图表（Chart.js）/ 拖拽（SortableJS）/ 测验（内置）/ **PDF（PDF.js 页面内嵌）** / **Word（mammoth）** / **Excel（SheetJS）** / **PPT（JSZip 文本提取）**——全部 ur-lib 直引、同页共存、每块独立。写法见 test/fixtures/interactive/fullhouse/index.html（全家福参考实现）。

PDF 区块要点：

```html
<canvas class="pdfpage"></canvas>
<script src=ur-lib://local/pdfjs/pdf.min.js></script>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc = ur-lib://local/pdfjs/pdf.worker.min.js;
pdfjsLib.getDocument("assets/xx.pdf").promise.then(function (doc) { /* getPage → render */ });
</script>
```

## 全局搜索 / 历史版本（改坏了能回退）

- `search_content {query}`：跨工作区全部分文件夹搜索文本，返回命中行与片段
- **每次 write_file 自动快照**（保留 20 份）：改坏内容时 `list_versions {path}` 查历史，`restore_version {path, version}` 一键恢复（恢复后再热更新；恢复前也会快照当前版，可撤销恢复）

## 双链（Obsidian 式 [[知识点]]）— 前置知识跳转

正文任何位置直接写 `[[名字]]` 或 `[[名字|显示文字]]`，客户端运行时**自动**转成可点击链接（零代码）。
点击后自动打开工作区同名文件夹或文件。用于前置知识引用：

```html
<p>本节前置知识是 [[极限]] 与 [[导数]]，请先掌握。</p>
<!-- 别名写法：[[定积分|积分值]] 显示"积分值"、跳转"定积分" -->
```

规则：
- 目标 = 工作区里的**同名文件夹**或同名文件（去扩展名匹配）；支持**嵌套路径** `[[英语/动词/一般现在时]]`
- **块引用**：`[[英语/动词/一般现在时#question-103]]` → 打开该页并**滚动定位到 id="question-103" 的元素**（琥珀色高亮）——精确引用某道题/某个段落；给目标元素加 id 或 data-block 属性即可被引用
- 锚点引用显示时带 ¶ 标记；别名 `[[名#锚点|显示文字]]` 均支持
- 每个知识点建成独立小文件夹（index.html + app.json），主课用双链引用它们——用户点链跳过去学，学完可从对方页面的反向双链跳回
- 双链在讲解、图注、测验题目里都生效；Markdown 区块渲染后同样会被转链

## 图文讲解区块（Markdown 进复合页）

富文本/图文与 3D/公式/测验同页共存——用内置 marked 渲染 Markdown：

```html
<div class="md" id="mdblock"></div>
<script src="ur-lib://local/marked/marked.min.js"></script>
<script>
document.getElementById('mdblock').innerHTML = marked.parse('# 小标题\n\n正文 **加粗** 与列表\n\n- 要点一\n- 要点二');
</script>
```

图片直接 `<img src="assets/xx.png">`（本地文件相对路径）。

## 交互验证要点（生成后自查）

- 3D：`pointerdown/move` 拖拽旋转 + `wheel` 缩放（模板已内置）
- 测验/排序：答对即时变色反馈（模板已内置）
- 大媒体（视频/音频）：放 `assets/` 相对路径引用；库**不要**复制，直接 ur-lib 引用

## 工具（10 个）

| 工具 | 说明 |
|---|---|
| `open_folder {path}` | 打开文件夹（学习页）或本地文件（PDF/MD/图片/音视频等） |
| `list_folders {}` | 工作区列表；返回值 `root` 是工作区路径 |
| `reload_folder {content_id?}` | 强制重载（改文件一般不需要，自动热更新） |
| `get_view_state {}` | 当前标签页 + 学习页运行时状态（标题/localStorage 进度） |
| `navigate_folder {target}` | 切换内容或页内跳转 |
| `write_file {path, content}` | 写文件（自动建目录，≤10MB，仅工作区/已打开文件夹） |
| `read_file {path}` | 读文本文件（≤8MB，自动识别编码） |
| `search_content {query}` | 全局搜索工作区全部内容（命中行+片段） |
| `list_versions {path}` | 查看文件历史版本（write_file 自动快照 ×20） |
| `restore_version {path, version}` | 恢复到历史版本（可撤销，自动热更新） |

用户在客户端里按 **Ctrl+K** 打开命令面板（搜已打开标签/工作区/全局内容），与 search_content 同源。

## 常见错误

| 错误码 | 含义 | 应对 |
|---|---|---|
| FOLDER_NOT_FOUND | 路径不存在 | 用 list_folders 确认 |
| NO_ENTRY | 缺 index.html | 写入口文件 |
| NOT_ALLOWED | 越出工作区/已打开文件夹 | 移入允许范围 |
| PAGEERR/KATEXERR | 页面自身 JS/公式错误 | 修复内容（KaTeX 反斜杠在 JS 字符串里要写双反斜杠 `\\frac`） |
