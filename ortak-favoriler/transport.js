/* Public access is restricted by the server to the Berlin guide's anonymous favorites. */
(function () {
  'use strict';
  const hex = bytes => Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
  const randomHex = () => hex(crypto.getRandomValues(new Uint8Array(16)));
  let voter=null;
  function voterId(){ if(voter)return voter; try { voter=localStorage.getItem('berlin-anonymous-voter'); if(!/^[0-9a-f]{32}$/.test(voter||'')){voter=randomHex();localStorage.setItem('berlin-anonymous-voter',voter);} } catch(_){throw new Error('Beğeni için tarayıcı depolamasına izin verin');} return voter; }
  const same = (a, b) => a.id === b.id && a.checkIn === b.checkIn && a.checkOut === b.checkOut;

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
      const data = await jsonp({op:'public-list', scope:'berlin-guide-v1', voter:voterId()}, 5500);
      if (!data || data.ok !== true || !Array.isArray(data.items) || data.items.length > 100) {
        throw new Error('Ortak favoriler doğrulanamadı');
      }
      return data.items.map(validateItem);
    }

    async function change(op, input) {
      requireSecureContext();
      const item = validateItem(input);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      try {
        await fetch(url.href, {method: 'POST', mode: 'no-cors', referrerPolicy: 'no-referrer', body: JSON.stringify({op:op==='add'?'vote':'unvote', scope:'berlin-guide-v1', item, voter:voterId()}), signal: controller.signal});
      } catch (_) {
        throw new Error('İşlemin sonucu bilinmiyor; listeyi yenileyin');
      } finally {
        clearTimeout(timer);
      }
      const items = await list();
      if (items.some(x => same(x, item) && x.mine) !== (op === 'add')) {
        throw new Error('İşlem doğrulanamadı; listeyi yenileyin');
      }
      return items;
    }

    return {list, add: item => change('add', item), remove: item => change('remove', item)};
  };
})();
