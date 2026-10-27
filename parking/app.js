/* 车位互换 · 共享池与登记（纯原生实现，无外部依赖） */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const API = 'https://yaohao-stats.pages.dev';

  // 区域白名单（与后端 stats/functions/_lib/areas.mjs 保持一致，均带层级前缀）
  const GROUND_AREAS = [
    '地上-A区', '地上-B区',
    '地上-D区（靠近创牌南和8号门一侧）', '地上-D区（靠近创牌北和三翼鸟雕塑一侧）',
    '地上-F区（靠近模具A厅）', '地上-F区（靠近模具B厅）', '地上-F区（靠近模具C厅）',
    '地上-H区（靠近创牌一侧）', '地上-H区（中间区域靠近C01、C02）', '地上-H区（靠近员工超市一侧）',
    '地上-K区', '地上-G区',
  ];
  const UNDERGROUND_AREAS = [
    '地下-负1层A区', '地下-负1层B区', '地下-负1层C区', '地下-负1层D区', '地下-负1层E区',
    '地下-负2层A区', '地下-负2层B区', '地下-负2层C区', '地下-负2层D区', '地下-负2层E区',
  ];

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function layerOf(area) {
    if (GROUND_AREAS.indexOf(area) >= 0) return '地上';
    if (UNDERGROUND_AREAS.indexOf(area) >= 0) return '地下';
    return '';
  }

  /* ---------- 下拉框 ---------- */

  function fillAreaSelect(el, areas, placeholder) {
    el.innerHTML = '<option value="">' + placeholder + '</option>' +
      areas.map(a => '<option value="' + esc(a) + '">' + esc(a) + '</option>').join('');
  }

  function initAreaOptions() {
    fillAreaSelect($('areaArea'), GROUND_AREAS.concat(UNDERGROUND_AREAS), '请选择你目前的车位区域');
    refreshWantOptions();
  }

  /** 意向区域只列出与当前车位同层、且不同于当前车位的区域；意向 2 可留空 */
  function refreshWantOptions() {
    const cur = $('areaArea').value;
    const layer = layerOf(cur);
    const list = (layer === '地上' ? GROUND_AREAS : layer === '地下' ? UNDERGROUND_AREAS : [])
      .filter(a => a !== cur);
    const ph = list.length ? '请选择意向区域' : '请先选择当前车位区域';

    const el1 = $('want1');
    const old1 = el1.value;
    fillAreaSelect(el1, list, ph);
    if (list.indexOf(old1) >= 0) el1.value = old1;

    const el2 = $('want2');
    const old2 = el2.value;
    fillAreaSelect(el2, list, list.length ? '不填（只有一个意向区域）' : '请先选择当前车位区域');
    if (list.indexOf(old2) >= 0) el2.value = old2;
  }

  /* ---------- 共享池 ---------- */

  async function loadPool() {
    try {
      const res = await fetch(API + '/api/swap/pool', { cache: 'no-store' });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || '加载失败');
      renderPool(d);
    } catch (e) {
      $('poolMeta').textContent = '共享池加载失败：' + e.message;
    }
  }

  function renderPool(d) {
    const rows = (d.pool || []).slice().sort(function (a, b) {
      if (a.layer !== b.layer) return a.layer === '地上' ? -1 : 1;
      return b.in + b.out - (a.in + a.out);
    });
    const tb = $('poolTable').querySelector('tbody');
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="5" class="muted" style="padding:22px 0">还没有人登记，先来登记第一个吧</td></tr>';
    } else {
      tb.innerHTML = rows.map(function (r) {
        const diff = r.in - r.out;
        const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
        const sign = diff > 0 ? '+' : '';
        return '<tr>' +
          '<td class="f" style="text-align:left">' + esc(r.area) + '</td>' +
          '<td>' + esc(r.layer) + '</td>' +
          '<td><b>' + r.out + '</b></td>' +
          '<td><b>' + r.in + '</b></td>' +
          '<td class="' + cls + '">' + sign + diff + '</td>' +
          '</tr>';
      }).join('');
    }
    $('poolSummary').textContent = '共 ' + (d.total || 0) + ' 条有效登记 · ' + (d.matched || 0) + ' 条已匹配';
    $('poolMeta').textContent = '共享池每 2 分钟自动刷新 · 更新于 ' + new Date().toLocaleTimeString('zh-CN');
  }

  /* ---------- 截图压缩 ---------- */

  async function compressImage(file) {
    const MAX = 1280;
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (e) {
      bitmap = await new Promise(function (res, rej) {
        const img = new Image();
        img.onload = function () { res(img); };
        img.onerror = rej;
        img.src = URL.createObjectURL(file);
      });
    }
    const w0 = bitmap.width || bitmap.naturalWidth;
    const h0 = bitmap.height || bitmap.naturalHeight;
    let w = w0, h = h0;
    if (Math.max(w, h) > MAX) {
      const r = MAX / Math.max(w, h);
      w = Math.round(w * r);
      h = Math.round(h * r);
    }
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    return await new Promise(function (res) { cv.toBlob(res, 'image/jpeg', 0.78); });
  }

  function previewShot(file) {
    if (!file) { $('shotPreview').hidden = true; return; }
    const url = URL.createObjectURL(file);
    $('shotImg').src = url;
    $('shotInfo').textContent = file.name + ' · ' + Math.round(file.size / 1024) + ' KB';
    $('shotPreview').hidden = false;
  }

  /* ---------- 提交登记 ---------- */

  $('shot').addEventListener('change', function () {
    previewShot(this.files && this.files[0]);
  });

  $('areaArea').addEventListener('change', refreshWantOptions);

  $('swapForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const msg = $('formMsg');
    msg.className = 'form-msg';
    msg.textContent = '';

    const area = $('areaArea').value;
    const emp = $('emp').value.trim();
    const want1 = $('want1').value;
    const want2 = $('want2').value;
    const code = $('code').value.trim();
    const note = $('note').value.trim();
    const file = $('shot').files && $('shot').files[0];

    if (!area) return fail(msg, '请选择当前车位区域');
    if (!/^\d{8}$/.test(emp)) return fail(msg, '工号必须是 8 位数字');
    if (!want1) return fail(msg, '请选择意向区域 1');
    if (want2 && want1 === want2) return fail(msg, '意向区域 1 与意向区域 2 不能相同');
    if (!/^\d{4}$/.test(code)) return fail(msg, '防护码必须是 4 位数字');
    if (!file) return fail(msg, '请上传摇中车位的截图');

    const btn = $('btnSubmit');
    btn.disabled = true;
    btn.textContent = '提交中…';

    try {
      const blob = await compressImage(file);
      const fd = new FormData();
      fd.append('area', area);
      fd.append('emp', emp);
      fd.append('want1', want1);
      fd.append('want2', want2);
      fd.append('code', code);
      fd.append('note', note);
      fd.append('shot', blob, 'shot.jpg');

      const res = await fetch(API + '/api/swap/register', { method: 'POST', body: fd });
      const d = await res.json();
      if (!d.ok) { fail(msg, d.error || '提交失败'); btn.disabled = false; btn.textContent = '提交登记'; return; }

      msg.className = 'form-msg ok';
      msg.innerHTML = '登记成功（' + esc(d.registeredAt) + '）。<br>' +
        '请牢记你的<b>工号 ' + esc(emp) + '</b> 与<b>防护码 ' + esc(code) + '</b>，' +
        '凭此可随时查询匹配情况或删除本条登记。' +
        (d.matched && d.matched.length ? renderMatchBlock(d.matched, '已找到互相匹配的同事') : '');

      $('swapForm').reset();
      $('shotPreview').hidden = true;
      initAreaOptions();
      loadPool();
    } catch (err) {
      fail(msg, '提交失败：' + err.message);
    }
    btn.disabled = false;
    btn.textContent = '提交登记';
  });

  $('btnReset').addEventListener('click', function () {
    $('swapForm').reset();
    $('shotPreview').hidden = true;
    $('formMsg').textContent = '';
    initAreaOptions();
  });

  function fail(el, text) {
    el.className = 'form-msg err';
    el.textContent = text;
  }

  function renderMatchBlock(list, title) {
    return '<div class="match-box"><b>' + esc(title) + '</b>' +
      list.map(function (m) {
        return '<div class="match-item">' +
          '对方车位区域：<b>' + esc(m.area) + '</b>' +
          '　对方工号：<b>' + esc(m.emp) + '</b>' +
          '　登记时间：' + esc(m.registeredAt) +
          (m.note ? '<br>备注：' + esc(m.note) : '') +
          '</div>';
      }).join('') + '</div>';
  }

  /* ---------- 查询匹配 ---------- */

  $('btnQuery').addEventListener('click', async function () {
    const box = $('queryBox');
    const emp = $('qEmp').value.trim();
    const code = $('qCode').value.trim();
    if (!/^\d{8}$/.test(emp)) { box.innerHTML = '<p class="muted small">请填写 8 位工号</p>'; return; }
    if (!/^\d{4}$/.test(code)) { box.innerHTML = '<p class="muted small">请填写 4 位防护码</p>'; return; }
    box.innerHTML = '<p class="muted small">查询中…</p>';
    try {
      const res = await fetch(API + '/api/swap/match?emp=' + encodeURIComponent(emp) + '&code=' + encodeURIComponent(code), { cache: 'no-store' });
      const d = await res.json();
      if (!d.ok) { box.innerHTML = '<p class="form-msg err">' + esc(d.error || '查询失败') + '</p>'; return; }
      let html = '';
      html += '<div class="my-records"><b>我的登记（' + d.mine.length + '）</b>' +
        d.mine.map(function (m) {
          return '<div class="my-item">' +
            esc(m.registeredAt) + '　' + esc(m.area) + ' → ' + esc(m.want1) +
            (m.want2 ? ' / ' + esc(m.want2) : '') +
            (m.matched ? '　<span class="badge blue">已匹配</span>' : '') +
            (m.note ? '<br><span class="muted">备注：' + esc(m.note) + '</span>' : '') +
            '</div>';
        }).join('') + '</div>';
      if (d.matched && d.matched.length) {
        html += renderMatchBlock(d.matched, '互相匹配（可互换）');
      } else {
        html += '<p class="muted small">暂时还没有与你互相匹配的登记，可到共享池看看各区域的供需。</p>';
      }
      if (d.incoming && d.incoming.length) {
        html += renderMatchBlock(d.incoming, '有人想换进你所在的区域（尚未双向匹配）');
      }
      box.innerHTML = html;
    } catch (e) {
      box.innerHTML = '<p class="form-msg err">查询失败：' + esc(e.message) + '</p>';
    }
  });

  /* ---------- 取消登记 ---------- */

  $('btnRemove').addEventListener('click', async function () {
    const msg = $('removeMsg');
    const emp = $('dEmp').value.trim();
    const code = $('dCode').value.trim();
    msg.className = 'form-msg';
    msg.textContent = '';
    if (!/^\d{8}$/.test(emp)) return fail(msg, '请填写 8 位工号');
    if (!/^\d{4}$/.test(code)) return fail(msg, '请填写 4 位防护码');
    try {
      const res = await fetch(API + '/api/swap/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emp: emp, code: code }),
      });
      const d = await res.json();
      if (!d.ok) return fail(msg, d.error || '删除失败');
      msg.className = 'form-msg ok';
      msg.textContent = '已删除 ' + d.removed + ' 条登记信息。';
      $('dEmp').value = ''; $('dCode').value = '';
      loadPool();
    } catch (e) {
      fail(msg, '删除失败：' + e.message);
    }
  });

  /* ---------- 初始化 ---------- */

  $('btnRefresh').addEventListener('click', loadPool);
  initAreaOptions();
  loadPool();
  setInterval(loadPool, 120000);
})();
