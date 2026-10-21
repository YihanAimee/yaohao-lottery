/* 摇号走势图 · 基准因子分析
   规则：三只股票收盘价角分互换后拼接为 6 位基准因子 */
(function () {
  'use strict';

  const DATA = window.FACTOR_DATA;
  if (!DATA) { document.getElementById('dataMeta').textContent = '数据未加载，请先运行 scripts/fetch_data.py'; return; }

  const RECS = DATA.records;
  const STOCKS = DATA.stocks;               // [{code,name}]
  const NAMES = STOCKS.map(s => s.name);
  // 因子位序 = 每只股票「分(十位) + 角(个位)」（角分互换后：20.12 → 21，即分2在前、角1在后）
  const POS_LABEL = [
    '海尔智家·分', '海尔智家·角',
    '海尔生物·分', '海尔生物·角',
    '盈康生命·分', '盈康生命·角'
  ];
  const POS_KIND = ['分', '角', '分', '角', '分', '角'];   // 每位是"分"还是"角"
  const POS_COLOR = ['#ff4d5e', '#ff8a3d', '#3d8bff', '#5fd0ff', '#a06bff', '#c39bff'];
  const STOCK_COLOR = { '海尔智家': '#ff4d5e', '海尔生物': '#3d8bff', '盈康生命': '#a06bff' };

  const state = {
    range: 66,
    chart: 'vert',
    stock: 0,
    bits: 0,          // 0=显示位1+位2，1=仅位1，2=仅位2
    date: RECS[RECS.length - 1].date,
    picks: [],
    pickGroups: null  // {near:[], hot:[]} 生成 Top 号码时的分组来源
  };

  const $ = id => document.getElementById(id);
  const fmt2 = n => n.toFixed(2);
  const pad = n => String(n).padStart(6, '0');

  /* ---------------- 时间：统一显示为北京时间（UTC+8） ----------------
     兼容三种来源：
       "2026-10-21T15:50:42+08:00"  新数据（带偏移）
       "2026-10-21 07:50:42 (UTC)"   旧云端数据
       "2026-10-21 15:12:05"          旧本地数据（按本地时区） */
  function fmtTime(s) {
    if (!s) return '';
    const txt = String(s).trim();
    let d = null;
    if (/(Z|[+-]\d{2}:?\d{2})$/.test(txt)) {
      d = new Date(txt.replace(' ', 'T'));            // 带时区偏移，Date 能正确解析
    } else {
      const m = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(txt);
      if (!m) return txt;
      if (/\(UTC\)/i.test(txt)) {
        d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
      } else {
        d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      }
    }
    if (!d || isNaN(d.getTime())) return txt;
    const p = n => String(n).padStart(2, '0');
    // 绝对时刻 + 8 小时 = 北京墙上时间（用 UTC 字段取值，与机器时区无关）
    const cn = new Date(d.getTime() + 8 * 3600000);
    return `${cn.getUTCFullYear()}-${p(cn.getUTCMonth() + 1)}-${p(cn.getUTCDate())} ` +
      `${p(cn.getUTCHours())}:${p(cn.getUTCMinutes())}:${p(cn.getUTCSeconds())}（北京时间）`;
  }

  /* ---------------- 工具 ---------------- */
  function windowRecords() {
    return state.range > 0 ? RECS.slice(-state.range) : RECS.slice();
  }
  function currentRecord() {
    return RECS.find(r => r.date === state.date) || RECS[RECS.length - 1];
  }
  function digitsOf(rec) {
    return rec.factorStr.split('').map(Number);
  }
  function jiaoFenOfPrice(p) {
    const fen = Math.round((p - Math.floor(p)) * 100);
    return (fen % 10) * 10 + Math.floor(fen / 10);
  }
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  /* 北京时间（A股 15:00 收盘） */
  function beijingNow() {
    const d = new Date();
    return new Date(d.getTime() + (d.getTimezoneOffset() + 480) * 60000);
  }
  function marketState() {
    const bj = beijingNow();
    const today = `${bj.getFullYear()}-${String(bj.getMonth() + 1).padStart(2, '0')}-${String(bj.getDate()).padStart(2, '0')}`;
    const last = RECS[RECS.length - 1];
    const afterClose = bj.getHours() >= 15;
    if (last.date === today && !afterClose) {
      return { open: true, text: `⚠ 盘中数据（${String(bj.getHours()).padStart(2, '0')}:${String(bj.getMinutes()).padStart(2, '0')}）· 基准因子须以 15:00 收盘价定稿，收盘后请更新数据` };
    }
    if (last.date === today) {
      return { open: false, text: '✓ 15:00 收盘后数据（已定稿）' };
    }
    return { open: false, text: `最新可用：${last.date}（当日为休市或尚未开盘）` };
  }

  /* ---------------- 顶部规则卡 ---------------- */
  function renderRuleCard() {
    const rec = currentRecord();
    const idx = RECS.indexOf(rec);
    const prev = idx > 0 ? RECS[idx - 1] : null;
    NAMES.forEach((n, i) => {
      $('px' + i).textContent = fmt2(rec.closes[n]);
      const jiao = rec.jiao ? rec.jiao[n] : Math.floor(rec.closes[n] % 1 * 10 + 1e-6);
      const fen = rec.fen ? rec.fen[n] : Math.round(rec.closes[n] % 1 * 100) % 10;
      $('jf' + i).textContent = `角${jiao}·分${fen} → 互换 ${String(rec.jiaoFen[n]).padStart(2, '0')}（分${fen}在前）`;
    });
    $('factorNow').innerHTML = [0, 1, 2].map(i => {
      const seg = rec.factorStr.slice(i * 2, i * 2 + 2);
      const fen = rec.fen ? rec.fen[NAMES[i]] : '?';
      const jiao = rec.jiao ? rec.jiao[NAMES[i]] : '?';
      return `<span class="fseg" style="color:${POS_COLOR[i * 2]}"><small>分${fen}·角${jiao}</small>${seg}</span>`;
    }).join('');
    let diffHtml = '';
    if (prev) {
      const diff = rec.factor - prev.factor;
      let changed = 0;
      for (let i = 0; i < 6; i++) if (rec.factorStr[i] !== prev.factorStr[i]) changed++;
      diffHtml = (diff > 0 ? `较前一交易日 <b style="color:var(--red)">+${diff}</b>`
        : diff < 0 ? `较前一交易日 <b style="color:var(--green)">${diff}</b>` : '与前一交易日持平')
        + `，<b>${changed}/6</b> 位发生变化`;
    }
    const ms = marketState();
    const autoOk = isHttp();
    $('dataMeta').innerHTML =
      `${rec.date} 收盘 · 基准因子 <b style="color:var(--red)">${rec.factorStr}</b> ${diffHtml} ｜ 共 ${RECS.length} 个交易日（${RECS[0].date} ~ ${RECS[RECS.length - 1].date}）· 来源：${DATA.source} · 更新于 ${fmtTime(DATA.updatedAt)}` +
      `<br><span class="state-tag ${ms.open ? 'warn' : 'ok'}">${ms.text}</span>` +
      `<span class="state-tag ${autoOk ? 'ok' : 'warn'}">${autoOk ? '🔄 自动更新已开启（每 45 秒检查）' : '⚠ 本地文件方式打开，自动更新不可用'}</span>` +
      `<span class="state-tag">数据源：${dataSource}</span>`;

    // 自检：角分互换与价格是否一致
    const bad = NAMES.some(n => jiaoFenOfPrice(rec.closes[n]) !== rec.jiaoFen[n]);
    if (bad) console.warn('角分互换校验不一致，请重新运行 scripts/fetch_data.py');
  }

  /* ---------------- 走势图 ---------------- */
  const NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function renderChart() {
    const box = $('chartBox');
    box.innerHTML = '';
    $('chartTools').innerHTML = '';
    const recs = windowRecords();
    // 股票切换器只在竖向走势图下显示
    $('stockSwitch').style.display = state.chart === 'vert' ? '' : 'none';
    box.classList.toggle('scroll-y', state.chart === 'vert');
    if (state.chart === 'vert') drawVerticalChart(box, recs);
    else if (state.chart === 'group') drawGroupChart(box, recs);
    else if (state.chart === 'heat') drawHeatmap(box, recs);
    else if (state.chart === 'factor') drawFactorChart(box, recs);
    else drawPriceChart(box, recs);
  }

  /* 竖向走势图：纵轴=交易日（自上而下），横轴=数字 0-9，聚焦单只股票 */
  function drawVerticalChart(box, recs) {
    const si = state.stock;
    const nm = NAMES[si];
    const color = STOCK_COLOR[nm];
    const list = recs.slice().reverse();          // 最新在上
    const n = list.length;

    const mL = 78, rowH = 20, mT = 46, mB = 16, infoW = 150;
    const W = Math.max(box.clientWidth || 900, 760);
    const colW = (W - mL - infoW) / 10;
    const gridW = colW * 10;
    const H = mT + n * rowH + mB;
    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    const X = d => mL + colW * (d + 0.5);
    const Y = i => mT + i * rowH + rowH / 2;

    // 表头：标题 + 数字刻度
    const h1 = svgEl('text', { x: 8, y: 20, fill: color, 'font-size': 12.5, 'font-weight': 700 });
    h1.textContent = `${nm}（${STOCKS[si].code}）`; svg.appendChild(h1);
    const h2 = svgEl('text', { x: 8, y: 36, fill: '#6c7a90', 'font-size': 10.5 });
    h2.textContent = `互换值（十位=分，个位=角）→`; svg.appendChild(h2);
    for (let d = 0; d <= 9; d++) {
      const x = X(d);
      svg.appendChild(svgEl('line', { x1: x, y1: mT - 12, x2: x, y2: mT + n * rowH, stroke: (d === 0 || d === 9) ? '#2b3448' : '#212b3a' }));
      const t = svgEl('text', { x, y: mT - 18, fill: '#8b97ad', 'font-size': 11.5, 'text-anchor': 'middle' });
      t.textContent = d; svg.appendChild(t);
    }

    // 行线 + 日期 + 右侧信息
    list.forEach((r, i) => {
      const y = Y(i);
      svg.appendChild(svgEl('line', { x1: mL, y1: y, x2: mL + gridW, y2: y, stroke: i === 0 ? '#33405480' : '#1a2230' }));
      const t = svgEl('text', { x: mL - 10, y: y + 3.5, fill: i === 0 ? '#e6ebf3' : '#6c7a90', 'font-size': 10.5, 'text-anchor': 'end' });
      t.textContent = r.date.slice(5); svg.appendChild(t);
      const tc = svgEl('text', { x: mL + gridW + 14, y: y + 3.5, fill: '#9aa7bd', 'font-size': 11 });
      tc.textContent = r.closes[nm].toFixed(2); svg.appendChild(tc);
      const jf = String(r.jiaoFen[nm]).padStart(2, '0');
      const t1 = svgEl('text', { x: mL + gridW + 66, y: y + 3.5, fill: color, 'font-size': 12, 'font-weight': 700 });
      t1.textContent = jf; svg.appendChild(t1);
    });
    // 右侧列表头
    const ci = svgEl('text', { x: mL + gridW + 14, y: mT - 18, fill: '#6c7a90', 'font-size': 10.5 });
    ci.textContent = '收盘价'; svg.appendChild(ci);
    const ci2 = svgEl('text', { x: mL + gridW + 66, y: mT - 18, fill: '#6c7a90', 'font-size': 10.5 });
    ci2.textContent = '互换值'; svg.appendChild(ci2);

    // 两条轨迹：位1（实线）/ 位2（虚线）
    const s1 = list.map(r => digitsOf(r)[si * 2]);
    const s2 = list.map(r => digitsOf(r)[si * 2 + 1]);
    const show1 = state.bits !== 2, show2 = state.bits !== 1;
    const poly = (arr, dash) => {
      const e = svgEl('polyline', {
        points: arr.map((v, i) => `${X(v)},${Y(i)}`).join(' '),
        fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round'
      });
      if (dash) { e.setAttribute('stroke-dasharray', '4 3'); e.setAttribute('opacity', '0.55'); e.setAttribute('stroke-width', '1.6'); }
      return e;
    };
    if (show1) svg.appendChild(poly(s1, false));
    if (show2) svg.appendChild(poly(s2, true));
    if (show1) s1.forEach((v, i) => svg.appendChild(svgEl('circle', { cx: X(v), cy: Y(i), r: 3, fill: color })));
    if (show2) s2.forEach((v, i) => svg.appendChild(svgEl('circle', { cx: X(v), cy: Y(i), r: 2.3, fill: color, opacity: 0.6 })));

    // 最新一期高亮
    if (show1) svg.appendChild(svgEl('circle', { cx: X(s1[0]), cy: Y(0), r: 6, fill: 'none', stroke: color, 'stroke-width': 1.6 }));
    if (show2) svg.appendChild(svgEl('circle', { cx: X(s2[0]), cy: Y(0), r: 5, fill: 'none', stroke: color, 'stroke-width': 1.2, opacity: 0.7 }));

    // 悬停行高亮
    const hl = svgEl('rect', { x: mL, y: mT, width: gridW, height: rowH, fill: 'rgba(255,255,255,.07)', opacity: 0 });
    const hover = svgEl('rect', { x: 0, y: mT, width: W, height: n * rowH, fill: 'transparent' });
    hover.style.cursor = 'crosshair';
    hover.addEventListener('mousemove', ev => {
      const rect = svg.getBoundingClientRect();
      const y = (ev.clientY - rect.top) * (H / rect.height);
      let i = Math.floor((y - mT) / rowH);
      i = Math.max(0, Math.min(n - 1, i));
      const r = list[i];
      hl.setAttribute('y', Y(i) - rowH / 2);
      hl.setAttribute('opacity', 1);
      const dg = digitsOf(r);
      $('chartTip').innerHTML =
        `<b>${r.date}</b> ｜ ${nm} 收盘 <b>${r.closes[nm].toFixed(2)}</b>（角 ${r.jiao ? r.jiao[nm] : '?'} / 分 ${r.fen ? r.fen[nm] : '?'}）` +
        ` → 互换值 <b style="color:${color}">${String(r.jiaoFen[nm]).padStart(2, '0')}</b>` +
        `（分=<b>${dg[si * 2]}</b>，角=<b>${dg[si * 2 + 1]}</b>） ｜ 当日基准因子 <b style="color:var(--red)">${r.factorStr}</b>`;
    });
    hover.addEventListener('mouseleave', () => { hl.setAttribute('opacity', 0); });
    svg.appendChild(hl);
    svg.appendChild(hover);

    const lg = el('div', 'chart-legend');
    lg.innerHTML = `<span><i class="lg-solid" style="border-color:${color}"></i>第 1 位 = <b>分</b>（0.01 元，跳动快）</span>
      <span><i class="lg-dash" style="border-color:${color}"></i>第 2 位 = <b>角</b>（0.1 元，较稳定）</span>
      <span class="seg seg-mini" id="bitSwitch">
        <button class="seg-btn ${state.bits === 0 ? 'active' : ''}" data-bits="0">位1+位2</button>
        <button class="seg-btn ${state.bits === 1 ? 'active' : ''}" data-bits="1">仅分位</button>
        <button class="seg-btn ${state.bits === 2 ? 'active' : ''}" data-bits="2">仅角位</button>
      </span>
      <span class="muted">最新一期在顶部，鼠标下移逐行查看</span>`;
    $('chartTools').appendChild(lg);
    box.appendChild(svg);
    lg.querySelector('#bitSwitch').addEventListener('click', e => {
      const b = e.target.closest('.seg-btn'); if (!b) return;
      state.bits = parseInt(b.dataset.bits, 10);
      renderChart();
    });
  }

  /* 分组走势：3 只股票各占一行，每行两条线（第1位/第2位），纵轴 0-9 */
  function drawGroupChart(box, recs) {
    const W = box.clientWidth || 1120;
    const rowH = 116, mL = 64, mR = 78, mT = 30, mB = 36;
    const H = mT + rowH * 3 + mB;
    const iw = W - mL - mR;
    const svg = svgEl('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' });
    const n = recs.length;
    const step = n > 1 ? iw / (n - 1) : 0;
    const X = i => mL + (n > 1 ? i * step : iw / 2);

    NAMES.forEach((nm, si) => {
      const y0 = mT + si * rowH;
      const ih = rowH - 22;
      const Y = d => y0 + ih - (d / 9) * ih;
      const color = STOCK_COLOR[nm];

      // 行底色与标题
      svg.appendChild(svgEl('rect', { x: mL, y: y0, width: iw, height: ih, fill: si % 2 ? 'rgba(255,255,255,.015)' : 'transparent' }));
      const t = svgEl('text', { x: 8, y: y0 + 16, fill: color, 'font-size': 12.5, 'font-weight': 600 });
      t.textContent = nm; svg.appendChild(t);
      const t2 = svgEl('text', { x: 8, y: y0 + 32, fill: '#6c7a90', 'font-size': 10.5 });
      t2.textContent = STOCKS[si].code; svg.appendChild(t2);

      // 刻度（每行左侧 0 / 5 / 9）
      [0, 5, 9].forEach(d => {
        const y = Y(d);
        svg.appendChild(svgEl('line', { x1: mL, y1: y, x2: mL + iw, y2: y, stroke: '#242e3f' }));
        const tx = svgEl('text', { x: mL - 10, y: y + 3.5, fill: '#6c7a90', 'font-size': 10, 'text-anchor': 'end' });
        tx.textContent = d; svg.appendChild(tx);
      });

      // 两条线：第1位（实线）/ 第2位（虚线）
      const s1 = recs.map(r => digitsOf(r)[si * 2]);
      const s2 = recs.map(r => digitsOf(r)[si * 2 + 1]);
      svg.appendChild(svgEl('polyline', {
        points: s1.map((v, i) => `${X(i)},${Y(v)}`).join(' '),
        fill: 'none', stroke: color, 'stroke-width': 2
      }));
      svg.appendChild(svgEl('polyline', {
        points: s2.map((v, i) => `${X(i)},${Y(v)}`).join(' '),
        fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-dasharray': '4 4', opacity: 0.75
      }));
      s1.forEach((v, i) => svg.appendChild(svgEl('circle', { cx: X(i), cy: Y(v), r: 2.6, fill: color })));
      s2.forEach((v, i) => svg.appendChild(svgEl('circle', { cx: X(i), cy: Y(v), r: 2, fill: color, opacity: 0.6 })));

      // 末端标注
      const last = recs[n - 1];
      const l1 = digitsOf(last)[si * 2], l2 = digitsOf(last)[si * 2 + 1];
      const tag = svgEl('text', { x: mL + iw + 10, y: Y(l1) + 4, fill: color, 'font-size': 11.5, 'font-weight': 700 });
      tag.textContent = `1位(分) ${l1}`; svg.appendChild(tag);
      const tag2 = svgEl('text', { x: mL + iw + 10, y: Y(l2) + 4, fill: color, 'font-size': 11.5, opacity: 0.72 });
      tag2.textContent = `2位(角) ${l2}`; svg.appendChild(tag2);
      const cl = svgEl('text', { x: mL + iw + 10, y: y0 + 12, fill: '#6c7a90', 'font-size': 10 });
      cl.textContent = `收盘 ${fmt2(last.closes[nm])}`; svg.appendChild(cl);
    });

    // 公共日期轴
    const labelEvery = Math.max(1, Math.ceil(n / 12));
    recs.forEach((r, i) => {
      if (i % labelEvery !== 0 && i !== n - 1) return;
      const tx = svgEl('text', { x: X(i), y: H - 14, fill: '#6c7a90', 'font-size': 10, 'text-anchor': 'middle' });
      tx.textContent = r.date.slice(5); svg.appendChild(tx);
    });

    // 悬停：三行同时高亮
    const hover = svgEl('rect', { x: mL, y: mT, width: iw, height: rowH * 3, fill: 'transparent' });
    hover.style.cursor = 'crosshair';
    const guide = svgEl('line', { x1: 0, y1: mT, x2: 0, y2: mT + rowH * 3, stroke: '#ffffff', 'stroke-width': 1, opacity: 0.25 });
    hover.addEventListener('mousemove', ev => {
      const rect = svg.getBoundingClientRect();
      const x = (ev.clientX - rect.left) * (W / rect.width);
      let idx = Math.round((x - mL) / (step || 1));
      idx = Math.max(0, Math.min(n - 1, idx));
      const r = recs[idx];
      guide.setAttribute('x1', X(idx)); guide.setAttribute('x2', X(idx));
      const dg = digitsOf(r);
      $('chartTip').innerHTML =
        `<b>${r.date}</b> ｜ 基准因子 <b style="color:var(--red)">${r.factorStr}</b> ｜ ` +
        NAMES.map((nm, i) => `${nm} ${fmt2(r.closes[nm])} → <b style="color:${STOCK_COLOR[nm]}">${dg[i * 2]}</b>(分)·<b style="color:${STOCK_COLOR[nm]};opacity:.7">${dg[i * 2 + 1]}</b>(角)`).join(' ｜ ');
    });
    svg.appendChild(guide);
    svg.appendChild(hover);

    // 图例
    const lg = el('div', 'chart-legend');
    lg.innerHTML = `<span><i class="lg-solid"></i>第 1 位 = 分（0.01 元）</span>
      <span><i class="lg-dash"></i>第 2 位 = 角（0.1 元）</span>
      <span class="muted">纵轴 0–9，横轴为交易日；上下三行分别是海尔智家 / 海尔生物 / 盈康生命</span>`;
    $('chartTools').appendChild(lg);
    box.appendChild(svg);
  }

  /* 日历热力：行=日期，列=6 个位置，数字带色阶 */
  function drawHeatmap(box, recs) {
    const wrap = el('div', 'hm');
    const list = recs.slice().reverse();
    const head = `<tr>
      <th class="d">日期</th>
      <th class="p"><span style="color:${POS_COLOR[0]}">智家·分</span></th>
      <th class="p"><span style="color:${POS_COLOR[1]}">智家·角</span></th>
      <th class="p sep"><span style="color:${POS_COLOR[2]}">生物·分</span></th>
      <th class="p"><span style="color:${POS_COLOR[3]}">生物·角</span></th>
      <th class="p sep"><span style="color:${POS_COLOR[4]}">生命·分</span></th>
      <th class="p"><span style="color:${POS_COLOR[5]}">生命·角</span></th>
      <th class="f">基准因子（按股票分段）</th>
    </tr>`;
    const rows = list.map(r => {
      const dg = digitsOf(r);
      const cells = dg.map((d, p) =>
        `<td class="c" style="background:${heatColor(d)}" title="${POS_LABEL[p]} = ${d}">${d}</td>`).join('');
      return `<tr>
        <td class="d">${r.date}</td>${cells}
        <td class="f">${factorSegments(r)}</td></tr>`;
    }).join('');
    wrap.innerHTML = `<table class="hm-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
    box.appendChild(wrap);
    const lg = el('div', 'chart-legend');
    lg.innerHTML = `<span>数字越接近 <b style="color:var(--red)">9</b> 底色越红，越接近 <b style="color:#7fb3ff">0</b> 越蓝</span>
      <span class="muted">基准因子按三只股票拆成三段显示，便于一眼看清"哪一位最接近"</span>`;
    $('chartTools').appendChild(lg);
  }

  /* 0-9 色阶 */
  function heatColor(d) {
    const t = d / 9;
    const hue = 215 - t * 215;                 // 蓝 → 红
    const light = 20 + t * 22;
    const sat = 22 + t * 48;
    return `hsl(${hue} ${sat}% ${light}%)`;
  }

  /* 因子三段式显示（每只股票两位一色，位序：分·角） */
  function factorSegments(rec, plain) {
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const seg = rec.factorStr.slice(i * 2, i * 2 + 2);
      const n = NAMES[i];
      const tip = rec.fen && rec.jiao ? `分${rec.fen[n]}·角${rec.jiao[n]}` : seg;
      if (plain) { parts.push(`<span class="seg plain" title="${tip}">${seg}</span>`); continue; }
      const c = [POS_COLOR[0], POS_COLOR[2], POS_COLOR[4]][i];
      parts.push(`<span class="seg" title="${tip}" style="color:${c};border-color:${c}55">${seg}</span>`);
    }
    return parts.join('<span class="sepgap">·</span>');
  }

  /* 六位走势图（彩票风格：每位一列，0-9 纵轴） */
  function drawFactorChart(box, recs) {
    const colW = 128, rowH = 30, mL = 46, mT = 46, mB = 46, mR = 18;
    const innerW = colW - 26;
    const W = mL + 6 * colW + mR;
    const H = mT + 10 * rowH + mB;
    const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` });

    // 网格 + 纵轴刻度
    for (let d = 0; d <= 9; d++) {
      const y = mT + (9 - d) * rowH;
      svg.appendChild(svgEl('line', { x1: mL, y1: y, x2: W - mR, y2: y, stroke: '#273041', 'stroke-width': 1 }));
      const t = svgEl('text', { x: mL - 10, y: y + 4, fill: '#8b97ad', 'font-size': 11, 'text-anchor': 'end' });
      t.textContent = d; svg.appendChild(t);
    }
    // 列头
    POS_LABEL.forEach((label, p) => {
      const x = mL + p * colW + innerW / 2;
      const t = svgEl('text', { x, y: 20, fill: POS_COLOR[p], 'font-size': 12, 'text-anchor': 'middle', 'font-weight': 600 });
      t.textContent = label; svg.appendChild(t);
      const t2 = svgEl('text', { x, y: 35, fill: '#8b97ad', 'font-size': 10, 'text-anchor': 'middle' });
      t2.textContent = STOCKS[Math.floor(p / 2)].name; svg.appendChild(t2);
      if (p % 2 === 1) {
        svg.appendChild(svgEl('line', { x1: mL + p * colW - 6, y1: mT - 8, x2: mL + p * colW - 6, y2: mT + 10 * rowH, stroke: '#313d52', 'stroke-dasharray': '3 4' }));
      }
    });

    const n = recs.length;
    const step = n > 1 ? innerW / (n - 1) : 0;
    const X = (p, i) => mL + p * colW + (n > 1 ? i * step : innerW / 2);
    const Y = d => mT + (9 - d) * rowH;

    // 每位：连线 + 圆点
    for (let p = 0; p < 6; p++) {
      const pts = recs.map((r, i) => `${X(p, i)},${Y(digitsOf(r)[p])}`).join(' ');
      svg.appendChild(svgEl('polyline', { points: pts, fill: 'none', stroke: POS_COLOR[p], 'stroke-width': 1.6, opacity: 0.55 }));
      recs.forEach((r, i) => {
        const d = digitsOf(r)[p];
        svg.appendChild(svgEl('circle', { cx: X(p, i), cy: Y(d), r: 3.1, fill: POS_COLOR[p], opacity: 0.9 }));
      });
    }
    // 最近一期高亮
    const last = recs[recs.length - 1];
    digitsOf(last).forEach((d, p) => {
      svg.appendChild(svgEl('circle', { cx: X(p, n - 1), cy: Y(d), r: 6.5, fill: 'none', stroke: POS_COLOR[p], 'stroke-width': 2 }));
    });

    // 横轴日期（每个分面下方各标一次，便于纵向对齐）
    const labelEvery = Math.max(1, Math.ceil(n / 6));
    for (let p = 0; p < 6; p++) {
      recs.forEach((r, i) => {
        if (i % labelEvery !== 0 && i !== n - 1) return;
        const t = svgEl('text', { x: X(p, i), y: H - 26, fill: '#6c7a90', 'font-size': 9.5, 'text-anchor': 'middle' });
        t.textContent = r.date.slice(5); svg.appendChild(t);
      });
    }

    // 交互热区
    const hover = svgEl('rect', { x: mL, y: mT - 12, width: W - mL - mR, height: 10 * rowH + 24, fill: 'transparent' });
    hover.style.cursor = 'crosshair';
    hover.addEventListener('mousemove', ev => {
      const rect = svg.getBoundingClientRect();
      const x = (ev.clientX - rect.left) * (W / rect.width);
      let idx = Math.round((x - mL - innerW / 2) / (step || 1));
      idx = Math.max(0, Math.min(n - 1, idx));
      const r = recs[idx];
      const dg = digitsOf(r);
      $('chartTip').innerHTML =
        `<b>${r.date}</b> ｜ 因子 <b style="color:var(--red)">${r.factorStr}</b> ｜ ` +
        NAMES.map((nm, i) => `${nm} ${fmt2(r.closes[nm])} → <b style="color:${STOCK_COLOR[nm]}">${String(r.jiaoFen[nm]).padStart(2, '0')}</b>`).join(' ｜ ');
    });
    svg.appendChild(hover);

    box.appendChild(svg);
  }

  function drawPriceChart(box, recs) {
    const box2 = box;
    box2.innerHTML = '';
    NAMES.forEach((nm, i) => {
      const sub = el('div', 'sub-chart');
      sub.innerHTML = `<div class="sub-title" style="color:${STOCK_COLOR[nm]};font-size:12.5px;font-weight:600;margin:2px 0 4px">${nm}（${STOCKS[i].code}）收盘价</div>`;
      const holder = el('div');
      sub.appendChild(holder);
      box2.appendChild(sub);
      const series = [{
        name: nm, color: STOCK_COLOR[nm],
        values: recs.map(r => r.closes[nm])
      }];
      drawMultiLine(holder, recs, series, { yTicks: 4, fmt: v => v.toFixed(2), label: '元', compact: true });
    });
  }

  function drawMultiLine(holder, recs, series, opt) {
    const W = holder.clientWidth || 1100;
    const H = opt.compact ? 190 : 340;
    const mL = 46, mR = 16, mT = 18, mB = 30;
    const iw = W - mL - mR, ih = H - mT - mB;
    const svg = svgEl('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' });

    let yMin = opt.yMin, yMax = opt.yMax;
    if (yMax === null) {
      const all = series.flatMap(s => s.values);
      yMin = Math.min(...all); yMax = Math.max(...all);
      const pad = (yMax - yMin) * 0.15 || 1;
      yMin -= pad; yMax += pad;
    }
    const X = i => mL + (recs.length > 1 ? (i * iw) / (recs.length - 1) : iw / 2);
    const Y = v => mT + ih - ((v - yMin) / (yMax - yMin)) * ih;

    for (let t = 0; t <= opt.yTicks; t++) {
      const v = yMin + ((yMax - yMin) * t) / opt.yTicks;
      const y = Y(v);
      svg.appendChild(svgEl('line', { x1: mL, y1: y, x2: W - mR, y2: y, stroke: '#273041' }));
      const tx = svgEl('text', { x: mL - 8, y: y + 4, fill: '#8b97ad', 'font-size': 10.5, 'text-anchor': 'end' });
      tx.textContent = opt.fmt(v); svg.appendChild(tx);
    }
    const labelEvery = Math.max(1, Math.ceil(recs.length / 10));
    recs.forEach((r, i) => {
      if (i % labelEvery !== 0 && i !== recs.length - 1) return;
      const tx = svgEl('text', { x: X(i), y: H - 10, fill: '#8b97ad', 'font-size': 10, 'text-anchor': 'middle' });
      tx.textContent = r.date.slice(5); svg.appendChild(tx);
    });

    series.forEach(s => {
      const pts = s.values.map((v, i) => `${X(i)},${Y(v)}`).join(' ');
      svg.appendChild(svgEl('polyline', { points: pts, fill: 'none', stroke: s.color, 'stroke-width': 2 }));
      s.values.forEach((v, i) => {
        svg.appendChild(svgEl('circle', { cx: X(i), cy: Y(v), r: 2.4, fill: s.color }));
        if (opt.marks) {
          const tx = svgEl('text', { x: X(i), y: Y(v) - 7, fill: s.color, 'font-size': 9, 'text-anchor': 'middle' });
          tx.textContent = String(v).padStart(2, '0'); svg.appendChild(tx);
        }
      });
    });

    // 末端标签
    series.forEach(s => {
      const v = s.values[s.values.length - 1];
      const tx = svgEl('text', { x: W - mR - 2, y: Y(v) - 7, fill: s.color, 'font-size': 10.5, 'text-anchor': 'end', 'font-weight': 600 });
      tx.textContent = s.name; svg.appendChild(tx);
    });

    holder.appendChild(svg);
  }

  /* ---------------- 数字分布 ---------------- */
  function renderDist() {
    const recs = windowRecords();
    const box = $('distBox');
    box.innerHTML = '';
    const table = el('table', 'dist');
    const thead = el('thead');
    const hr = el('tr');
    hr.appendChild(el('th', 'rowhead', '位置'));
    for (let d = 0; d <= 9; d++) hr.appendChild(el('th', null, String(d)));
    thead.appendChild(hr); table.appendChild(thead);

    const tbody = el('tbody');
    const counts = [], misses = [];
    for (let p = 0; p < 6; p++) {
      const c = new Array(10).fill(0);
      recs.forEach(r => c[digitsOf(r)[p]]++);
      // 遗漏：距上次出现天数（窗口内）
      const m = new Array(10).fill(null);
      for (let d = 0; d <= 9; d++) {
        for (let i = recs.length - 1; i >= 0; i--) {
          if (digitsOf(recs[i])[p] === d) { m[d] = recs.length - 1 - i; break; }
        }
        if (m[d] === null) m[d] = recs.length;
      }
      counts.push(c); misses.push(m);
      const tr = el('tr');
      const th = el('td', 'rowhead', `<span style="color:${POS_COLOR[p]}">${POS_LABEL[p]}</span>`);
      tr.appendChild(th);
      const max = Math.max(...c);
      for (let d = 0; d <= 9; d++) {
        const cls = c[d] === 0 ? 'miss' : (c[d] >= max * 0.7 ? 'hot' : (c[d] >= max * 0.45 ? 'mid' : ''));
        tr.appendChild(el('td', cls, `<div class="d">${c[d]}</div><div class="c">${m[d]}期未出</div>`));
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    box.appendChild(table);
    $('distMeta').textContent = `${recs[0].date} ~ ${recs[recs.length - 1].date}`;
  }

  /* ---------------- 趋势研判 ---------------- */
  function renderTrend() {
    const recs = windowRecords();
    const box = $('trendBox');
    box.innerHTML = '';

    // 1) 每位稳定性
    const k = Math.min(20, recs.length);
    const tail = recs.slice(-k);
    const stable = [];
    for (let p = 0; p < 6; p++) {
      let s = 0;
      for (let i = 1; i < tail.length; i++) if (digitsOf(tail[i])[p] === digitsOf(tail[i - 1])[p]) s++;
      stable.push({ p, ratio: s / Math.max(1, tail.length - 1) });
    }
    const mostStable = stable.slice().sort((a, b) => b.ratio - a.ratio)[0];
    const leastStable = stable.slice().sort((a, b) => a.ratio - b.ratio)[0];

    // 2) 高频因子
    const freq = new Map();
    recs.forEach(r => freq.set(r.factorStr, (freq.get(r.factorStr) || 0) + 1));
    const topFactors = [...freq.entries()].filter(e => e[1] > 1).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // 3) 各位热号
    const hotDigits = [];
    for (let p = 0; p < 6; p++) {
      const c = new Array(10).fill(0);
      recs.forEach(r => c[digitsOf(r)[p]]++);
      const best = c.map((v, d) => [d, v]).sort((a, b) => b[1] - a[1]).slice(0, 2);
      hotDigits.push({ p, best, total: c.reduce((a, b) => a + b, 0) });
    }

    // 4) 预测（各位独立分布 + 一阶马尔可夫平滑）
    const pred = predictNext(recs);

    const last = recs[recs.length - 1];
    const prev = recs[recs.length - 2];
    const lastD = digitsOf(last), prevD = digitsOf(prev);

    const items = [
      {
        ico: '📈',
        html: `<b>最新因子</b> ${last.date}：<span class="hot">${last.factorStr}</span>，
          拆解（分·角）${lastD.map((d, i) => `<b style="color:${POS_COLOR[i]}">${d}</b>`).join('·')}，
          较前一日 ${last.factor - prev.factor >= 0 ? '+' : ''}${last.factor - prev.factor}；
          最近 10 日因子：${recs.slice(-10).map(r => r.factorStr).join(' / ')}。`
      },
      {
        ico: '🎯',
        html: `<b>位稳定性（近 ${k} 期）</b>：最稳定的是
          <span class="hot">${POS_LABEL[mostStable.p]}</span>（连续不变占 ${(mostStable.ratio * 100).toFixed(0)}%），
          波动最大的是 <span class="cold">${POS_LABEL[leastStable.p]}</span>（${(leastStable.ratio * 100).toFixed(0)}%）。
          因子位序为「分(十位)·角(个位)」：分位随 0.01 元跳动、极不稳定，角位随 0.1 元跳动、相对稳定，
          所以应优先锁定<b>第 2/4/6 位（角位）</b>，把<b>第 1/3/5 位（分位）</b>作为覆盖变量。`
      },
      {
        ico: '🔥',
        html: `<b>各位热号</b>：` + hotDigits.map(h =>
          `<span style="color:${POS_COLOR[h.p]}">${POS_LABEL[h.p]}</span> → ` +
          h.best.map(([d, c]) => `<b>${d}</b>(${c})`).join('、')).join('；')
      },
      {
        ico: '🔁',
        html: `<b>热号复现</b>：` + (topFactors.length
            ? `区间内重复出现的因子：${topFactors.map(([f, c]) => `<span class="hot">${f}</span>×${c}`).join('、')}；`
            : `区间内无重复因子，说明 6 位组合随机性极强（${recs.length} 期 ${freq.size} 个不同值）；`) +
          `不同因子 ${freq.size} 个 / ${recs.length} 期。`
      },
      {
        ico: '🔮',
        html: `<b>下一交易日因子概率预测</b>：各位最可能的数字
          ${pred.digits.map((list, i) => `<span style="color:${POS_COLOR[i]}">${POS_LABEL[i]}=${list[0].d}(${(list[0].p * 100).toFixed(1)}%)</span>`).join('、')}；
          综合最优组合：<span class="hot">${pred.top[0].num}</span>
          （概率 ${(pred.top[0].p * 100).toFixed(3)}%），备选 ${pred.top.slice(1, 5).map(t => t.num).join('、')}。`
      }
    ];
    items.forEach(it => {
      const d = el('div', 'trend-item');
      d.innerHTML = `<div class="ti-ico">${it.ico}</div><div class="ti-body">${it.html}</div>`;
      box.appendChild(d);
    });

    // Top 概率号码 chips
    const chips = el('div', 'chip-list');
    pred.top.slice(0, 10).forEach((t, i) => {
      const c = el('div', 'chip', `${factorSegments({ factorStr: t.num })}<small>${(t.p * 100).toFixed(3)}%</small>`);
      chips.appendChild(c);
    });
    const wrap = el('div', 'trend-item');
    wrap.innerHTML = `<div class="ti-ico">🏅</div><div class="ti-body"><b>概率 Top10 候选因子</b>
      <div class="muted small">按各位数字在近 3 个月的出现频率与一阶转移概率加权，仅供研判参考</div></div>`;
    wrap.appendChild(chips);
    box.appendChild(wrap);
  }

  /* 预测：每位边际分布 = 平滑后的一阶马尔可夫转移 */
  function predictNext(recs) {
    const n = recs.length;
    const alpha = 1.2;
    const digits = [];
    for (let p = 0; p < 6; p++) {
      const counts = new Array(10).fill(0);
      recs.forEach(r => counts[digitsOf(r)[p]]++);
      const marginal = counts.map(c => (c + alpha) / (n + alpha * 10));
      // 一阶转移（最后 6 位看前一天）
      const trans = Array.from({ length: 10 }, () => new Array(10).fill(alpha));
      for (let i = 1; i < n; i++) {
        const a = digitsOf(recs[i - 1])[p], b = digitsOf(recs[i])[p];
        trans[a][b] += 1;
      }
      const lastD = digitsOf(recs[n - 1])[p];
      const rowSum = trans[lastD].reduce((a, b) => a + b, 0);
      const viaTrans = trans[lastD].map(v => v / rowSum);
      // 与整体边际融合
      const mix = viaTrans.map((v, i) => 0.55 * v + 0.45 * marginal[i]);
      const sum = mix.reduce((a, b) => a + b, 0);
      const norm = mix.map(v => v / sum);
      const best = norm.map((v, d) => ({ d, p: v })).sort((a, b) => b.p - a.p);
      digits.push(best);
    }
    // 组合：每位取 top2（最多 64 组合）
    const combos = [];
    const pick = (i, cur, prob) => {
      if (i === 6) { combos.push({ num: cur.join(''), p: prob }); return; }
      digits[i].slice(0, 2).forEach(o => pick(i + 1, cur.concat(o.d), prob * o.p));
    };
    pick(0, [], 1);
    combos.sort((a, b) => b.p - a.p);
    return { digits, top: combos.slice(0, 10) };
  }

  /* ---------------- 智能推荐 ---------------- */
  function renderSmart() {
    const rec = currentRecord();
    const f = rec.factor;
    const box = $('smartBox');
    box.innerHTML = '';
    $('smartMeta').textContent = `对照 ${rec.date} · 基准因子 ${rec.factorStr}`;

    /* 1) 邻域号码 */
    const groups = [1, 2, 3, 5, 10];
    const nearHtml = groups.map(g => {
      const chips = [];
      for (let d = -g; d <= g; d++) {
        if (d === 0) continue;
        const v = f + d;
        if (v < 0 || v > 999999) continue;
        const s = String(v).padStart(6, '0');
        let match = 0;
        for (let i = 0; i < 6; i++) if (s[i] === rec.factorStr[i]) match++;
        chips.push(`<span class="chip" title="与基准因子有 ${match} 位相同">${factorSegments({ factorStr: s })}<small>${match}位</small></span>`);
      }
      return `<div class="smart-item">
        <div class="si-title">±<b>${g}</b> 邻域（${chips.length} 个号码，越靠前距离越小）</div>
        <div class="chip-list">${chips.join('')}</div></div>`;
    }).join('');

    /* 2) 历史相似因子 */
    const recs = windowRecords();
    const hist = recs.filter(r => r.date !== rec.date)
      .map(r => {
        let match = 0;
        for (let i = 0; i < 6; i++) if (r.factorStr[i] === rec.factorStr[i]) match++;
        return { date: r.date, num: r.factorStr, d: Math.abs(r.factor - f), match };
      })
      .sort((a, b) => a.d - b.d).slice(0, 6);
    const histHtml = `<div class="smart-item">
      <div class="si-title">近 3 个月与当日因子最接近的<b>历史因子</b>（位相同越多越值得借鉴）</div>
      <div class="chip-list">${hist.map(h =>
        `<span class="chip" title="${h.date}">${factorSegments({ factorStr: h.num })}<small>${h.date.slice(5)} · 差${h.d} · ${h.match}位</small></span>`).join('')}</div></div>`;

    /* 3) 位预测 + 填报建议 */
    const pred = predictNext(recs);
    const stable = [];
    for (let p = 0; p < 6; p++) {
      const c = new Array(10).fill(0);
      recs.slice(-20).forEach(r => c[digitsOf(r)[p]]++);
      const top = c.map((v, d) => [d, v]).sort((a, b) => b[1] - a[1])[0];
      stable.push({ p, d: top[0], c: top[1] });
    }
    const predNum = stable.map(s => s.d).join('');
    const advice = `<div class="smart-item">
      <div class="si-title"><b>各位众数预测</b>（近 20 期该位出现最多的数字；位序 = 分·角）</div>
      <div class="chip-list">${stable.map(s =>
        `<span class="chip" style="border-color:${POS_COLOR[s.p]}55">${POS_LABEL[s.p]} = <b style="color:${POS_COLOR[s.p]}">${s.d}</b><small>${s.c}/20 期</small></span>`).join('')}</div>
      <div class="si-title" style="margin-top:10px">由此得到的候选因子：<b style="color:var(--red)">${predNum}</b>
        （与当日因子 ${rec.factorStr} 相同 <b>${stable.filter((s, i) => String(s.d) === rec.factorStr[i]).length}/6</b> 位）</div>
      <div class="si-title">填报建议：因子位序为「分·角」，<b>分位（第 1/3/5 位）随 0.01 元跳动、极不稳定</b>，
        <b>角位（第 2/4/6 位）随 0.1 元跳动、相对稳定</b>。
        平行志愿应优先锁定角位组合 <b>${rec.factorStr[1]}${rec.factorStr[3]}${rec.factorStr[5]}</b>，
        对分位按 ±1 做小幅覆盖（见下方「锁定角位候选」）；
        若只报 1 个号，命中概率最高的是 <b style="color:var(--red)">${rec.factorStr}</b> 本身（与当日基准因子完全一致）。</div>
    </div>`;

    /* 4) 锁定角位 + 分位 ±1 的候选组合 */
    const jiaoLock = [rec.factorStr[1], rec.factorStr[3], rec.factorStr[5]];
    const fenBase = [rec.factorStr[0], rec.factorStr[2], rec.factorStr[4]];
    const cand = [];
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (let c = -1; c <= 1; c++) {
          const f1 = Number(fenBase[0]) + a, f2 = Number(fenBase[1]) + b, f3 = Number(fenBase[2]) + c;
          if (f1 < 0 || f1 > 9 || f2 < 0 || f2 > 9 || f3 < 0 || f3 > 9) continue;
          const num = `${f1}${jiaoLock[0]}${f2}${jiaoLock[1]}${f3}${jiaoLock[2]}`;
          let match = 0;
          for (let i = 0; i < 6; i++) if (num[i] === rec.factorStr[i]) match++;
          cand.push({ num, match, d: Math.abs(Number(num) - f) });
        }
      }
    }
    cand.sort((a, b) => b.match - a.match || a.d - b.d);
    const lockHtml = `<div class="smart-item">
      <div class="si-title"><b>锁定角位候选</b>：角位固定为 <b style="color:var(--red)">${jiaoLock.join('')}</b>，
        分位在 ±1 内浮动（${cand.length} 个组合，按位匹配数排序）</div>
      <div class="chip-list">${cand.slice(0, 14).map(c =>
        `<span class="chip" title="与基准因子 ${c.match} 位相同">${factorSegments({ factorStr: c.num })}<small>${c.match}位</small></span>`).join('')}</div>
    </div>`;

    const wrap = el('div', 'smart-cols');
    wrap.innerHTML = `<div>${nearHtml}</div><div>${histHtml}</div>`;
    box.appendChild(wrap);
    const adv = el('div');
    adv.innerHTML = advice;
    box.appendChild(adv);
    const lock = el('div');
    lock.innerHTML = lockHtml;
    box.appendChild(lock);
  }

  /* ---------------- 选号排名 ---------------- */
  function rankNumbers() {
    const rec = currentRecord();
    const factor = rec.factor;
    const picks = state.picks;
    const box = $('rankBox');
    box.innerHTML = '';
    if (!picks.length) {
      box.innerHTML = `<div class="hint-box">输入幸运数字后点击「计算排名」。<br>
        规则：与 <b>${rec.date}</b> 的基准因子 <b style="color:var(--red)">${rec.factorStr}</b> 数值距离越小排名越前；
        位数不足 6 位按右对齐补零（如 75 → 000075）。</div>`;
      return;
    }
    const freq = new Map();
    windowRecords().forEach(r => freq.set(r.factorStr, (freq.get(r.factorStr) || 0) + 1));

    const rows = picks.map(p => {
      const num = String(p).replace(/\D/g, '').slice(0, 6);
      const val = parseInt(num, 10);
      const diff = Math.abs(val - factor);
      const padded = pad(val);
      let match = 0;
      for (let i = 0; i < 6; i++) if (padded[i] === rec.factorStr[i]) match++;
      return { num: padded, raw: num, val, diff, match, hits: freq.get(padded) || 0 };
    });
    rows.sort((a, b) => a.diff - b.diff || b.match - a.match || a.val - b.val);
    const best = rows[0].diff;

    const groups = state.pickGroups;
    const nearSet = new Set(groups ? groups.near.map(c => c.num) : []);
    const hotSet = new Set(groups ? groups.hot.map(c => c.num) : []);
    const hasSrc = nearSet.size + hotSet.size > 0;

    const tbl = el('table', 'rank-table');
    tbl.innerHTML = `<thead><tr><th>名次</th><th>我的号码</th><th>距基准因子</th><th>位匹配</th>
      <th>评级</th><th>区间出现</th>${hasSrc ? '<th>来源</th>' : ''}</tr></thead>`;
    const tb = el('tbody');
    rows.forEach((r, i) => {
      const tr = el('tr');
      let badge = '<span class="badge gray">远</span>';
      if (r.diff === 0) badge = '<span class="badge red">命中</span>';
      else if (r.diff <= 2) badge = '<span class="badge gold">并列第一</span>';
      else if (r.diff <= 10) badge = '<span class="badge blue">近邻</span>';
      if (i === 0 && r.diff === best) tr.className = 'gold';
      else if (i === 1 && r.diff === best) tr.className = 'silver';
      else if (i === 2 && r.diff === best) tr.className = 'bronze';
      const src = !hasSrc ? '' :
        nearSet.has(r.num) ? '<span class="badge blue">邻域</span>' :
          hotSet.has(r.num) ? '<span class="badge gold">高频</span>' : '<span class="badge gray">自填</span>';
      tr.innerHTML = `<td>${i + 1}</td><td class="num">${factorSegments({ factorStr: r.num }, true)}</td>
        <td>${r.diff === 0 ? '<b style="color:var(--red)">0</b>' : r.diff}</td>
        <td>${r.match}/6</td><td>${badge}</td>
        <td>${r.hits ? `<b>${r.hits} 次</b>` : '0 次'}</td>${hasSrc ? `<td>${src}</td>` : ''}`;
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    box.appendChild(tbl);

    const top = rows.filter(r => r.diff === best);
    // 与基准因子绝对距离最近的号码（不受“我填了哪些号码”影响）
    const nearest = [{ num: rec.factorStr, d: 0 }];
    for (let d = 1; d <= 3 && nearest.length < 7; d++) {
      for (const s of [-1, 1]) {
        const v = factor + d * s;
        if (v < 0 || v > 999999) continue;
        nearest.push({ num: pad(v), d });
      }
    }
    const note = el('div', 'hint-box');
    note.style.marginTop = '10px';
    note.innerHTML = `对照 <b>${rec.date}</b> 基准因子 <b style="color:var(--red)">${rec.factorStr}</b>：<br>
      · <b>与基准因子绝对距离最近的号码</b>：${nearest.map(n => `<b>${n.num}</b>（距离 ${n.d}）`).join('、')}<br>
      · <b>你填写的 ${rows.length} 个号码中最接近的是</b> <b>${top.map(t => t.num).join('、')}</b>，距离 <b style="color:var(--red)">${best}</b>${best === 0 ? '（完全命中）' : best <= 2 ? '（按平行志愿规则可并列第一）' : ''}<br>
      ${hasSrc ? `· <b>号码来源</b>：邻域推荐 ${groups.near.map(c => c.num).join('、')}；历史高频 ${groups.hot.map(c => c.num).join('、') || '（区间内无）'}<br>` : ''}
      提示：可围绕该距离再微调 ±1 / ±2 / ±5 组成平行志愿数组，提高覆盖率。`;
    box.appendChild(note);
  }

  /* Top 概率号码：以当日基准因子为锚（邻域优先）＋ 历史高频组合 */
  function fillTopNumbers() {
    const recs = windowRecords();
    const pred = predictNext(recs);
    const rec = currentRecord();
    const f = rec.factor;
    const from = parseInt($('rangeFrom').value, 10);
    const to = parseInt($('rangeTo').value, 10);
    const lo = Number.isNaN(from) ? 0 : Math.max(0, Math.min(from, to));
    const hi = Number.isNaN(to) ? 999999 : Math.min(999999, Math.max(from, to));
    const inRange = v => v >= lo && v <= hi;

    // 各位概率查表
    const pmap = pred.digits.map(list => {
      const m = new Array(10).fill(0);
      list.forEach(o => m[o.d] = o.p);
      return m;
    });
    const scoreOf = num => {
      const s = String(num).padStart(6, '0');
      let p = 1;
      for (let i = 0; i < 6; i++) p *= pmap[i][Number(s[i])];
      return p;
    };

    /* A. 基准因子邻域：离基准因子越近越优先，同距离取概率更高者 */
    const OFFSETS = [1, 2, 3, 4, 5, 6, 8, 10, 13, 16, 20, 30, 40, 50, 80, 120, 200,
      350, 500, 800, 1200, 2000, 3500, 5000, 8000, 12000, 20000, 35000, 50000,
      80000, 120000, 200000, 350000, 500000, 800000];
    const near = [];
    for (const d of OFFSETS) {
      for (const s of [-1, 1]) {
        const v = f + d * s;
        if (v < 0 || v > 999999 || !inRange(v)) continue;
        near.push({ num: pad(v), d, p: scoreOf(v) });
      }
    }
    near.sort((a, b) => a.d - b.d || b.p - a.p);
    const nearTop = near.slice(0, 10);

    /* B. 历史高频组合（各位频率 + 一阶转移），限定在候选区间内 */
    const hot = pred.top
      .map(t => ({ num: t.num, p: t.p, v: parseInt(t.num, 10) }))
      .filter(t => inRange(t.v))
      .sort((a, b) => b.p - a.p)
      .slice(0, 5);

    state.picks = [...nearTop.map(c => c.num), ...hot.map(c => c.num)];
    state.pickGroups = { near: nearTop, hot };
    $('myNums').value = state.picks.join('\n');
    rankNumbers();
  }

  /* ---------------- 明细表 ---------------- */
  /* 明细表里的"分·角"单元格：显示 分·角（互换后十位=分、个位=角） */
  function jfCell(r, n) {
    const fen = r.fen ? r.fen[n] : null;
    const jiao = r.jiao ? r.jiao[n] : null;
    if (fen === null || jiao === null) return String(r.jiaoFen[n]).padStart(2, '0');
    return `${fen}<span class="dot">·</span>${jiao}`;
  }

  function renderTable() {
    const recs = windowRecords().slice().reverse();
    const tb = document.querySelector('#detailTable tbody');
    tb.innerHTML = '';
    recs.forEach((r, i) => {
      const prev = RECS[RECS.indexOf(r) - 1];
      const d = prev ? r.factor - prev.factor : 0;
      const cls = d > 0 ? 'up' : d < 0 ? 'down' : '';
      const sign = d > 0 ? '+' + d : (d < 0 ? String(d) : '0');
      const tr = el('tr');
      tr.innerHTML = `<td>${r.date}</td>
        <td>${fmt2(r.closes['海尔智家'])}</td><td class="jf" title="互换值 ${String(r.jiaoFen['海尔智家']).padStart(2, '0')}">${jfCell(r, '海尔智家')}</td>
        <td>${fmt2(r.closes['海尔生物'])}</td><td class="jf" title="互换值 ${String(r.jiaoFen['海尔生物']).padStart(2, '0')}">${jfCell(r, '海尔生物')}</td>
        <td>${fmt2(r.closes['盈康生命'])}</td><td class="jf" title="互换值 ${String(r.jiaoFen['盈康生命']).padStart(2, '0')}">${jfCell(r, '盈康生命')}</td>
        <td class="f">${factorSegments(r)}</td>
        <td class="${cls}">${sign}</td>`;
      tb.appendChild(tr);
    });
    $('tableMeta').textContent = `近 ${recs.length} 个交易日（${recs[recs.length - 1].date} ~ ${recs[0].date}）`;
  }

  /* ---------------- 导出 ---------------- */
  function exportCsv() {
    const head = '日期,海尔智家收盘,海尔智家角,海尔智家分,海尔智家分角,海尔生物收盘,海尔生物角,海尔生物分,海尔生物分角,盈康生命收盘,盈康生命角,盈康生命分,盈康生命分角,基准因子\n';
    const body = windowRecords().map(r => {
      const cols = [r.date];
      NAMES.forEach(n => {
        cols.push(fmt2(r.closes[n]));
        cols.push(r.jiao ? r.jiao[n] : '');
        cols.push(r.fen ? r.fen[n] : '');
        cols.push(String(r.jiaoFen[n]).padStart(2, '0'));
      });
      cols.push(r.factorStr);
      return cols.join(',');
    }).join('\n');
    const blob = new Blob(['\ufeff' + head + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `基准因子_${RECS[0].date}_${RECS[RECS.length - 1].date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    $('chartTabs').addEventListener('click', e => {
      const b = e.target.closest('.seg-btn'); if (!b) return;
      [...$('chartTabs').children].forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.chart = b.dataset.chart;
      try { location.hash = state.chart; } catch (e) { }
      renderChart();
    });
    $('stockSwitch').addEventListener('click', e => {
      const b = e.target.closest('.seg-btn'); if (!b) return;
      [...$('stockSwitch').children].forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.stock = parseInt(b.dataset.stock, 10);
      renderChart();
    });
    $('rangeSel').addEventListener('change', e => {
      state.range = parseInt(e.target.value, 10);
      renderChart(); renderDist(); renderTrend(); renderTable(); renderSmart();
    });
    $('dateSel').addEventListener('change', e => { state.date = e.target.value; renderRuleCard(); renderSmart(); rankNumbers(); });
    $('btnRank').addEventListener('click', () => {
      state.picks = $('myNums').value.split(/[\s,，、;；]+/).filter(Boolean);
      state.pickGroups = null;
      rankNumbers();
    });
    $('btnGenTop').addEventListener('click', fillTopNumbers);
    $('btnClear').addEventListener('click', () => {
      $('myNums').value = ''; state.picks = []; state.pickGroups = null; rankNumbers();
    });
    $('btnExport').addEventListener('click', exportCsv);
    $('btnRule').addEventListener('click', () => $('ruleModal').hidden = false);
    $('btnCloseRule').addEventListener('click', () => $('ruleModal').hidden = true);
    $('ruleModal').addEventListener('click', e => { if (e.target.id === 'ruleModal') $('ruleModal').hidden = true; });
    $('btnRefresh').addEventListener('click', async () => {
      const btn = $('btnRefresh');
      btn.textContent = '更新中…'; btn.disabled = true;
      try {
        await reloadData();
        toast('数据已刷新');
        btn.textContent = '已更新';
        setTimeout(() => { btn.textContent = '更新数据'; btn.disabled = false; }, 1500);
      } catch (err) {
        alert('前端刷新失败（file:// 打开时浏览器禁止读取本地文件）。\n请改用 http://127.0.0.1:8777/index.html 访问，\n或在项目目录执行：python3 scripts/fetch_data.py 后刷新页面。');
        btn.textContent = '更新数据'; btn.disabled = false;
      }
    });
    window.addEventListener('resize', () => renderChart());
  }

  /* ---------------- 自动更新（在线接口优先，本地快照兜底） ---------------- */
  let lastStamp = DATA.updatedAt;
  let dataSource = '本地快照';
  function isHttp() { return location.protocol === 'http:' || location.protocol === 'https:'; }

  /* 应用一份新数据（在线接口 / 本地文件） */
  function applyData(json) {
    DATA.records = json.records; DATA.updatedAt = json.updatedAt; DATA.source = json.source;
    RECS.length = 0; json.records.forEach(r => RECS.push(r));
    if (!RECS.some(r => r.date === state.date)) state.date = RECS[RECS.length - 1].date;
    init();
  }

  /* 尝试在线接口：同源 api/factor（Cloudflare Worker / 自建 API 都走这个路径） */
  async function tryRemote() {
    if (!isHttp()) return false;
    try {
      const res = await fetch('api/factor?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return false;
      const json = await res.json();
      if (!json || !json.records || !json.records.length) return false;
      lastStamp = json.updatedAt;
      applyData(json);
      dataSource = json.origin ? `在线接口（${json.origin}）` : '在线接口';
      renderRuleCard();
      return true;
    } catch (e) { return false; }
  }

  async function pollStatus() {
    if (!isHttp()) return;                       // file:// 下无法 fetch，静默跳过
    // 1) 在线接口
    try {
      const res = await fetch('api/factor?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json && json.records && json.records.length && json.updatedAt !== lastStamp) {
          lastStamp = json.updatedAt;
          applyData(json);
          dataSource = json.origin ? `在线接口（${json.origin}）` : '在线接口';
          toast(`在线数据已更新 · ${fmtTime(json.updatedAt)} · 基准因子 ${json.records[json.records.length - 1].factorStr}`);
          return;
        }
        if (json && json.records && json.records.length) { dataSource = '在线接口'; renderRuleCard(); return; }
      }
    } catch (e) { /* 无在线接口，继续本地 */ }

    // 2) 本地 status.json（本地定时任务模式）
    try {
      const res = await fetch('data/status.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const st = await res.json();
      if (!st.ok || !st.lastUpdated || st.lastUpdated === lastStamp) return;
      lastStamp = st.lastUpdated;
      await reloadData();
      toast(`数据已更新 · ${fmtTime(st.lastUpdated)} · 最新基准因子 ${st.lastFactor}`);
    } catch (e) { /* 忽略：轮询失败不影响使用 */ }
  }

  /* 重新加载 data/factors.js 并重绘全部模块 */
  async function reloadData() {
    const res = await fetch('data/factors.js?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('fetch factors failed');
    const text = await res.text();
    const json = JSON.parse(text.replace(/^window\.FACTOR_DATA\s*=\s*/, '').replace(/;\s*$/, ''));
    applyData(json);
  }

  /* 轻提示 */
  function toast(msg) {
    let t = document.querySelector('.toast-msg');
    if (!t) {
      t = el('div', 'toast-msg');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._tm);
    t._tm = setTimeout(() => t.classList.remove('show'), 4200);
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    // 支持 #heat / #group / #factor / #price 直接定位视图
    const h = (location.hash || '').replace('#', '');
    if (['vert', 'group', 'heat', 'factor', 'price'].includes(h)) {
      state.chart = h;
      [...$('chartTabs').children].forEach(x => x.classList.toggle('active', x.dataset.chart === h));
    }
    const sel = $('dateSel');
    sel.innerHTML = '';
    RECS.slice().reverse().forEach(r => {
      const o = document.createElement('option');
      o.value = r.date;
      o.textContent = r.date + ' · ' + r.factorStr;
      sel.appendChild(o);
    });
    if (!RECS.some(r => r.date === state.date)) state.date = RECS[RECS.length - 1].date;
    sel.value = state.date;
    renderRuleCard();
    renderChart();
    renderDist();
    renderTrend();
    renderTable();
    renderSmart();
    rankNumbers();
  }

  bind();
  init();
  // 自动更新：优先在线接口，其次本地定时任务产物
  if (isHttp()) {
    tryRemote().then(ok => { if (ok) toast('已切换到在线数据源'); });
    setTimeout(pollStatus, 3000);
    setInterval(pollStatus, 45000);
  }
})();
