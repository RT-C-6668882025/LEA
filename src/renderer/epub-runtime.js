'use strict';
/* EPUB 章节运行时：滚动位置经 window.name 跨重载保留（由 epub.js 注入到章节 srcdoc） */
(function () {
  function s() { try { window.name = 'ur:' + window.scrollY; } catch (e) {} }
  setInterval(s, 700);
  window.addEventListener('load', function () {
    var m = /^ur:(\d+)/.exec(window.name || '');
    if (m) setTimeout(function () { window.scrollTo(0, +m[1]); }, 120);
  });
})();
