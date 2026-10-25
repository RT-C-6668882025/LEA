function tick() { document.getElementById('clock').textContent = new Date().toLocaleTimeString('zh-CN'); }
setInterval(tick, 1000); tick();
setTimeout(function () { document.title = 'COMPOSITE_OK'; }, 600);
