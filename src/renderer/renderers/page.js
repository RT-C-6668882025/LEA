'use strict';
/* 页面渲染器（.urpage）：Tiptap 管理可编辑内容块；
   图片/视频/音频/互动块为原子节点（编辑器不解析其内部内容），
   HTML/CSS/JS 互动页以字符串属性存储、渲染进独立沙箱 iframe —— 编辑器整理不会破坏 JS。
   阅读模式增强：Viewer.js（图片缩放）、ArtPlayer（视频）、wavesurfer.js（音频波形）。 */
(function () {
  window.URRenderers = window.URRenderers || {};

  const IFRAME_CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' ur-lib:; style-src \'unsafe-inline\' ur-lib:; img-src data: blob:; media-src blob: data:; font-src data: ur-lib:; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\';">';
  // 内置离线库：经 ur-lib:// 协议注入沙箱（无需 CDN 与网络），全局对象 katex/Sortable/JXG/THREE
  const LIB_TAGS = {
    katex: '<link rel="stylesheet" href="ur-lib://local/katex/katex.min.css"><script src="ur-lib://local/katex/katex.min.js"></script>',
    sortable: '<script src="ur-lib://local/sortable/sortable.min.js"></script>',
    jsxgraph: '<link rel="stylesheet" href="ur-lib://local/jsxgraph/jsxgraph.css"><script src="ur-lib://local/jsxgraph/jsxgraphcore.js"></script>',
    three: '<script src="ur-lib://local/three/three.min.js"></script>',
  };
  function libTags(libs) {
    return (Array.isArray(libs) ? libs : []).filter((l) => LIB_TAGS[l]).map((l) => LIB_TAGS[l]).join('\n');
  }
  const DEFAULT_INTERACTIVE = '<style>body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;text-align:center;padding:18px;color:#1a1c22}</style>\n<h3>互动演示</h3>\n<p id="n" style="font-size:40px;font-weight:700;margin:8px">0</p>\n<button onclick="document.getElementById(\'n\').textContent=Number(document.getElementById(\'n\').textContent)+1" style="font-size:16px;padding:8px 20px">+1</button>';

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  window.URRenderers.page = {
    mount(container, payload, api) {
      if (window.urAPI.log) window.urAPI.log(`page mount: Artplayer=${typeof window.Artplayer} WaveSurfer=${typeof window.WaveSurfer} Viewer=${typeof window.Viewer} Kit=${typeof window.UrEditorKit} from=${payload.pageFrom}`);
      const Kit = window.UrEditorKit || {};
      if (!Kit.Editor || !Kit.Node) {
        api.fail('编辑器资源未加载（editor.bundle.js 缺失），请重新构建应用');
        return {};
      }

      const page = payload.page || {};
      const ui = api.uiState || {};
      const tabId = payload.contentId;
      let pagePath = payload.path || null; // 另存后更新
      let editing = ui.mode === 'edit';
      let dirty = false;
      let destroyed = false;
      const videoPlayers = [];
      const audioPlayers = [];
      let viewerObj = null;

      function resolveSrc(src) {
        const s = String(src || '');
        if (!s || /^(data:|blob:|https?:|ur-file:)/i.test(s)) return s;
        if (!pagePath) return s;
        const abs = s.replace(/^\.\//, '').replace(/^\//, '');
        return window.urFileUrl(pagePath.replace(/[\\/][^\\/]*$/, '') + '/' + abs);
      }

      // ---------- DOM 骨架 ----------
      container.style.overflow = 'auto';
      const root = document.createElement('div');
      root.className = 'urpage-root' + (editing ? ' editing' : '');
      root.innerHTML = `
        <div class="page-toolbar">
          <button data-cmd="bold" title="加粗 (Ctrl+B)"><b>B</b></button>
          <button data-cmd="italic" title="斜体 (Ctrl+I)"><i>I</i></button>
          <button data-cmd="strike" title="删除线"><s>S</s></button>
          <button data-cmd="code" title="行内代码">&lt;/&gt;</button>
          <span class="page-tb-sep"></span>
          <button data-cmd="h1" title="一级标题">H1</button>
          <button data-cmd="h2" title="二级标题">H2</button>
          <button data-cmd="h3" title="三级标题">H3</button>
          <span class="page-tb-sep"></span>
          <button data-cmd="bullet" title="无序列表">• 列表</button>
          <button data-cmd="order" title="有序列表">1. 列表</button>
          <button data-cmd="quote" title="引用">引用</button>
          <button data-cmd="codeblock" title="代码块">代码块</button>
          <button data-cmd="hr" title="分割线">—</button>
          <span class="page-tb-sep"></span>
          <button data-cmd="image" title="插入图片">图片</button>
          <button data-cmd="video" title="插入视频">视频</button>
          <button data-cmd="audio" title="插入音频">音频</button>
          <button data-cmd="interactive" title="插入互动组件（沙箱 HTML/CSS/JS）">互动块</button>
          <span class="page-tb-sep"></span>
          <button data-cmd="undo" title="撤销 (Ctrl+Z)"><span data-icon="undo"></span></button>
          <button data-cmd="redo" title="重做 (Ctrl+Y)"><span data-icon="redo"></span></button>
          <span style="flex:1"></span>
          <button data-cmd="save" class="page-save" title="保存 (Ctrl+S)">保存</button>
        </div>
        <div class="page-titlebar">
          <input class="page-title" placeholder="页面标题" maxlength="120">
          <span class="page-dirty" title="有未保存的修改" style="display:none">●</span>
          <button class="page-immersive" title="沉浸模式：逐块上下切换 (Esc 退出)"><span data-icon="book"></span>沉浸</button>
          <button class="page-mode-toggle" title="切换阅读/编辑 (Ctrl+E)"></button>
        </div>`;
      root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = window.urIcon(el.dataset.icon, 14); });
      const editorEl = document.createElement('div');
      editorEl.className = 'page-editor';
      root.appendChild(editorEl);

      const sourcePanel = document.createElement('div');
      sourcePanel.className = 'ur-source-panel';
      sourcePanel.style.display = 'none';
      sourcePanel.innerHTML = `
        <div class="ur-source-head"><b>互动组件源码</b><span>独立沙箱运行：仅内联脚本/样式，无网络、无本地文件访问</span></div>
        <textarea class="ur-source-text" spellcheck="false"></textarea>
        <div class="ur-source-foot">
          <button class="ur-source-apply">应用</button>
          <button class="ur-source-cancel">取消</button>
        </div>`;
      root.appendChild(sourcePanel);
      container.appendChild(root);

      const titleInput = root.querySelector('.page-title');
      const dirtyEl = root.querySelector('.page-dirty');
      const modeBtn = root.querySelector('.page-mode-toggle');
      const srcText = sourcePanel.querySelector('.ur-source-text');
      let srcApplyFn = null;

      // ---------- 自定义原子节点 ----------
      function setNodeAttrs(getPos, current, attrs) {
        const pos = getPos();
        if (pos == null) return;
        const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...current, ...attrs });
        editor.view.dispatch(tr);
      }

      const PageImage = Kit.Node.create({
        name: 'pageImage',
        group: 'block',
        atom: true,
        draggable: true,
        addAttributes: () => ({ src: { default: '' }, caption: { default: '' } }),
        parseHTML: () => [{ tag: 'div[data-ur-image]' }],
        renderHTML({ node }) { return ['div', { 'data-ur-image': '1' }, ['img', { src: String(node.attrs.src) }]]; },
        addNodeView() {
          return ({ node, getPos }) => {
            const fig = document.createElement('figure');
            fig.className = 'ur-block ur-figure';
            const img = document.createElement('img');
            img.alt = node.attrs.caption || '';
            const cap = document.createElement('figcaption');
            const capInput = document.createElement('input');
            capInput.className = 'ur-caption-input ur-edit-only';
            capInput.placeholder = '图片说明（可选）';
            capInput.maxLength = 200;
            const capText = document.createElement('div');
            capText.className = 'ur-caption-text ur-read-only';
            cap.append(capInput, capText);
            fig.append(img, cap);
            const apply = () => {
              img.src = resolveSrc(node.attrs.src);
              capInput.value = node.attrs.caption || '';
              capText.textContent = node.attrs.caption || '';
            };
            apply();
            capInput.addEventListener('input', () => setNodeAttrs(getPos, node.attrs, { caption: capInput.value }));
            capInput.addEventListener('keydown', (e) => e.stopPropagation());
            img.addEventListener('error', () => fig.classList.add('ur-media-error'));
            img.addEventListener('load', () => fig.classList.remove('ur-media-error'));
            return {
              dom: fig,
              update(updated) {
                if (updated.type.name !== 'pageImage') return false;
                node = updated;
                apply();
                return true;
              },
              stopEvent: () => true,
              ignoreMutation: () => true,
              destroy() {},
            };
          };
        },
      });

      const PageVideo = Kit.Node.create({
        name: 'pageVideo',
        group: 'block',
        atom: true,
        addAttributes: () => ({ src: { default: '' } }),
        parseHTML: () => [{ tag: 'div[data-ur-video]' }],
        renderHTML({ node }) { return ['div', { 'data-ur-video': '1' }, ['video', { src: String(node.attrs.src), controls: true }]]; },
        addNodeView() {
          return ({ node, getPos }) => {
            const wrap = document.createElement('div');
            wrap.className = 'ur-block ur-media';
            const mount = document.createElement('div');
            mount.className = 'ur-art-mount';
            wrap.appendChild(mount);
            let player = null;
            const make = () => {
              if (!window.Artplayer) { mount.textContent = 'ArtPlayer 未加载'; window.urAPI.log('page: ArtPlayer 全局缺失'); return; }
              try {
                player = new Artplayer({
                  container: mount,
                  url: resolveSrc(node.attrs.src),
                  width: '100%', height: 340,
                  setting: true, playbackRate: true, aspectRatio: true, fullscreen: true, pip: true, mutex: false,
                });
                videoPlayers.push(player);
                window.urAPI.log('page: ArtPlayer 初始化成功 ' + resolveSrc(node.attrs.src).slice(0, 60));
              } catch (e) {
                mount.textContent = '视频播放器初始化失败: ' + e.message;
                window.urAPI.log('page: ArtPlayer 初始化失败: ' + e.message);
              }
            };
            make();
            return {
              dom: wrap,
              update(updated) {
                if (updated.type.name !== 'pageVideo') return false;
                const old = resolveSrc(node.attrs.src);
                node = updated;
                const nu = resolveSrc(node.attrs.src);
                if (player && old !== nu) { try { player.switchUrl(nu); } catch {} }
                return true;
              },
              stopEvent: () => true,
              ignoreMutation: () => true,
              destroy() {
                const i = videoPlayers.indexOf(player);
                if (i >= 0) videoPlayers.splice(i, 1);
                try { player && player.destroy(); } catch {}
              },
            };
          };
        },
      });

      const PageAudio = Kit.Node.create({
        name: 'pageAudio',
        group: 'block',
        atom: true,
        addAttributes: () => ({ src: { default: '' } }),
        parseHTML: () => [{ tag: 'div[data-ur-audio]' }],
        renderHTML({ node }) { return ['div', { 'data-ur-audio': '1' }, ['audio', { src: String(node.attrs.src), controls: true }]]; },
        addNodeView() {
          return ({ node, getPos }) => {
            const wrap = document.createElement('div');
            wrap.className = 'ur-block ur-audio';
            const bar = document.createElement('div');
            bar.className = 'ur-audio-bar';
            const playBtn = document.createElement('button');
            playBtn.className = 'ur-audio-play';
            playBtn.innerHTML = window.urIcon('play', 14);
            const time = document.createElement('span');
            time.className = 'ur-audio-time';
            time.textContent = '0:00';
            const wave = document.createElement('div');
            wave.className = 'ur-audio-wave';
            bar.append(playBtn, time);
            wrap.append(bar, wave);
            let ws = null;
            const audioFallback = () => {
              if (wave.firstChild && wave.firstChild.tagName === 'AUDIO') return;
              wave.innerHTML = '<audio controls style="width:100%"></audio>';
              wave.firstChild.src = resolveSrc(node.attrs.src);
            };
            try {
              if (window.WaveSurfer) {
                ws = new WaveSurfer({
                  container: wave, height: 56,
                  waveColor: '#8b91a3', progressColor: '#5b8cff', cursorColor: '#e8eaf0', barWidth: 2, barGap: 2,
                });
                ws.load(resolveSrc(node.attrs.src));
                ws.on('ready', () => { time.textContent = fmtTime(ws.getCurrentTime()) + ' / ' + fmtTime(ws.getDuration()); });
                ws.on('audioprocess', () => { time.textContent = fmtTime(ws.getCurrentTime()) + ' / ' + fmtTime(ws.getDuration()); });
                const btn = () => { playBtn.innerHTML = window.urIcon(ws.isPlaying() ? 'pause' : 'play', 14); };
                ws.on('play', btn); ws.on('pause', btn); ws.on('finish', btn);
                ws.on('error', () => { time.textContent = '波形失败，已回退原生播放器'; audioFallback(); });
                audioPlayers.push(ws);
              }
            } catch (e) { time.textContent = '波形加载失败'; }
            if (!ws) { audioFallback(); }
            playBtn.addEventListener('click', () => { try { ws && ws.playPause(); } catch {} });
            return {
              dom: wrap,
              update(updated) {
                if (updated.type.name !== 'pageAudio') return false;
                node = updated;
                try { ws && ws.load(resolveSrc(node.attrs.src)); } catch {}
                return true;
              },
              stopEvent: () => true,
              ignoreMutation: () => true,
              destroy() {
                const i = audioPlayers.indexOf(ws);
                if (i >= 0) audioPlayers.splice(i, 1);
                try { ws && ws.destroy(); } catch {}
              },
            };
          };
        },
      });

      const Interactive = Kit.Node.create({
        name: 'interactive',
        group: 'block',
        atom: true,
        addAttributes: () => ({ html: { default: '' }, height: { default: 320 }, libs: { default: [] } }),
        parseHTML: () => [{ tag: 'div[data-ur-interactive]' }],
        renderHTML({ node }) { return ['div', { 'data-ur-interactive': '1' }, ['iframe', { srcdoc: String(node.attrs.html), sandbox: 'allow-scripts allow-forms', style: `height:${Math.max(120, Math.min(2400, Number(node.attrs.height) || 320))}px;width:100%` }]]; },
        addNodeView() {
          return ({ node, getPos }) => {
            const box = document.createElement('div');
            box.className = 'ur-block ur-interactive';
            const bar = document.createElement('div');
            bar.className = 'ur-interactive-bar';
            bar.innerHTML = `<span class="ur-badge">互动组件 · 沙箱</span>
              <select class="ur-ix-libs ur-edit-only" title="内置离线库（注入沙箱执行）">
                <option value="">内置库：无</option>
                <option value="katex">KaTeX 公式</option>
                <option value="sortable">Sortable 拖拽</option>
                <option value="jsxgraph">JSXGraph 几何</option>
                <option value="three">Three.js 3D</option>
              </select>
              <button class="ur-ix-btn ur-edit-only" data-act="src">编辑源码</button>
              <button class="ur-ix-btn ur-edit-only" data-act="h-">高度−</button>
              <button class="ur-ix-btn ur-edit-only" data-act="h+">高度＋</button>
              <span class="ur-ix-size ur-read-only"></span>`;
            const frame = document.createElement('iframe');
            frame.setAttribute('sandbox', 'allow-scripts allow-forms');
            frame.className = 'ur-interactive-frame';
            box.append(bar, frame);
            const apply = () => {
              frame.srcdoc = IFRAME_CSP + '\n' + libTags(node.attrs.libs) + '\n' + String(node.attrs.html || '');
              frame.style.height = Math.max(120, Math.min(2400, Number(node.attrs.height) || 320)) + 'px';
              const libDesc = (node.attrs.libs || []).length ? ' · 库: ' + node.attrs.libs.join(',') : '';
              bar.querySelector('.ur-ix-size').textContent = frame.style.height + ' · 源码 ' + String(node.attrs.html || '').length + ' 字符' + libDesc;
              bar.querySelector('.ur-ix-libs').value = (node.attrs.libs || [])[0] || '';
            };
            apply();
            bar.addEventListener('change', (e) => {
              if (e.target.classList.contains('ur-ix-libs')) {
                setNodeAttrs(getPos, node.attrs, { libs: e.target.value ? [e.target.value] : [] });
              }
            });
            bar.addEventListener('click', (e) => {
              const act = e.target && e.target.dataset && e.target.dataset.act;
              if (!act) return;
              if (act === 'src') {
                openSourcePanel(String(node.attrs.html || ''), (val) => setNodeAttrs(getPos, node.attrs, { html: val }));
              } else {
                const cur = Number(node.attrs.height) || 320;
                setNodeAttrs(getPos, node.attrs, { height: act === 'h+' ? cur + 120 : Math.max(120, cur - 120) });
              }
            });
            return {
              dom: box,
              update(updated) {
                if (updated.type.name !== 'interactive') return false;
                node = updated;
                apply();
                return true;
              },
              stopEvent: () => true,
              ignoreMutation: () => true,
              destroy() {},
            };
          };
        },
      });

      // ---------- 编辑器 ----------
      const initialContent = payload.pageFrom === 'doc' && page.doc
        ? page.doc
        : { type: 'doc', content: [{ type: 'paragraph' }] };

      const editor = new Kit.Editor({
        element: editorEl,
        extensions: [Kit.StarterKit.configure({ heading: { levels: [1, 2, 3] } }), PageImage, PageVideo, PageAudio, Interactive],
        content: initialContent,
        editable: false,
        editorProps: { attributes: { class: 'urpage-prosemirror' } },
      });

      // 块规格（Agent blocks / update_block 统一入口）→ Tiptap 插入内容
      function specToInsert(b) {
        b = b || {};
        if (b.type === 'text') {
          return window.DOMPurify.sanitize(String(b.html || ''), {
            FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'select', 'textarea', 'object', 'embed', 'script', 'link', 'meta'],
          });
        }
        if (b.type === 'image') return { type: 'pageImage', attrs: { src: String(b.src || ''), caption: String(b.caption || '') } };
        if (b.type === 'video') return { type: 'pageVideo', attrs: { src: String(b.src || '') } };
        if (b.type === 'audio') return { type: 'pageAudio', attrs: { src: String(b.src || '') } };
        if (b.type === 'interactive') {
          const h = Number(b.height);
          return { type: 'interactive', attrs: { html: String(b.html || ''), height: h >= 120 && h <= 2400 ? h : 320, libs: Array.isArray(b.libs) ? b.libs.filter((l) => LIB_TAGS[l]) : [] } };
        }
        return null;
      }

      if (payload.pageFrom === 'blocks') {
        for (const b of (page.blocks || [])) {
          try {
            const content = specToInsert(b);
            // 块级原子节点必须插在顶层位置（光标在段落内时 insertContent 会静默失败）
            if (content) editor.commands.insertContentAt(editor.state.doc.content.size, content);
          } catch (e) { console.error('块插入失败', e); }
        }
        // 清理 blocks 转换前编辑器自带的空占位段
        const first = editor.state.doc.firstChild;
        if (first && first.type.name === 'paragraph' && first.content.size === 0 && editor.state.doc.childCount > 1) {
          editor.commands.deleteRange({ from: 0, to: first.nodeSize });
        }
      }

      titleInput.value = page.title || '';

      // ---------- MCP 控制 ----------
      const r10 = (x) => Math.round((x || 0) * 10) / 10;
      function firstVideo() {
        return videoPlayers.find((p) => { try { return p && typeof p.currentTime === 'number'; } catch { return false; } });
      }
      function videoPaused(p) {
        try {
          if (typeof p.playing === 'boolean') return !p.playing;
          if (p.$video) return p.$video.paused;
        } catch {}
        return true;
      }
      function mediaState() {
        const v = firstVideo();
        if (v) {
          const d = v.duration || 0;
          const t = v.currentTime || 0;
          return {
            type: 'video', time: r10(t), duration: r10(d),
            percent: d ? Math.round((t / d) * 10000) / 100 : 0,
            paused: videoPaused(v),
          };
        }
        const a = audioPlayers.find((w) => { try { return w.getDuration && w.getDuration() > 0; } catch { return false; } });
        if (a) {
          const d = a.getDuration();
          const t = a.getCurrentTime();
          return {
            type: 'audio', time: r10(t), duration: r10(d),
            percent: d ? Math.round((t / d) * 10000) / 100 : 0,
            paused: !a.isPlaying(),
          };
        }
        return null;
      }

      function mediaControl(action, value) {
        const v = firstVideo();
        if (v) {
          const d = v.duration || 0;
          switch (action) {
            case 'play': v.play(); return true;
            case 'pause': v.pause(); return true;
            case 'toggle_play': try { v.toggle(); } catch { videoPaused(v) ? v.play() : v.pause(); } return true;
            case 'seek': {
              if (!d) return true;
              if (value && typeof value.to === 'number') v.currentTime = Math.max(0, Math.min(d - 0.05, value.to));
              else if (value && typeof value.percent === 'number') v.currentTime = Math.max(0, Math.min(1, value.percent / 100)) * d;
              else if (value && typeof value.offset === 'number') v.currentTime = Math.max(0, Math.min(d - 0.05, v.currentTime + value.offset));
              return true;
            }
            case 'set_volume': v.volume = Math.max(0, Math.min(1, Number(value) || 0)); return true;
            case 'pip': return togglePip();
          }
          return false;
        }
        const a = audioPlayers.find((w) => { try { return w.getDuration && w.getDuration() > 0; } catch { return false; } });
        if (a) {
          const d = a.getDuration();
          switch (action) {
            case 'play': a.play(); return true;
            case 'pause': a.pause(); return true;
            case 'toggle_play': a.playPause(); return true;
            case 'seek': {
              if (value && typeof value.to === 'number') a.seekTo(Math.max(0, Math.min(1, value.to / d)));
              else if (value && typeof value.percent === 'number') a.seekTo(Math.max(0, Math.min(1, value.percent / 100)));
              else if (value && typeof value.offset === 'number') a.seekTo(Math.max(0, Math.min(1, (a.getCurrentTime() + value.offset) / d)));
              return true;
            }
            case 'set_volume': a.setVolume(Math.max(0, Math.min(1, Number(value) || 0))); return true;
          }
        }
        return false;
      }



      // ---------- 块级更新（MCP update_block）与选区（get_selection） ----------
      function blockSpan(i) { // 1-based；返回顶层块 i 的 [start, end) 位置
        const doc = editor.state.doc;
        if (i < 1 || i > doc.childCount) return null;
        let start = 0;
        for (let k = 0; k < i - 1; k++) start += doc.child(k).nodeSize;
        return { start, end: start + doc.child(i - 1).nodeSize };
      }

      function updateBlock(params) {
        const action = params && params.action;
        const index = parseInt(params && params.index, 10);
        const content = params && params.block ? specToInsert(params.block) : null;
        if (!['replace', 'insert_after', 'insert_before', 'delete'].includes(action)) {
          return { ok: false, error: { code: 'INVALID_PARAM', message: "action 需为 'replace'|'insert_after'|'insert_before'|'delete'" } };
        }
        if (action !== 'delete' && !content) {
          return { ok: false, error: { code: 'INVALID_PARAM', message: 'block 内容无效（text/image/video/audio/interactive）' } };
        }
        const count = editor.state.doc.childCount;
        const span = Number.isInteger(index) ? blockSpan(index) : null;
        if (['replace', 'delete'].includes(action) && (!span || index < 1 || index > count)) {
          return { ok: false, error: { code: 'OUT_OF_RANGE', message: `块序号超出范围（共 ${count} 块）` } };
        }
        if (action === 'replace') {
          editor.chain().insertContentAt({ from: span.start, to: span.end }, content).run();
        } else if (action === 'delete') {
          editor.chain().deleteRange({ from: span.start, to: span.end }).run();
        } else if (action === 'insert_after') {
          editor.commands.insertContentAt(Math.min(span ? span.end : editor.state.doc.content.size, editor.state.doc.content.size), content);
        } else if (action === 'insert_before') {
          editor.commands.insertContentAt(span ? span.start : 1, content);
        }
        markDirty();
        return { ok: true, blocks: editor.state.doc.childCount };
      }

      // ---------- 选区（MCP get_selection） ----------
      function getSelectionInfo() {
        const sel = editor.state.selection;
        let blockIndex = null;
        try { blockIndex = Math.min(editor.state.doc.childCount, sel.$from.index(0) + 1); } catch {}
        return {
          text: editor.state.doc.textBetween(sel.from, sel.to, '\n'),
          from: sel.from,
          to: sel.to,
          empty: sel.empty,
          blockIndex,
        };
      }

      // ---------- 导出（MCP export_content / 工具栏） ----------
      function walkBlocks(cb) {
        editor.state.doc.forEach((child) => {
          if (child.type.name === 'pageImage' || child.type.name === 'pageVideo' || child.type.name === 'pageAudio') cb(child.type.name, child.attrs);
          if (child.type.name === 'interactive') cb('interactive', child.attrs);
        });
      }

      async function buildExportHtml(mode) { // mode: 'single'（媒体转绝对路径）| 'zip'（媒体保持相对路径打包）
        const libsUsed = new Set();
        const interactiveBlocks = [];
        const assets = [];
        editor.state.doc.forEach((child) => {
          if (['pageImage', 'pageVideo', 'pageAudio'].includes(child.type.name)) {
            if (child.attrs.src && !/^(data:|https?:|blob:)/i.test(child.attrs.src)) assets.push({ rel: child.attrs.src });
          } else if (child.type.name === 'interactive') {
            interactiveBlocks.push(child.attrs);
            (child.attrs.libs || []).forEach((l) => libsUsed.add(l));
          }
        });
        async function inlineLibScripts(libs) {
          const parts = [];
          for (const l of libs) {
            try {
              if (l === 'katex') {
                let css = (await window.urAPI.libSource('katex/katex.min.css')).data;
                css = await replaceFontsInline(css);
                parts.push(`<style>${css}</style>`);
                parts.push(`<script>${(await window.urAPI.libSource('katex/katex.min.js')).data}</script>`);
              } else {
                const file = { sortable: 'sortable/sortable.min.js', jsxgraph: 'jsxgraph/jsxgraphcore.js', three: 'three/three.min.js' }[l];
                if (file) parts.push(`<script>${(await window.urAPI.libSource(file)).data}</script>`);
                if (l === 'jsxgraph') parts.push(`<style>${(await window.urAPI.libSource('jsxgraph/jsxgraph.css')).data}</style>`);
              }
            } catch (e) { console.error('导出内联库失败', l, e); }
          }
          return parts.join('\n');
        }
        async function replaceFontsInline(css) {
          const re = /url\((fonts\/[\w.-]+\.woff2)\)/g;
          const jobs = [];
          let m;
          while ((m = re.exec(css))) jobs.push(m[1]);
          for (const f of [...new Set(jobs)]) {
            try {
              const b64 = (await window.urAPI.libSource('katex/' + f)).data;
              css = css.split('url(' + f + ')').join('url(data:font/woff2;base64,' + b64 + ')');
            } catch {}
          }
          return css;
        }

        let html = editor.getHTML();
        if (mode === 'single' && pagePath) {
          html = html.replace(/(src|poster)="(\.\.?\/[^"]+)"/g, (m0, attr, rel) => `${attr}="file:///${encodeURI(pagePath.replace(/[\\/][^\\/]*$/, '').replace(/\\/g, '/') + '/' + rel.replace(/^\.\//, ''))}"`);
        }
        // 逐个重建互动块 iframe：srcdoc 内联 CSP + 库（导出文件的沙箱无法引用外部/相对库文件）
        let idx = 0;
        const iframes = [...html.matchAll(/<iframe srcdoc="([^"]*)" sandbox="allow-scripts allow-forms" style="[^"]*"><\/iframe>/g)];
        for (const m of iframes) {
          const attrs = interactiveBlocks[idx++] || { libs: [] };
          const raw = decodeEntities(m[1]);
          const inner = IFRAME_CSP + '\n' + (await inlineLibScripts(attrs.libs || [])) + '\n' + raw;
          html = html.replace(m[0], `<iframe sandbox="allow-scripts allow-forms" srcdoc="${escapeAttr(inner)}" style="width:100%;border:1px solid #ddd;border-radius:8px"></iframe>`);
        }
        const head = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeAttr(titleInput.value.trim() || page.title || '页面')}</title>
