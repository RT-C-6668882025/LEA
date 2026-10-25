'use strict';
/* 电子书渲染器（EPUB）：JSZip 解压 → OPF/NCX 解析 → 章节沙箱 iframe 渲染。
   进度 = 章节序号；侧边栏：目录 / 外观（字号）。图片内联为 data URI。 */
(function () {
  window.URRenderers = window.URRenderers || {};
  const b64ToBuf = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  const extMime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

  window.URRenderers.epub = {
    mount(container, payload, api) {
      const ui = api.uiState || {};
      const st = { chapter: Number(ui.chapter) || 1, chapters: 0, fontSize: Number(ui.fontSize) || 17, toc: [] };
      const root = document.createElement('div');
      root.className = 'epub-host';
      root.style.cssText = 'position:absolute;inset:0;overflow:hidden;display:flex;flex-direction:column;';
      const frame = document.createElement('iframe');
      frame.className = 'epub-frame';
      frame.setAttribute('sandbox', 'allow-scripts');
      const foot = document.createElement('div');
      foot.className = 'epub-foot';
      foot.innerHTML = `<button data-a="prev">上一章</button><span class="epub-pos">…</span><button data-a="next">下一章</button>`;
      root.append(frame, foot);
      container.style.overflow = 'hidden';
      container.appendChild(root);

      let doc_ = null; // {zip, chapters:[{href,title}], opfDir}

      const zipPath = (base, href) => {
        const parts = (base ? base.split('/') : []);
        for (const seg of href.split('/')) {
          if (seg === '.' || seg === '') continue;
          if (seg === '..') parts.pop(); else parts.push(seg);
        }
        return parts.join('/');
      };
      const dataUri = async (zip, p) => {
        const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
        const buf = await zip.file(p).async('arraybuffer');
        let bin = ''; const u = new Uint8Array(buf);
        for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
        return 'data:' + (extMime[ext] || 'application/octet-stream') + ';base64,' + btoa(bin);
      };

      async function buildChapter(i) {
        const { zip, chapters, opfDir } = doc_;
        const ch = chapters[i - 1];
        const xml = await zip.file(ch.zipPath).async('string');
        const doc = new DOMParser().parseFromString(xml, 'text/html');
        // 收集章节内样式
        let css = 'body{font-family:Georgia,"Microsoft YaHei",serif;line-height:1.9;padding:32px 8%;max-width:820px;margin:0 auto;color:#292524;min-height:100%}img{max-width:100%;border-radius:4px}a{color:#b45309}';
        for (const link of [...doc.querySelectorAll('link[rel="stylesheet"]')]) {
          const href = link.getAttribute('href') || '';
          const f = zip.file(zipPath(opfDir, href));
          if (f) css += '\n' + (await f.async('string'));
        }
        for (const st of [...doc.querySelectorAll('style')]) css += '\n' + st.textContent;
        // 图片 → data URI
        const jobs = [];
        for (const img of [...doc.querySelectorAll('img')]) {
          const src = img.getAttribute('src') || (img.getAttribute('xlink:href') || '');
          if (!src || /^(data:|https?:)/i.test(src)) continue;
          const p = zipPath(opfDir, src.startsWith('/') ? src.slice(1) : ch.href.slice(0, ch.href.lastIndexOf('/') + 1) + src);
          if (zip.file(p)) jobs.push(img, p);
        }
        for (let k = 0; k < jobs.length; k += 2) {
          try { jobs[k].setAttribute('src', await dataUri(zip, jobs[k + 1])); } catch {}
        }
        for (const img of [...doc.querySelectorAll('image')]) {
          const href = img.getAttribute('xlink:href') || img.getAttribute('href') || '';
          const p = zipPath(opfDir, href);
          if (zip.file(p)) { try { img.setAttribute('href', await dataUri(zip, p)); } catch {} }
        }
        const body = doc.body ? doc.body.innerHTML : xml;
        // srcdoc 继承父 CSP：需放行内联样式与 ur-lib 外链运行时脚本
        const chapterCsp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' ur-lib:; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\';">';
        const runtime = '<script src="ur-lib://local/epub-runtime.js"></script>';
        return '<!DOCTYPE html><html><head><meta charset="utf-8">' + chapterCsp + '<style>' + css +
          `\nhtml{font-size:${st.fontSize}px}</style>${runtime}</head><body>${body}</body></html>`;
      }

      async function showChapter(i, push) {
        if (!doc_) return;
        i = Math.max(1, Math.min(doc_.chapters.length, i));
        st.chapter = i;
        const ch = doc_.chapters[i - 1];
        frame.srcdoc = await buildChapter(i);
        foot.querySelector('.epub-pos').textContent = `${i} / ${doc_.chapters.length}${ch.title ? ' · ' + ch.title : ''}`;
        if (push) { api.saveState({ chapter: i, fontSize: st.fontSize }); pushState(); }
      }

      (async () => {
        try {
          const r = await window.urAPI.fileReadB64(payload.path);
          const zip = await window.JSZip.loadAsync(b64ToBuf(r.data));
          const containerXml = await zip.file('META-INF/container.xml').async('string');
          const opfPath = /full-path="([^"]+)"/i.exec(containerXml)[1];
          const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
          const opf = new DOMParser().parseFromString(await zip.file(opfPath).async('string'), 'application/xml');
          const items = {};
          for (const it of [...opf.querySelectorAll('manifest > item')]) {
            items[it.getAttribute('id')] = { href: it.getAttribute('href'), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' };
          }
          const spineEl = opf.querySelector('spine');
          const spineIds = [...spineEl.querySelectorAll('itemref')].map((ir) => ir.getAttribute('idref'));
          const ncxId = spineEl.getAttribute('toc');
          const ncxItem = items[ncxId] || Object.values(items).find((it) => it.type === 'application/x-dtbncx+xml');
          const chapters = spineIds.filter((id) => items[id]).map((id) => ({ id, href: items[id].href, zipPath: zipPath(opfDir, items[id].href), title: '' }));
          // 目录标题：NCX navMap
          if (ncxItem) {
            try {
              const ncxPath = zipPath(opfDir, ncxItem.href);
              const ncx = new DOMParser().parseFromString(await zip.file(ncxPath).async('string'), 'application/xml');
              for (const np of [...ncx.querySelectorAll('navPoint')]) {
                const label = np.querySelector('navLabel > text');
                const src = np.querySelector('content');
                if (!label || !src) continue;
                const srcPath = zipPath(ncxPath.includes('/') ? ncxPath.slice(0, ncxPath.lastIndexOf('/')) : '', src.getAttribute('src').split('#')[0]);
                const ch = chapters.find((c) => c.zipPath === srcPath);
                if (ch && !ch.title) ch.title = label.textContent.trim().slice(0, 60);
              }
            } catch {}
          }
          if (!chapters.length) { api.fail('EPUB 中没有可渲染的章节（spine 为空）'); return; }
          doc_ = { zip, chapters, opfDir };
          st.chapters = chapters.length;
          st.toc = chapters.map((c, i) => ({ i: i + 1, title: c.title || '第 ' + (i + 1) + ' 章' }));
          foot.querySelector('.epub-pos').textContent = `1 / ${st.chapters}`;
          pushState();
          api.ready({ state: { chapter: st.chapter, chapters: st.chapters } });
          showChapter(st.chapter, false);
        } catch (e) {
          api.fail('EPUB 解析失败: ' + (e && e.message));
        }
      })();

      foot.addEventListener('click', (e) => {
        const a = e.target && e.target.dataset && e.target.dataset.a;
        if (a === 'prev') showChapter(st.chapter - 1, true);
        if (a === 'next') showChapter(st.chapter + 1, true);
      });

      function pushState() {
        window.urAPI.sendTabState({
          contentId: payload.contentId, title: payload.title, path: payload.path, kind: payload.kind,
          state: { chapter: st.chapter, chapters: st.chapters, fontSize: st.fontSize, error: null },
        });
      }

      const buildToc = (el) => {
        window.urTree(el, [{
          label: '目录',
          icon: 'book',
          count: st.toc.length,
          children: st.toc.map((c) => ({
            label: c.title,
            icon: 'file',
            active: c.i === st.chapter,
            onClick: () => { showChapter(c.i, true); },
          })),
        }]);
      };
      const buildFont = (el) => {
        el.innerHTML = '<div class="panel-group">字号</div><div class="panel-btns"><button data-d="-1">A−</button><button data-d="1">A＋</button></div>';
        el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
          st.fontSize = Math.max(12, Math.min(28, st.fontSize + Number(b.dataset.d) * 1));
          showChapter(st.chapter, true);
        }));
      };

      return {
        applyControl(action, value) {
          if (!doc_) return { ok: false, error: { code: 'NOT_READY', message: 'EPUB 尚未解析完成' } };
          switch (action) {
            case 'goto_page': showChapter(parseInt(value, 10) || 1, true); return { ok: true, state: this.getState() };
            case 'next_page': return this.applyControl('goto_page', st.chapter + 1);
            case 'prev_page': return this.applyControl('goto_page', st.chapter - 1);
            case 'scroll': return { ok: true };
            case 'set_font_size': {
              const n = parseInt(value, 10);
              if (!(n >= 12 && n <= 28)) return { ok: false, error: { code: 'INVALID_PARAM', message: '字号需为 12~28' } };
              st.fontSize = n; showChapter(st.chapter, true);
              return { ok: true, state: this.getState() };
            }
            default: return { ok: false, error: { code: 'NOT_SUPPORTED', message: `epub 渲染器不支持 ${action}` } };
          }
        },
        getState() { return { chapter: st.chapter, chapters: st.chapters, fontSize: st.fontSize }; },
        getTree() {
          if (!doc_) return { title: payload.title, root: { label: '解析中…', icon: 'book', children: [] } };
          return { title: payload.title, root: { label: '目录', icon: 'book', count: st.chapters, children: st.toc.map((c) => ({ label: c.title, icon: 'file', nav: { kind: 'epub', chapter: c.i } })) } };
        },
        navigate(nav) {
          if (nav && nav.kind === 'epub') { showChapter(nav.chapter, true); return { ok: true }; }
          return { ok: false };
        },
        getPanels() {
          if (!doc_) return [];
          return [
            { id: 'toc', icon: 'book', title: '目录', build: buildToc },
            { id: 'font', icon: 'file', title: '外观', build: buildFont },
          ];
        },
        capabilities: ['toc', 'progress', 'font_size'],
        destroy() { frame.srcdoc = ''; },
      };
    },
  };
})();
