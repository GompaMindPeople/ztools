'use strict';
// ZTools 渲染进程:搜索交互、结果列表、插件视图切换、子输入转发
(() => {
  const H = window.ztoolsHost;
  const $ = (s) => document.querySelector(s);
  const queryInput = $('#query');
  const subBar = $('#subbar');
  const subInput = $('#subInput');
  const resultsEl = $('#results');
  const emptyEl = $('#empty');
  const webview = $('#pluginView');
  const toastEl = $('#toast');
  const indexStatus = $('#indexStatus');
  const footerHint = $('#footerHint');
  const DEFAULT_FOOTER = footerHint.innerHTML;

  webview.setAttribute('preload', H.pluginPreloadUrl);

  const state = {
    q: '',
    data: null,
    flat: [],
    sel: 0,
    mode: 'search',       // search | plugin
    icons: new Map(),
    debounce: 0,
    toastTimer: 0
  };
  let blankTimer = 0; // 退出插件后延迟释放 webview 的定时器

  // ---------------- 搜索 ----------------

  queryInput.addEventListener('input', () => {
    state.q = queryInput.value;
    clearTimeout(state.debounce);
    state.debounce = setTimeout(doSearch, 90);
  });

  async function doSearch() {
    if (state.mode !== 'search') return;
    state.data = await H.invoke('search', state.q);
    render();
  }

  function flatten(data) {
    const groups = [];
    if (data.math) groups.push({ name: '计算', items: [data.math] });
    if (data.recents && data.recents.length) groups.push({ name: '最近使用', items: data.recents });
    if (data.apps && data.apps.length) groups.push({ name: '应用', items: data.apps });
    if (data.plugins && data.plugins.length) groups.push({ name: '插件', items: data.plugins });
    if (data.files && data.files.length) groups.push({ name: '文件', items: data.files });
    if (data.web) groups.push({ name: '网页', items: [data.web] });
    const flat = [];
    groups.forEach((g) => g.items.forEach((it) => flat.push(it)));
    return { groups, flat };
  }

  function render() {
    const data = state.data;
    if (!data) return;
    if (data.empty && !(data.recents && data.recents.length)) {
      renderEmpty();
      return;
    }
    if (data.empty) {
      renderEmpty();
      return;
    }
    emptyEl.style.display = 'none';
    resultsEl.style.display = '';
    const { groups, flat } = flatten(data);
    state.flat = flat;
    if (state.sel >= flat.length) state.sel = Math.max(0, flat.length - 1);
    const frag = document.createDocumentFragment();
    let i = 0;
    for (const g of groups) {
      const h = document.createElement('div');
      h.className = 'group-h';
      h.textContent = g.name;
      frag.appendChild(h);
      for (const item of g.items) frag.appendChild(renderRow(item, i++));
    }
    if (!flat.length) {
      const n = document.createElement('div');
      n.className = 'no-result';
      n.textContent = '没有匹配的结果';
      frag.appendChild(n);
    }
    resultsEl.innerHTML = '';
    resultsEl.appendChild(frag);
    updateSel();
    loadIcons();
  }

  function fallbackChar(item) {
    if (item.kind === 'math') return '🧮';
    if (item.kind === 'web') return '🔍';
    if (item.kind === 'file') return item.isDir ? '📁' : '📄';
    return (item.title || '?').trim().charAt(0).toUpperCase() || '?';
  }

  function renderRow(item, i) {
    const row = document.createElement('div');
    row.className = 'row' + (item.kind === 'math' ? ' math' : '');
    row.dataset.i = i;

    const ic = document.createElement('div');
    ic.className = 'ic';
    const fb = document.createElement('span');
    fb.className = 'fb';
    fb.textContent = item.iconEmoji || fallbackChar(item);
    ic.appendChild(fb);
    if ((item.kind === 'app' || item.kind === 'file') && item.iconPath) {
      const img = document.createElement('img');
      img.alt = '';
      img.dataset.p = item.iconPath;
      ic.appendChild(img);
    }

    const tx = document.createElement('div');
    tx.className = 'tx';
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = item.title || '';
    const s = document.createElement('div');
    s.className = 's';
    s.textContent = item.sub || '';
    tx.append(t, s);

    row.append(ic, tx);
    row.addEventListener('click', () => execute(item));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); execute(item, { reveal: true }); });
    return row;
  }

  function updateSel() {
    resultsEl.querySelectorAll('.row').forEach((r) => {
      const i = Number(r.dataset.i);
      r.classList.toggle('sel', i === state.sel);
      if (i === state.sel) r.scrollIntoView({ block: 'nearest' });
    });
  }

  async function loadIcons() {
    const imgs = [...document.querySelectorAll('img[data-p]')].slice(0, 16);
    await Promise.all(imgs.map(async (img) => {
      const p = img.dataset.p;
      if (!p || img.src) return;
      // 失败(null)不缓存:每次渲染自动重试,避免一次偶发失败导致整个会话无图标
      let url = state.icons.get(p);
      if (!url) {
        try {
          url = await H.invoke('get-icon', p);
        } catch (e) {
          console.error('[icons] get-icon 调用失败:', e.message);
          url = null;
        }
        if (url) state.icons.set(p, url);
      }
      if (url) {
        img.src = url;
        img.parentElement.classList.add('has-img');
      }
    }));
  }

  // ---------------- 空状态 ----------------

  function renderEmpty() {
    resultsEl.style.display = 'none';
    emptyEl.style.display = '';
    const data = state.data || {};

    const recentWrap = $('#recentWrap');
    const recentList = $('#recentList');
    recentList.innerHTML = '';
    if (data.recents && data.recents.length) {
      recentWrap.style.display = '';
      data.recents.forEach((item, idx) => recentList.appendChild(renderRow(item, idx)));
    } else {
      recentWrap.style.display = 'none';
    }

    const chips = $('#chips');
    chips.innerHTML = '';
    (data.plugins || []).forEach((c) => {
      const b = document.createElement('button');
      b.className = 'chip';
      const ce = document.createElement('span'); ce.className = 'ce'; ce.textContent = c.iconEmoji || '🧩';
      const cw = document.createElement('span'); cw.className = 'cw'; cw.textContent = c.word ? `${c.word} · ${c.title.split(' · ')[0]}` : c.title;
      const cd = document.createElement('span'); cd.className = 'cd'; cd.textContent = c.sub || '';
      b.append(ce, cw, cd);
      b.addEventListener('click', () => {
        queryInput.value = c.word ? c.word + ' ' : '';
        queryInput.focus();
        state.q = queryInput.value;
        doSearch();
      });
      chips.appendChild(b);
    });
    loadIcons();
  }

  // ---------------- 执行 ----------------

  async function execute(item, opts = {}) {
    if (!item) return;
    if (item.kind === 'plugin') { openPlugin(item); return; }
    if (item.kind === 'math') {
      await H.invoke('copy-text', item.value);
      toast(`已复制 ${item.title}`);
      setTimeout(() => H.invoke('hide-window'), 350);
      return;
    }
    await H.invoke('execute', item, opts);
    H.invoke('record-recent', item);
  }

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1400);
  }

  function autocomplete() {
    const it = state.flat[0];
    if (!it) return;
    let v = '';
    if (it.kind === 'app') v = it.title;
    else if (it.kind === 'plugin' && it.plugin && it.plugin.word) v = it.plugin.word + ' ';
    else if (it.kind === 'file') v = it.title;
    if (v && v !== state.q) {
      queryInput.value = v;
      state.q = v;
      doSearch();
    }
  }

  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!state.flat.length) return;
      state.sel = (state.sel + (e.key === 'ArrowDown' ? 1 : -1) + state.flat.length) % state.flat.length;
      updateSel();
      e.preventDefault();
    } else if (e.key === 'Enter') {
      execute(state.flat[state.sel], { reveal: e.ctrlKey || e.metaKey });
      e.preventDefault();
    } else if (e.key === 'Tab') {
      autocomplete();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      if (state.q) { queryInput.value = ''; state.q = ''; doSearch(); }
      else H.invoke('hide-window');
      e.preventDefault();
    } else if (e.key === 'F12') {
      H.invoke('devtools');
      e.preventDefault();
    }
  });

  $('#closeBtn').addEventListener('click', () => H.invoke('hide-window'));

  // ---------------- Z 图标管理菜单 / 面板置顶 / 右键菜单 ----------------

  const zMenu = $('#zMenu');
  const pinBadge = $('#pinBadge');
  const zPin = $('#zPin');

  function applyPinState(pinned) {
    pinBadge.classList.toggle('hidden', !pinned);
    zPin.textContent = pinned ? '📌 取消置顶' : '📌 置顶面板';
  }

  $('#logo').addEventListener('click', (e) => {
    e.stopPropagation();
    zMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!zMenu.classList.contains('hidden') && !zMenu.contains(e.target)) {
      zMenu.classList.add('hidden');
    }
  });
  zMenu.querySelectorAll('.z-item[data-plugin]').forEach((item) => {
    item.addEventListener('click', () => {
      zMenu.classList.add('hidden');
      const id = item.dataset.plugin;
      H.invoke('find-plugin', id).then((p) => { if (p) openPlugin(p); });
    });
  });
  zPin.addEventListener('click', () => {
    zMenu.classList.add('hidden');
    H.invoke('panel-pin', zPin.textContent.includes('取消'));
  });

  // 面板空白处右键 → 置顶菜单(结果行上的右键仍用于"打开所在位置")
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.row') || e.target.closest('webview') || e.target.closest('input')) return;
    e.preventDefault();
    H.send('context-menu');
  });

  // ---------------- 插件模式 ----------------

  function openPlugin(item) {
    clearTimeout(blankTimer);
    state.mode = 'plugin';
    document.body.classList.add('plugin-mode');
    hideSubInput();
    resultsEl.innerHTML = '';
    resultsEl.style.display = 'none';
    emptyEl.style.display = 'none';
    webview.style.display = 'flex';
    const q = encodeURIComponent((item.plugin && item.plugin.rest) || '');
    const url = (item.plugin && item.plugin.mainUrl) + '?query=' + q;
    // 幂等:同一插件+参数不重复导航,避免打断加载中的页面(ERR_ABORTED)
    if (webview.getAttribute('src') !== url) {
      webview.src = url;
      webview.addEventListener('dom-ready', () => webview.focus(), { once: true });
    } else {
      webview.focus();
    }
    footerHint.innerHTML = '<kbd>Esc</kbd> 退出插件 · 在子输入框中与插件交互';
    H.invoke('record-recent', item);
  }

  function exitPlugin() {
    if (state.mode !== 'plugin') return;
    state.mode = 'search';
    document.body.classList.remove('plugin-mode');
    webview.style.display = 'none';
    // 延迟释放:立即 about:blank 会打断进行中的导航(ERR_ABORTED),稍后无人再进插件才清理
    clearTimeout(blankTimer);
    blankTimer = setTimeout(() => {
      if (state.mode !== 'plugin') {
        try { webview.src = 'about:blank'; } catch { /* 忽略 */ }
      }
    }, 800);
    hideSubInput();
    footerHint.innerHTML = DEFAULT_FOOTER;
    queryInput.focus();
  }

  function hideSubInput() {
    subBar.classList.add('hidden');
    subInput.value = '';
  }

  // 向插件转发子输入事件(guest 未就绪时静默忽略)
  function sendToPlugin(channel, value) {
    try { webview.send(channel, value); } catch { /* ignore */ }
  }

  H.on('plugin:subinput-opts', (opts) => {
    if (state.mode !== 'plugin') return;
    subBar.classList.remove('hidden');
    subInput.placeholder = (opts && opts.placeholder) || '';
    subInput.value = '';
    subInput.focus();
  });

  H.on('plugin:exit', exitPlugin);

  subInput.addEventListener('input', () => {
    sendToPlugin('ztools:subinput', subInput.value);
  });
  subInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendToPlugin('ztools:subenter');
      e.preventDefault();
    } else if (e.key === 'Escape') {
      exitPlugin();
      e.preventDefault();
    }
    e.stopPropagation();
  });

  // 禁止插件 webview 跳转到远程页面
  webview.addEventListener('will-navigate', (e) => {
    if (!e.url.startsWith('file://')) e.preventDefault();
  });

  // ---------------- 主进程事件 ----------------

  H.on('window:shown', () => {
    if (state.mode === 'plugin') {
      if (!subBar.classList.contains('hidden')) subInput.focus();
      else webview.focus();
    } else {
      queryInput.focus();
    }
  });
  H.on('window:hidden', () => {
    exitPlugin();
    queryInput.value = '';
    state.q = '';
    doSearch();
  });
  H.on('panel:pinned', applyPinState);
  H.on('index:status', ({ building, count }) => {
    indexStatus.textContent = building ? `文件索引中… ${count}` : `文件索引 ${count}`;
  });
  H.on('index:added', ({ added, total }) => {
    exitPlugin();
    if (added && added.length) toast(`已添加 ${added.length} 个索引目录(共选 ${total}),索引重建中`);
    else toast(`所选 ${total} 个路径已在索引中`);
  });
  H.on('open-plugin-by-id', (payload) => {
    Promise.resolve(typeof payload === 'string' ? H.invoke('find-plugin', payload) : payload)
      .then((item) => { if (item) openPlugin(item); });
  });
  // 调试通道:--search=<q> 自动填入搜索词
  H.on('debug:search', (q) => {
    exitPlugin();
    queryInput.value = String(q || '');
    state.q = queryInput.value;
    doSearch();
  });

  // ---------------- 初始化 ----------------

  doSearch();
})();
