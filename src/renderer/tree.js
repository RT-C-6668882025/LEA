'use strict';
/* 公共树状图组件（archify Tree 风格）：缩进层级 + 连接线 + 折叠 + 点击跳转
   用法：window.urTree(container, nodes)
   nodes: [{ label, icon?, active?, onClick?, children: [...], count? }] */
(function () {
  function renderNode(parent, node, depth) {
    if (depth > 12) return;
    const wrap = document.createElement('div');
    wrap.className = 'ur-tree-node';

    const row = document.createElement('div');
    row.className = 'ur-tree-row' + (node.active ? ' active' : '');
    row.title = node.label;

    const toggle = document.createElement('span');
    const hasKids = node.children && node.children.length;
    toggle.className = 'ur-tree-toggle' + (hasKids ? ' open' : ' leaf');
    if (hasKids) toggle.innerHTML = window.urIcon('chevron', 11);

    const icon = document.createElement('span');
    icon.className = 'ur-tree-icon';
    icon.innerHTML = window.urIcon(node.icon || 'file', 13);

    const label = document.createElement('span');
    label.className = 'ur-tree-label';
    label.textContent = node.label;

    row.append(toggle, icon, label);
    if (node.count != null) {
      const c = document.createElement('span');
      c.className = 'ur-tree-count';
      c.textContent = node.count;
      row.appendChild(c);
    }
    if (node.onClick) row.addEventListener('click', (e) => { if (!e.target.closest('.ur-tree-toggle')) node.onClick(); });
    wrap.appendChild(row);

    if (hasKids) {
      const kids = document.createElement('div');
      kids.className = 'ur-tree-children';
      for (const k of node.children) renderNode(kids, k, depth + 1);
      wrap.appendChild(kids);
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        kids.classList.toggle('collapsed');
        toggle.classList.toggle('open');
      });
    }
    parent.appendChild(wrap);
  }

  window.urTree = function (container, nodes) {
    container.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'ur-tree';
    for (const n of (nodes || [])) renderNode(root, n, 0);
    container.appendChild(root);
    return root;
  };
})();
