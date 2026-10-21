/* 访问统计看板 · 纯原生实现（无外部依赖） */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let days = 14;

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  async function load() {
    let d;
    try {
      const res = await fetch('api/stats?days=' + days, { cache: 'no-store' });
      d = await res.json();
    } catch (e) {
      $('rangeTxt').textContent = '加载失败：' + e.message;
      return;
    }
    if (!d.ok) { $('rangeTxt').textContent = '加载失败'; return; }
    $('rangeTxt').textContent = d.from + ' ~ 今天（北京时间）· 每 30 秒自动刷新';
    renderCards(d.summary);
    renderChart(d.series);
    renderElements(d.topElements);
    renderHeat(d.heat);
    renderSimple('refList', d.topRefs, shortRef, r => r.n);
    renderSimple('uaList', d.devices, r => r.ua, r => r.n);
    renderRecent(d.recent);
  }

  function shortRef(r) {
    if (!r) return '(直接访问)';
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
  load();
  setInterval(load, 30000);
})();
