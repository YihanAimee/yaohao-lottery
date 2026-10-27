/* 访问统计看板 · 纯原生实现（无外部依赖） · 数据不公开，需访问口令 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const API_BASE = 'https://yaohao-stats.pages.dev';
  const KEY_STORE = 'yh_stats_key';
  let days = 14;
  let key = '';
  try { key = sessionStorage.getItem(KEY_STORE) || ''; } catch (e) { key = ''; }

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function apiUrl(path, params) {
    const u = new URL(API_BASE + path);
    if (params) Object.keys(params).forEach(function (k) { u.searchParams.set(k, params[k]); });
    if (key) u.searchParams.set('key', key);
    return u.toString();
  }

  function showLogin(msg) {
    const box = $('loginBox');
    if (box) box.hidden = false;
    const main = $('dashMain');
    if (main) main.hidden = true;
    if (msg) { const e = $('loginErr'); if (e) e.textContent = msg; }
    const inp = $('keyInput');
    if (inp) setTimeout(function () { inp.focus(); }, 30);
  }

  function hideLogin() {
    const box = $('loginBox');
    if (box) box.hidden = true;
    const main = $('dashMain');
    if (main) main.hidden = false;
  }

  async function tryLogin(k) {
    try {
      const res = await fetch(API_BASE + '/api/login?key=' + encodeURIComponent(k), { cache: 'no-store' });
      return res.ok;
    } catch (e) { return false; }
  }

  async function load() {
    let d;
    try {
      const res = await fetch(apiUrl('/api/stats', { days: days }), { cache: 'no-store' });
      if (res.status === 401) { showLogin('需要访问口令才能查看统计数据'); return; }
      d = await res.json();
    } catch (e) {
      $('rangeTxt').textContent = '加载失败：' + e.message;
      return;
    }
    if (!d || !d.ok) { $('rangeTxt').textContent = '加载失败'; return; }
    hideLogin();
    $('rangeTxt').textContent = d.from + ' ~ 今天（北京时间）· 每 30 秒自动刷新';
    renderCards(d.summary);
    renderChart(d.series);
    renderElements(d.topElements);
    renderHeat(d.heat);
    renderSimple('refList', d.topRefs, r => shortRef(r.ref), r => r.n);
    renderSimple('uaList', d.devices, r => r.ua, r => r.n);
    renderRecent(d.recent);
    loadSwaps();
  }

  /* ---------- 车位互换登记原始信息 ---------- */
  let lastSwaps = [];

  function swapStatusText(s) {
    return s === 'active' ? '有效' : s === 'done' ? '已完成' : '已删除';
  }

  async function loadSwaps() {
    const box = $('swapList');
    if (!box) return;
    try {
      const res = await fetch(apiUrl('/api/swap/list', { limit: 300 }), { cache: 'no-store' });
      if (res.status === 401) { box.innerHTML = '<div class="empty">未授权</div>'; return; }
      const d = await res.json();
      if (!d.ok) { box.innerHTML = '<div class="empty">加载失败</div>'; return; }
      lastSwaps = d.list || [];
      renderSwaps(lastSwaps);
    } catch (e) {
      box.innerHTML = '<div class="empty">加载失败：' + esc(e.message) + '</div>';
    }
  }

  function renderSwaps(list) {
    const box = $('swapList');
    if (!list.length) { box.innerHTML = '<div class="empty">暂无登记记录</div>'; return; }
    const statusText = s => s === 'active' ? '<span class="badge" style="color:#21c08b">有效</span>'
      : s === 'done' ? '<span class="badge" style="color:#3d8bff">已完成</span>'
        : '<span class="badge" style="color:#8b97ad">已删除</span>';
    let html = '<table><thead><tr>' +
      '<th>登记日期</th><th>登记时间</th><th>当前车位区域</th><th>意向区域</th>' +
      '<th>联系人工号</th><th>防护码</th><th>备注</th><th>状态</th><th>摇中车位截图</th>' +
      '</tr></thead><tbody>';
    list.forEach(function (r) {
      const shotUrl = apiUrl('/api/swap/shot', { id: r.id });
      html += '<tr>' +
        '<td class="muted">' + esc(r.day) + '</td>' +
        '<td class="muted">' + esc(r.time) + '</td>' +
        '<td><b>' + esc(r.area) + '</b></td>' +
        '<td>' + esc(r.want1) + (r.want2 ? '<br>' + esc(r.want2) : '') + '</td>' +
        '<td><code>' + esc(r.emp) + '</code></td>' +
        '<td><code>' + esc(r.code) + '</code></td>' +
        '<td class="muted swap-note">' + esc(r.note || '-') + '</td>' +
        '<td>' + statusText(r.status) + (r.matched ? ' <span class="badge" style="color:#ffb020">已匹配</span>' : '') + '</td>' +
        '<td>' +
        '<a href="' + esc(shotUrl) + '" target="_blank" rel="noopener">' +
        '<img class="shot-thumb" loading="lazy" src="' + esc(shotUrl) + '" alt="摇中车位截图" /></a></td>' +
        '</tr>';
    });
    box.innerHTML = html + '</tbody></table>';

    // 图片加载失败兜底（截图缺失 / 链接失效）
    Array.prototype.forEach.call(box.querySelectorAll('img.shot-thumb'), function (img) {
      img.addEventListener('error', function () {
        const span = document.createElement('span');
        span.className = 'muted';
        span.textContent = '无图';
        if (img.parentNode) img.parentNode.replaceChild(span, img);
      });
    });
  }

  /* ---------- 导出 CSV ---------- */
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportSwapCsv() {
    if (!lastSwaps.length) { alert('暂无登记记录可导出'); return; }
    const head = ['登记日期', '登记时间', '当前车位区域', '层级', '意向区域1', '意向区域2',
      '联系人工号', '防护码', '备注', '状态', '是否已匹配', '摇中车位截图链接'];
    const rows = lastSwaps.map(function (r) {
      return [r.day, r.time, r.area, r.layer, r.want1, r.want2 || '', r.emp, r.code,
        r.note || '', swapStatusText(r.status), r.matched ? '是' : '否',
        apiUrl('/api/swap/shot', { id: r.id })];
    });
    const lines = [['# 本文件含访问口令（截图链接），请勿外传']]
      .concat([head])
      .concat(rows)
      .map(function (row) { return row.map(csvCell).join(','); })
      .join('\r\n');
    // BOM 头，保证 Excel 正确识别 UTF-8 中文
    const blob = new Blob(['\uFEFF' + lines], { type: 'text/csv;charset=utf-8' });
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const name = '车位互换登记_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '_' + p(d.getHours()) + p(d.getMinutes()) + '.csv';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  function shortRef(r) {
    if (!r) return '(直接访问)';
    if (typeof r !== 'string') return String(r).slice(0, 40);
    try {
      const u = new URL(r);
      const h = u.host.replace(/^www\./, '');
      const p = u.pathname === '/' ? '' : u.pathname;
      return h + p;
    } catch (e) { return r.slice(0, 40); }
  }

  function renderCards(s) {
    const items = [
      ['总访问量 PV', s.pv, '次页面浏览'],
      ['独立访客 UV', s.uv, '按 IP 哈希去重'],
      ['总点击次数', s.clicks, '含全部交互'],
      ['今日访问', s.todayPv, 'UV ' + s.todayUv + ' 人'],
    ];
    $('cards').innerHTML = items.map(function (it) {
      return '<div class="card"><div class="k">' + it[0] + '</div><div class="v">' + it[1] +
        '<small>' + it[2] + '</small></div></div>';
    }).join('');
  }

  function xAt(i, n, pad, iw) {
    return pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  }

  function renderChart(series) {
    const cv = $('chart');
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 900, h = 220;
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.height = h + 'px';
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const pad = { l: 42, r: 12, t: 12, b: 26 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const vals = series.reduce(function (a, d) { return a.concat([d.pv, d.uv, d.clicks]); }, []);
    const max = Math.max(1, Math.max.apply(null, vals));
    const step = Math.max(1, Math.ceil(max / 4));
    const top = step * 4;

    g.strokeStyle = '#273041'; g.fillStyle = '#8b97ad';
    g.font = '11px -apple-system, sans-serif'; g.textAlign = 'right';
    for (let v = 0; v <= top; v += step) {
      const y = pad.t + ih - (v / top) * ih;
      g.beginPath(); g.moveTo(pad.l, y); g.lineTo(w - pad.r, y); g.stroke();
      g.fillText(String(v), pad.l - 6, y + 4);
    }
    g.textAlign = 'center';
    series.forEach(function (d, i) {
      if (series.length > 10 && i % 2) return;
      g.fillText(d.day.slice(5), xAt(i, series.length, pad, iw), h - 8);
    });

    function line(key, color) {
      g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
      series.forEach(function (d, i) {
        const x = xAt(i, series.length, pad, iw);
        const y = pad.t + ih - (d[key] / top) * ih;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      });
      g.stroke();
      g.fillStyle = color;
      series.forEach(function (d, i) {
        const x = xAt(i, series.length, pad, iw);
        const y = pad.t + ih - (d[key] / top) * ih;
        g.beginPath(); g.arc(x, y, 2.6, 0, Math.PI * 2); g.fill();
      });
    }
    line('pv', '#3d8bff');
    line('uv', '#21c08b');
    line('clicks', '#ff4d5e');
  }
  function renderElements(list) {
    const box = $('elList');
    if (!list || !list.length) { box.innerHTML = '<div class="empty">还没有点击数据</div>'; return; }
    const max = Math.max.apply(null, list.map(function (r) { return r.n; }));
    let html = '<table><thead><tr><th>元素</th><th>文案</th><th style="width:32%">次数</th><th class="n">点击</th></tr></thead><tbody>';
    list.forEach(function (r) {
      const w = Math.round((r.n / max) * 100);
      html += '<tr><td><code>' + esc(r.el || '(未标识)') + '</code></td>' +
        '<td class="muted">' + esc(r.txt || '') + '</td>' +
        '<td><div class="bar" style="width:' + w + '%"></div></td>' +
        '<td class="n">' + r.n + '</td></tr>';
    });
    box.innerHTML = html + '</tbody></table>';
  }

  function renderHeat(cells) {
    const cv = $('heat');
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 480, h = 300;
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.height = h + 'px';
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#12161e'; g.fillRect(0, 0, w, h);
    if (!cells || !cells.length) {
      g.fillStyle = '#8b97ad'; g.font = '13px -apple-system, sans-serif'; g.textAlign = 'center';
      g.fillText('还没有点击数据', w / 2, h / 2);
      return;
    }
    const max = Math.max.apply(null, cells.map(function (c) { return c.n; }));
    g.globalCompositeOperation = 'lighter';
    cells.forEach(function (c) {
      const x = (c.gx + 0.5) / 40 * w;
      const y = (c.gy + 0.5) / 40 * h;
      const r = 14 + 26 * (c.n / max);
      const a = 0.10 + 0.55 * (c.n / max);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,77,94,' + a + ')');
      grd.addColorStop(0.5, 'rgba(255,176,32,' + a * 0.5 + ')');
      grd.addColorStop(1, 'rgba(61,139,255,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    });
    g.globalCompositeOperation = 'source-over';
  }
  function renderSimple(id, list, label, value) {
    const box = $(id);
    if (!list || !list.length) { box.innerHTML = '<div class="empty">暂无数据</div>'; return; }
    const max = Math.max.apply(null, list.map(value));
    let html = '<table><tbody>';
    list.forEach(function (r) {
      const w = Math.round((value(r) / max) * 100);
      html += '<tr><td>' + esc(label(r)) + '</td>' +
        '<td style="width:32%"><div class="bar" style="width:' + w + '%"></div></td>' +
        '<td class="n">' + value(r) + '</td></tr>';
    });
    box.innerHTML = html + '</tbody></table>';
  }

  function bjTime(ts) {
    const d = new Date(ts + 8 * 3600000);
    const p = n => String(n).padStart(2, '0');
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) +
      ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
  }

  function renderRecent(list) {
    const box = $('recent');
    if (!list || !list.length) { box.innerHTML = '<div class="empty">暂无事件</div>'; return; }
    let html = '<table><thead><tr><th>时间</th><th>类型</th><th>元素</th><th>文案</th><th>位置</th><th>设备</th><th>来源</th></tr></thead><tbody>';
    list.forEach(function (r) {
      const pos = (r.x || 0) && (r.y || 0) ? Math.round(r.x * 100) + '% , ' + Math.round(r.y * 100) + '%' : '-';
      html += '<tr><td class="muted">' + bjTime(r.ts) + '</td>' +
        '<td>' + (r.type === 'click' ? '<span class="badge" style="color:#ff4d5e">点击</span>' : '<span class="badge" style="color:#3d8bff">访问</span>') + '</td>' +
        '<td><code>' + esc(r.el || '-') + '</code></td>' +
        '<td class="muted">' + esc(r.txt || '') + '</td>' +
        '<td class="muted">' + pos + '</td>' +
        '<td class="muted">' + esc(r.ua || '') + '</td>' +
        '<td class="muted">' + esc(shortRef(r.ref) || '直接') + '</td></tr>';
    });
    box.innerHTML = html + '</tbody></table>';
  }

  document.querySelectorAll('.seg .btn[data-days]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.seg .btn[data-days]').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      days = parseInt(b.dataset.days, 10) || 14;
      load();
    });
  });
  $('btnRefresh').addEventListener('click', load);
  window.addEventListener('resize', function () { load(); });

  const btnExportCsv = $('btnExportCsv');
  if (btnExportCsv) btnExportCsv.addEventListener('click', exportSwapCsv);
  const btnSwapRefresh = $('btnSwapRefresh');
  if (btnSwapRefresh) btnSwapRefresh.addEventListener('click', loadSwaps);

  const btnLogin = $('btnLogin');
  if (btnLogin) {
    btnLogin.addEventListener('click', async function () {
      const inp = $('keyInput');
      const k = ((inp && inp.value) || '').trim();
      if (!k) return;
      const ok = await tryLogin(k);
      if (!ok) { $('loginErr').textContent = '口令不正确'; return; }
      key = k;
      try { sessionStorage.setItem(KEY_STORE, k); } catch (e) {}
      hideLogin();
      load();
    });
    const inp2 = $('keyInput');
    if (inp2) inp2.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') btnLogin.click();
    });
  }

  const btnLogout = $('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async function () {
      try { await fetch(API_BASE + '/api/logout', { cache: 'no-store' }); } catch (e) {}
      key = '';
      try { sessionStorage.removeItem(KEY_STORE); } catch (e) {}
      showLogin('已退出，请输入访问口令');
    });
  }

  // 地址栏带 ?key= → 自动登录，随后把口令从地址栏移除（避免泄露）
  (async function boot() {
    const url = new URL(location.href);
    const k = url.searchParams.get('key');
    if (k) {
      key = k;
      try { sessionStorage.setItem(KEY_STORE, k); } catch (e) {}
      await tryLogin(k);
      url.searchParams.delete('key');
      history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
    load();
  })();

  setInterval(load, 30000);
})();
