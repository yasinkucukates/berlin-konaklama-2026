/* Public access is restricted by the server to the Berlin guide's anonymous favorites. */
(function () {
  'use strict';
  const hex = bytes => Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
  const randomHex = () => hex(crypto.getRandomValues(new Uint8Array(16)));
  let voter=null;
  function voterId(){ if(voter)return voter; try { voter=localStorage.getItem('berlin-anonymous-voter'); if(!/^[0-9a-f]{32}$/.test(voter||'')){voter=randomHex();localStorage.setItem('berlin-anonymous-voter',voter);} } catch(_){throw new Error('Beğeni için tarayıcı depolamasına izin verin');} return voter; }
  const same = (a, b) => a.id === b.id && a.checkIn === b.checkIn && a.checkOut === b.checkOut;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  // Apps Script web apps often need 2-6 s per call after a quiet spell.
  const LIST_TIMEOUT_MS = 10000;
  const WRITE_TIMEOUT_MS = 12000;
  const VERIFY_WINDOW_MS = 20000;

  function validateItem(item) {
    if (!item || typeof item.id !== 'string' || !/^[a-z0-9-]{1,128}$/.test(item.id) ||
        typeof item.checkIn !== 'string' || typeof item.checkOut !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(item.checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(item.checkOut) ||
        item.checkIn >= item.checkOut) throw new Error('Geçersiz favori bilgisi');
    return {id: item.id, checkIn: item.checkIn, checkOut: item.checkOut, count: Number.isInteger(item.count) ? item.count : 0, mine: item.mine===true, legacy:item.legacy===true};
  }

  window.createBerlinFavoritesTransport = function (endpoint) {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' ||
        !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.search || url.hash) {
      throw new Error('Geçersiz ortak favori adresi');
    }
    function requireSecureContext() {
      if (location.protocol !== 'https:' || !window.crypto || !crypto.getRandomValues) {
        throw new Error('Ortak favoriler için güvenli bağlantı gerekli');
      }
    }

    function jsonp(params, timeoutMs) {
      return new Promise((resolve, reject) => {
        const callback = 'BF_' + randomHex();
        const script = document.createElement('script');
        const target = new URL(url);
        for (const [key, value] of Object.entries({...params, callback})) target.searchParams.set(key, value);
        let done = false;
        const timer = setTimeout(() => finish(new Error('Ortak favoriler yanıt vermedi')), timeoutMs);
        function finish(error, result) {
          if (done) return;
          done = true;
          clearTimeout(timer);
          delete window[callback];
          script.remove();
          error ? reject(error) : resolve(result);
        }
        window[callback] = result => finish(null, result);
        script.onerror = () => finish(new Error('Ortak favorilere ulaşılamadı'));
        script.referrerPolicy = 'no-referrer';
        script.src = target.href;
        document.head.appendChild(script);
      });
    }

    async function list() {
      requireSecureContext();
      const data = await jsonp({op:'public-list', scope:'berlin-guide-v1', voter:voterId()}, LIST_TIMEOUT_MS);
      if (!data || data.ok !== true || !Array.isArray(data.items) || data.items.length > 300) {
        throw new Error('Ortak favoriler doğrulanamadı');
      }
      return data.items.map(validateItem);
    }

    // A plain (CORS) POST: Apps Script answers through googleusercontent.com
    // with Access-Control-Allow-Origin, so the page can read {"ok":true|false}
    // in about a second. Measured on the live endpoint on 7 November 2026.
    // 'ok' = written, 'rejected' = the server refused (listing not on its list,
    // vote limit, or a busy lock), 'unknown' = no readable answer; the server
    // may still have applied it, so the list decides.
    async function send(op, input) {
      requireSecureContext();
      const item = validateItem(input);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WRITE_TIMEOUT_MS);
      try {
        const response = await fetch(url.href, {method: 'POST', referrerPolicy: 'no-referrer', body: JSON.stringify({op:op==='add'?'vote':'unvote', scope:'berlin-guide-v1', item, voter:voterId()}), signal: controller.signal});
        const data = await response.json().catch(() => null);
        return data && data.ok === true ? 'ok' : data && data.ok === false ? 'rejected' : 'unknown';
      } catch (_) {
        return 'unknown';
      } finally {
        clearTimeout(timer);
      }
    }

    // Older callers: write, then return the confirmed list.
    async function change(op, input) {
      const item = validateItem(input);
      const wanted = op === 'add';
      const outcome = await send(op, item);
      if (outcome === 'rejected') throw new Error('Sunucu işlemi kabul etmedi');
      const started = Date.now();
      for (let attempt = 0; ; attempt++) {
        try {
          const items = await list();
          if (items.some(x => same(x, item) && x.mine) === wanted) return items;
        } catch (_) { /* Retry until the window closes. */ }
        if (Date.now() - started >= VERIFY_WINDOW_MS) break;
        await wait(Math.min(1000 * 2 ** attempt, 4000));
      }
      throw new Error('İşlem doğrulanamadı; listeyi yenileyin');
    }

    return {list, send, add: item => change('add', item), remove: item => change('remove', item)};
  };
})();
