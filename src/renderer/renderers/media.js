'use strict';
/* 媒体播放器：HTML5 video/audio；播放/暂停/进度/音量/全屏；进度记忆 */
(function () {
  window.URRenderers = window.URRenderers || {};
  const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.oga', '.m4a', '.flac'];

  window.URRenderers.media = {
    mount(container, payload, api) {
      const isAudio = AUDIO_EXTS.includes('.' + (payload.format || '').toLowerCase());
      const wrap = document.createElement('div');
      wrap.className = 'media-wrap';
      const el = document.createElement(isAudio ? 'audio' : 'video');
      el.controls = true;
      el.preload = 'metadata';
      el.src = window.urFileUrl(payload.path);
      wrap.appendChild(el);
      container.style.overflow = 'hidden';
      container.appendChild(wrap);

      const ui = api.uiState || {};
      const st = { time: 0, duration: 0, paused: true, volume: 1, muted: false, percent: 0 };
      let lastSave = 0;

      el.addEventListener('loadedmetadata', () => {
        st.duration = el.duration || 0;
        const t = Number(ui.time || 0);
        if (t > 1 && st.duration && t < st.duration - 2) el.currentTime = t;
        api.ready({ state: { time: el.currentTime, duration: st.duration } });
      });
      el.addEventListener('timeupdate', () => {
        st.time = el.currentTime;
        st.percent = st.duration ? Math.round((st.time / st.duration) * 10000) / 100 : 0;
        const now = Date.now();
        if (now - lastSave > 2000) {
          lastSave = now;
          api.saveState({ time: st.time, duration: st.duration, percent: st.percent, paused: el.paused });
        }
      });
      el.addEventListener('play', () => { st.paused = false; push(); });
      el.addEventListener('pause', () => { st.paused = true; push(); });
      el.addEventListener('ended', () => { st.paused = true; push(); });
      el.addEventListener('volumechange', () => {
        st.volume = el.volume;
        st.muted = el.muted;
        api.saveState({ volume: el.volume, muted: el.muted });
      });
      el.addEventListener('error', () => {
        const code = el.error ? el.error.code : 0;
        api.fail(`无法解码/播放该媒体（错误码 ${code}）。该容器内的编码可能不受内置播放引擎支持（例如部分 MKV/MOV 编码）。`);
      });

      function push() { api.saveState({ time: st.time, duration: st.duration, percent: st.percent, paused: st.paused }); }

      function seek(v) {
        if (!st.duration) return { ok: false, error: { code: 'NOT_READY', message: '媒体尚未加载完成' } };
        if (v && typeof v.to === 'number') el.currentTime = Math.max(0, Math.min(st.duration - 0.05, v.to));
        else if (v && typeof v.percent === 'number') el.currentTime = Math.max(0, Math.min(1, v.percent / 100)) * st.duration;
        else if (v && typeof v.offset === 'number') el.currentTime = Math.max(0, Math.min(st.duration - 0.05, el.currentTime + v.offset));
        else return { ok: false, error: { code: 'INVALID_PARAM', message: 'seek 需要 {to}|{percent}|{offset}' } };
        return { ok: true, state: this.getState() };
      }

      function fullscreen(v) {
        const mode = v || 'toggle';
        const on = mode === 'toggle' ? !document.fullscreenElement : mode === 'on';
        if (on) wrap.requestFullscreen().catch(() => {});
        else if (document.fullscreenElement) document.exitFullscreen();
        return { ok: true };
      }

      return {
        applyControl(action, value) {
          switch (action) {
            case 'play': el.play().catch((e) => console.error('play 失败:', e && e.name, e && e.message)); return { ok: true, state: this.getState() };
            case 'pause': el.pause(); return { ok: true, state: this.getState() };
            case 'toggle_play': if (el.paused) el.play().catch((e) => console.error('play 失败:', e && e.name, e && e.message)); else el.pause(); return { ok: true, state: this.getState() };
            case 'seek': return seek.call(this, value);
            case 'set_volume': {
              const n = Number(value);
              if (Number.isNaN(n)) return { ok: false, error: { code: 'INVALID_PARAM', message: 'set_volume 需要 0~1 数字' } };
              el.volume = Math.max(0, Math.min(1, n));
              return { ok: true, state: this.getState() };
            }
            case 'fullscreen': return fullscreen(value);
            case 'pip': {
              try {
                if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(() => {}); return { ok: true, state: this.getState() }; }
                el.requestPictureInPicture().catch(() => {});
                return { ok: true, state: this.getState() };
              } catch (e) {
                return { ok: false, error: { code: 'PIP_FAILED', message: '画中画不可用: ' + e.message } };
              }
            }
            default:
              return { ok: false, error: { code: 'NOT_SUPPORTED', message: `media 渲染器不支持 ${action}` } };
          }
        },
        getState() {
          const t = el.currentTime || 0;
          const d = st.duration || el.duration || 0;
          return {
            time: Math.round(t * 10) / 10,
            duration: Math.round(d * 10) / 10,
            percent: d ? Math.round((t / d) * 10000) / 100 : 0,
            paused: el.paused,
            volume: el.volume,
            muted: el.muted,
          };
        },
        onKey(e) {
          if (e.code === 'Space') { this.applyControl('toggle_play'); e.preventDefault(); }
          else if (e.key === 'ArrowLeft') this.applyControl('seek', { offset: -5 });
          else if (e.key === 'ArrowRight') this.applyControl('seek', { offset: 5 });
          else if (e.key === 'ArrowUp') this.applyControl('set_volume', Math.min(1, el.volume + 0.1));
          else if (e.key === 'ArrowDown') this.applyControl('set_volume', Math.max(0, el.volume - 0.1));
          else return;
          e.preventDefault();
        },
        getPanels() {
          return [{
            id: 'ctrl', icon: 'play', title: '播放',
            build(panelEl) {
              panelEl.innerHTML = '<div class="panel-btns"><button data-a="toggle">播放/暂停</button><button data-a="back">−10s</button><button data-a="fwd">+10s</button></div><div class="panel-group">音量</div><div class="panel-btns"><button data-v="0.2">20%</button><button data-v="0.6">60%</button><button data-v="1">100%</button></div><div class="panel-kv"><b>进度</b><span id="ur-pos">…</span></div>';
              const pos = panelEl.querySelector('#ur-pos');
              const media = el; // 闭包里的媒体元素（mount 时创建的 video/audio）
              const tick = () => { if (pos && document.contains(pos)) pos.textContent = (media.currentTime || 0).toFixed(1) + 's / ' + (media.duration || 0).toFixed(1) + 's'; };
              tick();
              panelEl.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
                if (b.dataset.a === 'toggle') { media.paused ? media.play().catch(() => {}) : media.pause(); }
                else if (b.dataset.a === 'back') media.currentTime = Math.max(0, media.currentTime - 10);
                else media.currentTime = Math.min(media.duration || 0, media.currentTime + 10);
                tick();
              }));
              panelEl.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { media.volume = Number(b.dataset.v); }));
              const iv = setInterval(() => { if (!document.contains(pos)) { clearInterval(iv); return; } tick(); }, 500);
            },
          }];
        },
        capabilities: ['play', 'pause', 'seek', 'volume', 'fullscreen', 'pip'],
        destroy() {
          try { el.pause(); el.removeAttribute('src'); el.load(); } catch {}
        },
      };
    },
  };
})();
