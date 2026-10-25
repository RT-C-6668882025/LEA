'use strict';
/* 幻灯片渲染器（PPTX 基础预览）：JSZip 解压 → 逐页提取文本段落与图片 → 16:9 卡片纵向排布。
   说明：这是内容级预览（文本 + 图片），不还原动画与精确排版。 */
(function () {
  window.URRenderers = window.URRenderers || {};
  const b64ToBuf = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
  const extMime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

  window.URRenderers.pptx = {
    mount(container, payload, api) {
      const wrap = document.createElement('div');
      wrap.className = 'pptx-wrap';
      container.appendChild(wrap);
      const st = { slides: 0 };

      (async () => {
        try {
          const r = await window.urAPI.fileReadB64(payload.path);
          const zip = await window.JSZip.loadAsync(b64ToBuf(r.data));
          const slideFiles = Object.keys(zip.files)
            .filter((n) => /^ppt\/slides\/slide(\d+)\.xml$/i.test(n))
            .sort((a, b) => (parseInt(/(\d+)/.exec(a)[1], 10) - parseInt(/(\d+)/.exec(b)[1], 10)));
          if (!slideFiles.length) { api.fail('PPTX 中没有幻灯片'); return; }
          let firstTitle = '';
          for (const path of slideFiles) {
            const n = parseInt(/(\d+)\.xml$/.exec(path)[1], 10);
            const xml = new DOMParser().parseFromString(await zip.file(path).async('string'), 'application/xml');
            // 关系：rId → 媒体文件
            const rels = {};
            const relsFile = zip.file(`ppt/slides/_rels/slide${n}.xml.rels`);
            if (relsFile) {
              const rx = new DOMParser().parseFromString(await relsFile.async('string'), 'application/xml');
              for (const rel of [...rx.querySelectorAll('Relationship')]) {
                rels[rel.getAttribute('Id')] = rel.getAttribute('Target');
              }
            }
            const card = document.createElement('section');
            card.className = 'pptx-slide';
            card.dataset.slide = n;
            // 文本段落
            for (const p of [...xml.getElementsByTagName('a:p')]) {
              const txt = [...p.getElementsByTagName('a:t')].map((t) => t.textContent).join('').trim();
              if (!txt) continue;
              const el = document.createElement('p');
              el.textContent = txt;
              card.appendChild(el);
            }
            if (!card.children.length) {
              const empty = document.createElement('p');
              empty.className = 'pptx-empty';
              empty.textContent = '（本页无可提取的文本）';
              card.appendChild(empty);
            }
            // 图片
            for (const pic of [...xml.getElementsByTagName('p:pic')]) {
              const blip = pic.querySelector('a\\:blip, blip');
              const rid = blip && (blip.getAttribute('r:embed') || blip.getAttribute('embed'));
              const target = rid && rels[rid];
              if (!target) continue;
              const mediaPath = 'ppt/media/' + target.split('/').pop();
              const f = zip.file(mediaPath);
              if (!f) continue;
              try {
                const ext = mediaPath.slice(mediaPath.lastIndexOf('.')).toLowerCase();
                const buf = await f.async('arraybuffer');
                let bin = ''; const u = new Uint8Array(buf);
                for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
                const img = document.createElement('img');
                img.src = 'data:' + (extMime[ext] || 'image/png') + ';base64,' + btoa(bin);
                card.appendChild(img);
              } catch {}
            }
            const num = document.createElement('div');
            num.className = 'pptx-num';
            num.textContent = `${n} / ${slideFiles.length}`;
            card.appendChild(num);
            wrap.appendChild(card);
            if (n === 1 && card.querySelector('p')) firstTitle = card.querySelector('p').textContent.slice(0, 40);
          }
          st.slides = slideFiles.length;
          pushState();
          api.ready({ state: { slides: st.slides } });
        } catch (e) {
          api.fail('PPTX 解析失败: ' + (e && e.message));
        }
      })();

      function pushState() {
        window.urAPI.sendTabState({
          contentId: payload.contentId, title: payload.title, path: payload.path, kind: payload.kind,
          state: { slides: st.slides, error: null },
        });
      }

      return {
        applyControl(action, value) {
          if (action === 'goto_page') {
            const el = wrap.querySelector(`.pptx-slide[data-slide="${parseInt(value, 10)}"]`);
            if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
            return { ok: true, state: this.getState() };
          }
          return { ok: false, error: { code: 'NOT_SUPPORTED', message: `pptx 渲染器不支持 ${action}` } };
        },
        getState() { return { slides: st.slides }; },
        getTree() {
          if (!st.slides) return { title: payload.title, root: { label: '解析中…', icon: 'film', children: [] } };
          return { title: payload.title, root: { label: '演示文稿（' + st.slides + ' 页）', icon: 'film', count: st.slides, children: Array.from({ length: st.slides }, (_, k) => ({ label: '第 ' + (k + 1) + ' 页', icon: 'file', nav: { kind: 'pptx', slide: k + 1 } })) } };
        },
        navigate(nav) {
          if (nav && nav.kind === 'pptx') { const card = wrap.querySelector('.pptx-slide[data-slide="' + nav.slide + '"]'); if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' }); return { ok: true }; }
          return { ok: false };
        },
        getPanels() {
          if (!st.slides) return [];
          return [{
            id: 'slides', icon: 'tree', title: '结构树',
            build(el) {
              window.urTree(el, [{
                label: '演示文稿（' + st.slides + ' 页）',
                icon: 'film',
                count: st.slides,
                children: Array.from({ length: st.slides }, (_, k) => ({
                  label: '第 ' + (k + 1) + ' 页',
                  icon: 'file',
                  onClick: () => {
                    const card = wrap.querySelector(`.pptx-slide[data-slide="${k + 1}"]`);
                    if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
                  },
                })),
              }]);
            },
          }];
        },
        capabilities: ['slides'],
        destroy() {},
      };
    },
  };
})();