<style>body{max-width:860px;margin:0 auto;padding:32px 20px;font-family:"Segoe UI","Microsoft YaHei",sans-serif;line-height:1.75;color:#1a1c22}
img{max-width:100%}iframe{width:100%;border:none}video{max-width:100%}blockquote{border-left:3px solid #5b8cff;margin:.8em 0;padding:2px 16px;color:#555}
figure{margin:1.2em auto;text-align:center}figcaption{color:#777;font-size:13px}pre{background:#f4f5f7;padding:12px;border-radius:8px;overflow-x:auto}</style>
</head><body>
<h1>${escapeAttr(titleInput.value.trim() || page.title || '页面')}</h1>
${html}
</body></html>`;
        return { html: head, libs: [...libsUsed], assets };
      }

      function decodeEntities(s) {
        return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      }

      function escapeAttr(s) {
        return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      }

      // ---------- 沉浸模式（原生 scroll-snap，块级上下切换） ----------
      let immersive = false;
      function setImmersive(on) {
        immersive = !!on;
        container.classList.toggle('immersive', immersive);
        api.setStatus(immersive ? '沉浸模式：滚轮/↑↓ 逐块切换，Esc 退出' : '已退出沉浸模式');
      }

      // ---------- PiP（画中画） ----------
      function togglePip() {
        const v = firstVideo();
        if (v && v.$video) {
          if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(() => {}); return true; }
          v.$video.requestPictureInPicture().catch(() => {});
          return true;
        }
        return false;
      }


      function markDirty() {
        if (!dirty) { dirty = true; dirtyEl.style.display = ''; }
        pushState();
      }
      editor.on('update', markDirty);
      titleInput.addEventListener('input', () => { markDirty(); });
      titleInput.addEventListener('keydown', (e) => e.stopPropagation());

      async function save() {
        const data = { title: titleInput.value.trim() || '未命名页面', doc: editor.getJSON() };
        try {
          if (pagePath) {
            const r = await window.urAPI.pageSave(pagePath, { version: 1, ...data });
            if (r && r.ok) { dirty = false; dirtyEl.style.display = 'none'; api.setStatus(`已保存: ${r.path}`); }
          } else {
            const r = await window.urAPI.pageSaveAs({ version: 1, ...data });
            if (r && r.ok) {
              pagePath = r.path;
              payload.path = r.path;
              window.urAPI.tabRebind(tabId, r.path);
              dirty = false; dirtyEl.style.display = 'none';
              api.setStatus(`已另存为: ${r.path}`);
            }
          }
        } catch (e) {
          api.setStatus(`保存失败: ${e.message}`);
        }
        pushState();
      }

      // ---------- 模式 ----------
      function setMode(m) {
        editing = m === 'edit';
        editor.setEditable(editing);
        root.classList.toggle('editing', editing);
        modeBtn.innerHTML = editing ? window.urIcon('pencil', 13) + '<span>编辑中 → 阅读模式</span>' : window.urIcon('eye', 13) + '<span>阅读模式 → 编辑</span>';
        if (viewerObj) { try { viewerObj.destroy(); } catch {} viewerObj = null; }
        if (!editing) viewerObj = new window.Viewer(editorEl, { navbar: false, title: false, toolbar: true });
        api.saveState({ mode: editing ? 'edit' : 'read' });
        pushState();
      }
      modeBtn.addEventListener('click', () => setMode(!editing));
      setMode(editing ? 'edit' : 'read');
      root.querySelector('.page-immersive').addEventListener('click', () => setImmersive(!immersive));

      // ---------- 工具栏 ----------
      const CMD = {
        bold: (c) => c.toggleBold().run(), italic: (c) => c.toggleItalic().run(),
        strike: (c) => c.toggleStrike().run(), code: (c) => c.toggleCode().run(),
        h1: (c) => c.toggleHeading({ level: 1 }).run(), h2: (c) => c.toggleHeading({ level: 2 }).run(),
        h3: (c) => c.toggleHeading({ level: 3 }).run(),
        bullet: (c) => c.toggleBulletList().run(), order: (c) => c.toggleOrderedList().run(),
        quote: (c) => c.toggleBlockquote().run(), codeblock: (c) => c.toggleCodeBlock().run(),
        hr: (c) => c.setHorizontalRule().run(), undo: (c) => c.undo().run(), redo: (c) => c.redo().run(),
      };
      root.querySelector('.page-toolbar').addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
      root.querySelector('.page-toolbar').addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-cmd]');
        if (!btn) return;
        const cmd = btn.dataset.cmd;
        const chain = editor.chain().focus();
        if (CMD[cmd]) CMD[cmd](chain);
        else if (cmd === 'save') return save();
        else if (cmd === 'image' || cmd === 'video' || cmd === 'audio') {
          const r = await window.urAPI.pagePickMedia({ kind: cmd, pagePath });
          if (!r || !r.ok) return;
          const attrMap = { image: 'pageImage', video: 'pageVideo', audio: 'pageAudio' };
          const attrs = r.rel ? { src: r.rel } : { src: r.dataUrl };
          editor.chain().focus().insertContentAt(editor.state.doc.content.size, { type: attrMap[cmd], attrs }).run();
          return;
        } else if (cmd === 'interactive') {
          editor.chain().focus().insertContentAt(editor.state.doc.content.size, { type: 'interactive', attrs: { html: DEFAULT_INTERACTIVE, height: 320 } }).run();
          return;
        } else return;
        refreshToolbar();
      });
      function refreshToolbar() {
        const map = {
          bold: ['bold'], italic: ['italic'], strike: ['strike'], code: ['code'],
          bullet: ['bulletList'], order: ['orderedList'], quote: ['blockquote'], codeblock: ['codeBlock'],
          h1: ['heading', { level: 1 }], h2: ['heading', { level: 2 }], h3: ['heading', { level: 3 }],
        };
        root.querySelectorAll('.page-toolbar button[data-cmd]').forEach((btn) => {
          const m = map[btn.dataset.cmd];
          let active = false;
          if (m) { try { active = editor.isActive(m[0], m[1]); } catch {} }
          btn.classList.toggle('active', !!active);
        });
      }
      editor.on('transaction', refreshToolbar);

      // ---------- 源码面板 ----------
      function openSourcePanel(initial, onApply) {
        srcApplyFn = onApply;
        srcText.value = initial;
        sourcePanel.style.display = 'flex';
        srcText.focus();
      }
      sourcePanel.querySelector('.ur-source-apply').addEventListener('click', () => {
        if (srcApplyFn) srcApplyFn(srcText.value);
        sourcePanel.style.display = 'none';
        srcApplyFn = null;
      });
      sourcePanel.querySelector('.ur-source-cancel').addEventListener('click', () => {
        sourcePanel.style.display = 'none';
        srcApplyFn = null;
      });

      function pushState() {
        window.urAPI.sendTabState({
          contentId: tabId,
          title: titleInput.value.trim() || page.title || '页面',
          path: pagePath,
          kind: payload.kind,
          state: {
            mode: editing ? 'edit' : 'read',
            blocks: editor ? editor.state.doc.childCount : 0,
            dirty,
            media: mediaState(),
            path: pagePath,
            error: null,
          },
        });
      }

      // ---------- 就绪 ----------
      setTimeout(() => {
        dirty = false;
        dirtyEl.style.display = 'none';
        pushState();
        api.ready({ state: { mode: editing ? 'edit' : 'read', blocks: editor.state.doc.childCount } });
      }, 60);

      return {
        applyControl(action, value) {
          switch (action) {
            case 'set_edit_mode': {
              if (!['edit', 'read', 'toggle'].includes(value)) return { ok: false, error: { code: 'INVALID_PARAM', message: "set_edit_mode 需要 'edit'|'read'|'toggle'" } };
              setMode(value === 'toggle' ? !editing : value);
              return { ok: true, state: this.getState() };
            }
            case 'immersive': {
              setImmersive(value === undefined ? !immersive : !!value && value !== 'off');
              return { ok: true, state: this.getState() };
            }
            case 'save': save(); return { ok: true, state: this.getState() };
            case 'play': case 'pause': case 'toggle_play': case 'seek': case 'set_volume': {
              const handled = mediaControl(action, value);
              return handled
                ? { ok: true, state: this.getState() }
                : { ok: false, error: { code: 'NO_MEDIA', message: '页面中没有可控制的媒体（或媒体尚未加载完成）' } };
            }
            case 'goto_page': {
              const n = Math.max(1, parseInt(value, 10) || 1);
              const blocks = editorEl.querySelectorAll('.urpage-prosemirror > *');
              if (n > blocks.length) return { ok: false, error: { code: 'OUT_OF_RANGE', message: `块序号超出范围（共 ${blocks.length} 块）` } };
              blocks[n - 1].scrollIntoView({ block: 'start', behavior: 'smooth' });
              return { ok: true, state: this.getState() };
            }
            case 'scroll': {
              const dir = value && value.direction === 'up' ? -1 : 1;
              container.scrollBy({ top: dir * (typeof (value && value.amount) === 'number' ? value.amount : 360) });
              return { ok: true };
            }
            default:
              return { ok: false, error: { code: 'NOT_SUPPORTED', message: `page 渲染器不支持 ${action}` } };
          }
        },
        getState() {
          return {
            mode: editing ? 'edit' : 'read',
            blocks: editor.state.doc.childCount,
            dirty,
            media: mediaState(),
            path: pagePath,
          };
        },
        onKey(e) {
          if (e.ctrlKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(); }
          else if (e.ctrlKey && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); setMode(!editing); }
          else if (e.key === 'Escape' && immersive) setImmersive(false);
        },
        updateBlock(params) {
          const r = updateBlock(params);
          if (r.ok) { r.state = this.getState(); pushState(); }
          return r;
        },
        getSelection: () => ({ ok: true, format: 'page', selection: getSelectionInfo() }),
        exportHtml: buildExportHtml,
        getTree() {
          const items = [];
          let idx = 0;
          editor.state.doc.forEach((child) => { idx++; if (child.type.name === 'heading') items.push({ lvl: Number(child.attrs.level), text: child.textContent.trim().slice(0, 50) || '(空)', i: idx }); });
          const root = { label: '页面', icon: 'book', children: [] };
          const stack = [root];
          for (const it of items) {
            const node = { label: it.text, icon: 'file', nav: { kind: 'page', i: it.i } };
            while (stack.length > 1 && stack[stack.length - 1].lvl >= it.lvl) stack.pop();
            (stack[stack.length - 1].children || (stack[stack.length - 1].children = [])).push(node);
            stack.push({ ...node, lvl: it.lvl, children: [] });
          }
          return { title: titleInput.value.trim() || payload.title, root };
        },
        navigate(nav) {
          if (nav && nav.kind === 'page') {
            const blocks = editorEl.querySelectorAll('.urpage-prosemirror > *');
            if (blocks[nav.i - 1]) blocks[nav.i - 1].scrollIntoView({ block: 'start', behavior: 'smooth' });
            return { ok: true };
          }
          return { ok: false };
        },
        getPanels() {
          const self = this;
          return [
            {
              id: 'outline', icon: 'tree', title: '结构树',
              build(el) {
                const items = [];
                let idx = 0;
                editor.state.doc.forEach((child) => {
                  idx++;
                  if (child.type.name === 'heading') {
                    items.push({ lvl: Number(child.attrs.level), text: child.textContent.trim().slice(0, 50) || '(空)', i: idx });
                  }
                });
                if (!items.length) { el.innerHTML = '<div class="sb-empty">页面中没有标题</div>'; return; }
                const root = { label: '页面', icon: 'book', children: [], onClick: () => container.scrollTo({ top: 0 }) };
                const stack = [root];
                for (const it of items) {
                  const node = {
                    label: it.text, icon: 'file', lvl: it.lvl,
                    onClick: () => {
                      const blocks = editorEl.querySelectorAll('.urpage-prosemirror > *');
                      if (blocks[it.i - 1]) blocks[it.i - 1].scrollIntoView({ block: 'start', behavior: 'smooth' });
                    },
                  };
                  while (stack.length > 1 && stack[stack.length - 1].lvl >= it.lvl) stack.pop();
                  (stack[stack.length - 1].children || (stack[stack.length - 1].children = [])).push(node);
                  stack.push(node);
                }
                window.urTree(el, [root]);
              },
            },
            {
              id: 'look', icon: 'eye', title: '外观',
              build(el) {
                el.innerHTML = '<div class="panel-group">字号</div><div class="panel-btns"><button data-d="1">A＋</button><button data-d="-1">A−</button></div>';
                el.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => {
                  const pm = document.querySelector('.urpage-prosemirror');
                  const cur = parseInt(window.getComputedStyle(pm).fontSize, 10) || 16;
                  pm.style.fontSize = Math.max(12, Math.min(28, cur + Number(b.dataset.d))) + 'px';
                }));
              },
            },
          ];
        },
        capabilities: ['edit', 'media', 'goto_page', 'save', 'set_edit_mode', 'update_block', 'get_selection', 'export', 'immersive', 'pip'],
        destroy() {
          destroyed = true;
          if (viewerObj) { try { viewerObj.destroy(); } catch {} }
          try { editor.destroy(); } catch {}
        },
      };
    },
  };
})();
