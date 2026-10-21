// 站点访问统计埋点：页面访问 + 点击采集（异步上报，不影响页面功能）
(function () {
  'use strict';
  const ENDPOINT = 'https://yaohao-stats.pages.dev/api/track';

  // 会话 id（存 localStorage，用于同一浏览器的 UV 去重）
  let sid = 'anon';
  try {
    sid = localStorage.getItem('yh_sid') || '';
    if (!sid) {
      sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('yh_sid', sid);
    }
  } catch (e) { /* 隐私模式下忽略 */ }

  function send(payload) {
    try {
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }));
        return;
      }
      fetch(ENDPOINT, { method: 'POST', body: body, keepalive: true, mode: 'cors' }).catch(function () {});
    } catch (e) { /* 静默失败，不影响功能 */ }
  }
  // 1) 页面访问
  send({
    type: 'pv',
    path: location.pathname + location.search,
    sid: sid,
    ref: document.referrer || ''
  });

  // 2) 点击采集（捕获阶段，先于业务逻辑）
  document.addEventListener('click', function (e) {
    const t = e.target && e.target.closest
      ? e.target.closest('button, a, .btn, .chip, .seg-btn, select, input, textarea, [id]')
      : null;
    let el = '';
    if (t) {
      el = t.id || (typeof t.className === 'string' ? t.className : '') || t.tagName;
    } else if (e.target) {
      el = e.target.tagName || '';
    }
    send({
      type: 'click',
      path: location.pathname,
      sid: sid,
      el: String(el).slice(0, 60),
      txt: t ? (t.textContent || '').trim().slice(0, 40) : '',
      x: window.innerWidth ? e.clientX / window.innerWidth : 0,
      y: window.innerHeight ? e.clientY / window.innerHeight : 0,
      vw: window.innerWidth,
      vh: window.innerHeight
    });
  }, true);
})();
