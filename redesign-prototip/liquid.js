(() => {
  'use strict';
  // Photos after the fifth are stored on the grid as data (data-more) and
  // turned into links only when a gallery needs them. Images get no src here:
  // the card carousel loads them as it approaches, the large gallery uses the
  // original address (data-photo-url).
  window.BerlinExpandPhotos = window.BerlinExpandPhotos || (grid => {
    if (!grid || !grid.dataset.more) return false;
    let more = [];
    try { more = JSON.parse(grid.dataset.more); } catch (_) { more = []; }
    delete grid.dataset.more;
    const title = grid.closest('.stay-card')?.querySelector('.card-title h3, .card-title h4')?.textContent.trim() || 'Konaklama';
    const fragment = document.createDocumentFragment();
    more.forEach(item => {
      if (!Array.isArray(item)) return;
      const [label, url, thumb] = item.map(value => String(value || ''));
      if (!/^https:\/\//.test(url)) return;
      const link = document.createElement('a');
      link.className = 'extra-photo'; link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.dataset.photoUrl = url; link.dataset.label = label;
      link.setAttribute('aria-label', `${title}: ${label} Fotoğrafını Aç`);
      const img = document.createElement('img');
      img.alt = `${title}: ${label}`; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      img.dataset.gmSrc = /^https:\/\//.test(thumb) ? thumb : url;
      link.append(img); fragment.append(link);
    });
    grid.append(fragment);
    return true;
  });

  // Large-view tabs. Without JavaScript every panel remains visible in order.
  const activateCardTab = (card, name = 'overview', reveal = false) => {
    const more = card && card.querySelector('.card-more');
    if (!more) return;
    const tabs = Array.from(more.querySelectorAll('.detail-tab'));
    if (!tabs.some(tab => tab.dataset.tab === name)) name = 'overview';
    tabs.forEach(tab => {
      const selected = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    more.querySelectorAll('.detail-panel').forEach(panel => { panel.hidden = panel.dataset.panel !== name; });
    more.dataset.activeTab = name;
    card.querySelectorAll('.fact-tile, .card-alert').forEach(tile => tile.classList.toggle('is-current', tile.dataset.tab === name && name !== 'overview'));
    if (reveal) revealCardTabs(card);
  };
  const revealCardTabs = card => {
    const tabs = card && card.querySelector('.detail-tabs');
    if (!tabs || !tabs.getClientRects().length) return;
    // Only scroll when the tabs sit in the lower part of the view (phones).
    if (tabs.getBoundingClientRect().top < window.innerHeight * 0.45) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    tabs.scrollIntoView({block:'start', behavior:reduced ? 'auto' : 'smooth'});
  };
  window.BerlinCardTabs = {activate:activateCardTab, reveal:revealCardTabs};
  // Daily checks are recorded in Turkey time; show them the same way everywhere.
  const zone = {timeZone:'Europe/Istanbul'};
  const trDay = iso => new Intl.DateTimeFormat('tr-TR', {day:'numeric', month:'long', ...zone}).format(new Date(iso));
  const trDayTime = iso => new Intl.DateTimeFormat('tr-TR', {day:'numeric', month:'long', hour:'2-digit', minute:'2-digit', ...zone}).format(new Date(iso));
  const trDayAt = iso => {
    // Locative suffix for the months of this trip's checks: Kasım’da, Aralık’ta, Ocak’ta.
    const month = Number(new Intl.DateTimeFormat('en', {month:'numeric', ...zone}).format(new Date(iso)));
    const suffix = {11:'’da', 12:'’ta', 1:'’ta', 10:'’da', 9:'’da'}[month];
    return suffix ? trDay(iso) + suffix : trDay(iso) + ' tarihinde';
  };
  // Dated availability. The snapshot embedded at build time shows at once; on the
  // live site the page then reads the daily availability-status.json published
  // next to it, so a daily check appears without rebuilding the page.
  const availabilityNode = document.getElementById('availability-data');
  const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const isTime = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
  const usableAvailability = data => {
    if (!data || data.version !== 1 || !Array.isArray(data.records)) return null;
    // A malformed record is skipped rather than shown as a status.
    return data.records.filter(entry => entry && ['card', 'offer'].includes(entry.scope) && typeof entry.id === 'string' && entry.id &&
      isDay(entry.checkIn) && isDay(entry.checkOut) && [6, 7].includes(entry.adults) && ['available', 'unavailable'].includes(entry.status) &&
      isTime(entry.checkedAt) && typeof entry.sourceUrl === 'string' && entry.sourceUrl.startsWith('https://'))
      .map(entry => !('lastAvailableAt' in entry) || (entry.status === 'unavailable' && isTime(entry.lastAvailableAt) &&
        Date.parse(entry.lastAvailableAt) <= Date.parse(entry.checkedAt)) ? entry : {...entry, lastAvailableAt: undefined});
  };
  // A dated result is evidence only for the number of adults actually checked.
  const partyRecord = (records, match, party) =>
    records.find(entry => match(entry) && entry.adults === party);
  let embeddedAvailability = [];
  try { embeddedAvailability = usableAvailability(JSON.parse(availabilityNode?.textContent || '{}')) || []; } catch (_) {}
  const loadLiveAvailability = () => {
    const source = availabilityNode?.dataset.liveSrc;
    if (!source || !/^https?:$/.test(location.protocol) || typeof fetch !== 'function') return;
    const url = new URL(source, location.href);
    url.searchParams.set('t', String(Date.now()));
    fetch(url.href, {cache:'no-store', credentials:'omit'})
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        const records = usableAvailability(data);
        if (records) document.dispatchEvent(new CustomEvent('berlin-availability', {detail:records}));
      })
      .catch(() => {});
  };

  // Exchange rates. Every ≈ amount carries its source amount and currency; the
  // build writes them at the reference rate, then the page asks for the day's ECB
  // reference rate (last good rate kept for a day without network) and rewrites
  // both the euro and the lira equivalents.
  const fxNote = document.querySelector('.fx-note[data-fx-try]');
  const fxReference = fxNote ? {date:fxNote.dataset.fxDate, TRY:Number(fxNote.dataset.fxTry), USD:Number(fxNote.dataset.fxUsd)} : null;
  const fxUsable = rate => rate && isDay(rate.date) && Number.isFinite(rate.TRY) && rate.TRY > 5 && rate.TRY < 500 &&
    Number.isFinite(rate.USD) && rate.USD > 0.5 && rate.USD < 2;
  const whole = new Intl.NumberFormat('tr-TR', {maximumFractionDigits:0});
  const rateNumber = new Intl.NumberFormat('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:4});
  const rateShort = new Intl.NumberFormat('tr-TR', {minimumFractionDigits:2, maximumFractionDigits:2});
  const fxDay = (day, year) => new Intl.DateTimeFormat('tr-TR', {day:'numeric', month:'long', ...(year ? {year:'numeric'} : {}), timeZone:'UTC'}).format(new Date(day + 'T12:00:00Z'));
  const toEur = (amount, currency, rate) => currency === 'EUR' ? amount : currency === 'TRY' ? amount / rate.TRY : amount / rate.USD;
  function applyFx(rate) {
    document.querySelectorAll('[data-fx-amount]').forEach(node => {
      const amount = Number(node.dataset.fxAmount);
      if (!Number.isFinite(amount)) return;
      const eur = toEur(amount, node.dataset.fxCurrency, rate);
      node.textContent = (node.dataset.fxTo || '').split(',').map(target => target === 'TRY'
        ? `≈ ${whole.format(Math.round(eur * rate.TRY))} TL` : `≈ ${whole.format(Math.round(eur))} €`).join(' · ');
    });
    // Filters and sorting use the euro value; update it only where it was derived
    // from the same lira or dollar total at the reference rate.
    document.querySelectorAll('.stay-card[data-price-eur]').forEach(card => {
      const head = card.querySelector('.card-head .converted-price[data-fx-amount]');
      if (!head || head.dataset.fxCurrency === 'EUR' || !fxReference) return;
      const amount = Number(head.dataset.fxAmount);
      if (!card.dataset.priceEurReference) card.dataset.priceEurReference = card.dataset.priceEur;
      const before = Number(card.dataset.priceEurReference);
      const atReference = toEur(amount, head.dataset.fxCurrency, fxReference);
      if (Number.isFinite(before) && Math.abs(before - atReference) <= atReference * 0.01) card.dataset.priceEur = toEur(amount, head.dataset.fxCurrency, rate).toFixed(2);
    });
    document.querySelectorAll('.fx-rate-short').forEach(node => { node.textContent = `≈ işaretli tutarlar ${fxDay(rate.date)} ECB kuruyla hesaplanır: 1 € = ${rateShort.format(rate.TRY)} TL.`; });
    document.querySelectorAll('.fx-rate-long').forEach(node => { node.textContent = `${fxDay(rate.date, true)} tarihli ECB referans kurları: 1 € = ${rateNumber.format(rate.TRY)} TL; 1 € = ${rateNumber.format(rate.USD)} USD.`; });
    document.dispatchEvent(new Event('berlin-fx'));
  }
  const loadDailyRate = () => {
    if (!fxReference || typeof fetch !== 'function') return;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('berlin-fx-eur') || 'null'); } catch (_) {}
    if (fxUsable(saved) && saved.date > fxReference.date) applyFx(saved);
    fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=TRY,USD', {cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer'})
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        const rate = data && data.base === 'EUR' && data.rates ? {date:data.date, TRY:Number(data.rates.TRY), USD:Number(data.rates.USD)} : null;
        if (!fxUsable(rate) || rate.date < fxReference.date) return;
        try { localStorage.setItem('berlin-fx-eur', JSON.stringify(rate)); } catch (_) {}
        applyFx(rate);
      })
      .catch(() => {});
  };

  document.addEventListener('click', event => {
    const tab = event.target.closest('.detail-tab');
    if (tab) activateCardTab(tab.closest('.stay-card'), tab.dataset.tab);
  });
  document.addEventListener('keydown', event => {
    const tab = event.target.closest && event.target.closest('.detail-tab');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(tab.parentElement.querySelectorAll('.detail-tab'));
    const at = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    activateCardTab(tab.closest('.stay-card'), tabs[next].dataset.tab);
    tabs[next].focus();
  });

  // Optional shared backend adapter. list() returns [{id, checkIn, checkOut}];
  // add(offer) and remove(offer) must atomically update just that offer. No
  // client-side cache is used as a substitute for the shared collection.
  const routeHash = () => {
    const route = location.hash.slice(1).split('?')[0];
    return route.startsWith('fav=') ? '' : route;
  };
  // Shared favorites. A tap changes the heart at once and the vote is sent in
  // the background, one request per card, so cards never wait for each other.
  // Until the shared list confirms it, the choice stays in `pending` (also kept
  // in this browser), so a slow server or a reload never flips the heart back.
  // Only a vote the server keeps refusing, or one it never confirms after
  // several tries, is undone, and the card then says so.
  const favorites = {state:'disconnected', entries:new Set(), busy:false, uncertain:false, pending:new Map(), errors:new Set(),
    metadata:new Map(), mine:new Set(), server:new Map(), serverReadAt:0, inflight:new Map(), waiters:new Map(), lastReadAt:0};
  const offerFromCard = card => ({id:card.dataset.id, checkIn:card.dataset.checkIn, checkOut:card.dataset.checkOut});
  const offerKey = offer => JSON.stringify([offer.id, offer.checkIn, offer.checkOut]);
  const validOffer = offer => offer && typeof offer.id === 'string' && offer.id.length > 0 &&
    typeof offer.checkIn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(offer.checkIn) &&
    typeof offer.checkOut === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(offer.checkOut);
  const adapter = () => {
    const api = window.BerlinFavoritesTransport;
    return api && ['list', 'add', 'remove'].every(method => typeof api[method] === 'function') ? api : null;
  };
  const notifyFavorites = () => document.dispatchEvent(new Event('berlin-favorites-state'));
  // Apps Script needs 1-2 s per call and longer after a quiet spell.
  const READ_TIMEOUT_MS = 15000, WRITE_TIMEOUT_MS = 30000;
  const RESEND_AFTER_MS = [0, 3000, 6000, 12000], MAX_TRIES = RESEND_AFTER_MS.length;
  const PENDING_STORE = 'berlin-favorite-pending-v1', PENDING_MAX_AGE_MS = 6 * 3600 * 1000;
  const timed = async (promise, ms) => {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Favorite service timed out')), ms);
      })]);
    } finally { clearTimeout(timer); }
  };
  const readFavoriteEntries = async api => {
    const items = await timed(Promise.resolve().then(() => api.list()), READ_TIMEOUT_MS);
    if (!Array.isArray(items) || !items.every(validOffer)) throw new Error('Invalid favorites response');
    return items;
  };
  function savePending() {
    try {
      const rows = [...favorites.pending].map(([key, p]) => [key, {offer:p.offer, selected:p.selected, since:p.since}]);
      rows.length ? localStorage.setItem(PENDING_STORE, JSON.stringify(rows)) : localStorage.removeItem(PENDING_STORE);
    } catch (_) { /* Private mode: the choice still syncs while the page is open. */ }
  }
  function loadPending() {
    try {
      const rows = JSON.parse(localStorage.getItem(PENDING_STORE) || '[]');
      for (const [key, p] of Array.isArray(rows) ? rows : []) {
        if (p && validOffer(p.offer) && offerKey(p.offer) === key && typeof p.selected === 'boolean' &&
            Number.isFinite(p.since) && Date.now() - p.since < PENDING_MAX_AGE_MS) {
          favorites.pending.set(key, {offer:p.offer, selected:p.selected, since:p.since, tries:0, lastSent:0, settledAt:0, written:false});
        }
      }
    } catch (_) { /* Ignore a damaged entry. */ }
  }
  // What the page shows: the last shared list with this browser's unconfirmed choices on top.
  function rebuildFavorites() {
    const meta = new Map([...favorites.server].map(([key, row]) => [key, {...row}]));
    for (const [key, p] of favorites.pending) {
      const row = meta.get(key) || {...p.offer, count:0, mine:false, legacy:false};
      if (row.mine !== p.selected) meta.set(key, {...row, mine:p.selected, count:Math.max(0, row.count + (p.selected ? 1 : -1))});
    }
    favorites.metadata = meta;
    favorites.mine = new Set([...meta].filter(([, row]) => row.mine).map(([key]) => key));
    favorites.entries = new Set([...meta].filter(([, row]) => row.count || row.legacy).map(([key]) => key));
    favorites.uncertain = favorites.errors.size > 0;
  }
  function settle(key) {
    favorites.pending.delete(key);
    (favorites.waiters.get(key) || []).forEach(resolve => resolve());
    favorites.waiters.delete(key);
  }
  function failFavorite(key) {
    settle(key);
    favorites.errors.add(key);
    setTimeout(() => { favorites.errors.delete(key); rebuildFavorites(); notifyFavorites(); }, 20000);
  }
  // A choice is confirmed by a list read that started after its last write
  // finished; an older read can't tell whether that write landed yet. A repeat
  // of the same choice still in flight can't change the result, so it doesn't
  // hold the confirmation back; an opposite one does.
  function confirmFromServer() {
    for (const [key, p] of favorites.pending) {
      if (favorites.inflight.has(key) && favorites.inflight.get(key) !== p.selected) continue;
      if (favorites.serverReadAt < p.settledAt) continue;
      if (Boolean(favorites.server.get(key)?.mine) === p.selected) settle(key);
      // The server said it was written; stop waiting for the list after a minute.
      else if (p.written && Date.now() - p.settledAt > 60000) settle(key);
    }
  }
  let readTimer = 0, syncTimer = 0, retryDelay = 3000;
  const scheduleRead = ms => { clearTimeout(readTimer); readTimer = setTimeout(() => { if (adapter()) refreshFavorites(); }, ms); };
  const scheduleSync = ms => { clearTimeout(syncTimer); syncTimer = setTimeout(syncFavorites, ms); };
  function syncFavorites() {
    const api = adapter();
    if (!api) return;
    let wait = Infinity;
    for (const [key, p] of favorites.pending) {
      if (favorites.inflight.has(key) || p.written) continue;
      if (p.tries >= MAX_TRIES) {
        // Give the list one more look after the last try before giving up.
        const left = p.settledAt + 8000 - Date.now();
        if (left <= 0) failFavorite(key); else wait = Math.min(wait, left);
        continue;
      }
      const due = p.lastSent + RESEND_AFTER_MS[p.tries] - Date.now();
      if (p.tries && due > 0) { wait = Math.min(wait, due); continue; }
      sendFavorite(api, key, p);
    }
    savePending(); rebuildFavorites(); notifyFavorites();
    if (Number.isFinite(wait)) scheduleSync(wait + 50);
  }
  async function sendFavorite(api, key, p) {
    const selected = p.selected;
    favorites.inflight.set(key, selected);
    p.tries++; p.lastSent = Date.now();
    let outcome = 'unknown';
    try {
      if (typeof api.send === 'function') {
        outcome = await timed(Promise.resolve().then(() => api.send(selected ? 'add' : 'remove', p.offer)), WRITE_TIMEOUT_MS);
      } else {
        // Preview adapter: add/remove resolve with the confirmed list.
        const items = await timed(Promise.resolve().then(() => selected ? api.add(p.offer) : api.remove(p.offer)), WRITE_TIMEOUT_MS);
        outcome = 'ok';
        if (Array.isArray(items) && items.every(validOffer)) { favorites.server = new Map(items.map(x => [offerKey(x), x])); favorites.serverReadAt = Date.now(); }
      }
    } catch (_) { outcome = 'unknown'; }
    favorites.inflight.delete(key);
    p.settledAt = Date.now();
    if (favorites.pending.get(key) === p && p.selected === selected) {
      if (outcome === 'ok') p.written = true;
      else if (outcome === 'rejected' && p.tries >= MAX_TRIES - 1) { failFavorite(key); }
    }
    // A newer tap on the same card is sent right after this one finishes.
    confirmFromServer();
    scheduleSync(0);
    scheduleRead(outcome === 'ok' ? 400 : 1500);
  }
  async function refreshFavorites() {
    const api = adapter();
    if (!api) { favorites.state = 'disconnected'; favorites.entries.clear(); notifyFavorites(); return; }
    if (favorites.busy) { scheduleRead(1000); return; }
    favorites.busy = true;
    if (favorites.state !== 'ready') favorites.state = 'loading';
    notifyFavorites();
    const startedAt = Date.now();
    try {
      const entries = await readFavoriteEntries(api);
      favorites.server = new Map(entries.map(x => [offerKey(x), x]));
      favorites.serverReadAt = startedAt; favorites.lastReadAt = Date.now();
      favorites.state = 'ready'; retryDelay = 3000;
      confirmFromServer();
    } catch (_) {
      if (favorites.state !== 'ready') favorites.state = 'error';
      scheduleRead(retryDelay); retryDelay = Math.min(retryDelay * 2, 30000);
    } finally {
      favorites.busy = false;
      rebuildFavorites(); notifyFavorites();
      // Written but not yet visible in the list: look again shortly.
      if ([...favorites.pending.values()].some(p => p.written || p.tries)) {
        scheduleRead(2500); scheduleSync(0);
      }
    }
  }
  function toggleFavorite(offer) {
    if (!adapter() || !validOffer(offer)) return;
    const key = offerKey(offer);
    const selected = !favorites.mine.has(key);
    favorites.errors.delete(key);
    const p = favorites.pending.get(key);
    if (p) Object.assign(p, {selected, since:Date.now(), tries:0, lastSent:0, written:false});
    else favorites.pending.set(key, {offer:{id:offer.id, checkIn:offer.checkIn, checkOut:offer.checkOut}, selected, since:Date.now(), tries:0, lastSent:0, settledAt:0, written:false});
    savePending(); rebuildFavorites(); notifyFavorites(); // The heart changes now.
    scheduleSync(0);
    // Resolves when the shared list agrees (or the vote is given up), so the
    // clicked card can stay in place while the order settles.
    return new Promise(resolve => {
      const list = favorites.waiters.get(key) || [];
      list.push(resolve); favorites.waiters.set(key, list);
      setTimeout(resolve, 30000);
    });
  }
  loadPending();

  document.querySelectorAll('[data-berlin-view]').forEach(root => {
  const byId = name => root.querySelector(`[id="${root.dataset.idPrefix || ''}${name}"]`);
  root.classList.add('js');
  const sort = byId('sort');
  const status = byId('filter-status');
  const favoriteFilter = byId('favorite-filter');
  const favoriteStatus = byId('favorites-status');
  const favoriteRetry = byId('favorites-retry');
  if (favoriteStatus && location.protocol === 'https:') {
    const share = document.createElement('button');
    share.type = 'button';
    share.textContent = 'Site Bağlantısını Kopyala';
    share.setAttribute('aria-label', 'Ortak favorilerin çalıştığı site bağlantısını kopyala');
    const feedback = document.createElement('span');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    favoriteStatus.parentElement.append(share, feedback);
    share.addEventListener('click', async () => {
      const url = new URL(location.href);
      const release = document.querySelector('meta[name="berlin-release"]')?.getAttribute('content') || '';
      if (/^[a-f0-9]{16}$/.test(release)) url.searchParams.set('v', release);
      // The public, anonymous list no longer requires a private group token.
      url.hash = '';
      const link = url.toString();
      try {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(link);
        feedback.textContent = 'Bağlantı kopyalandı. Grubunla paylaşabilirsin.';
      } catch (_) {
        let field = favoriteStatus.parentElement.querySelector('.group-link-field');
        if (!field) {
          field = document.createElement('input');
          field.className = 'group-link-field';
          field.readOnly = true;
          field.setAttribute('aria-label', 'Kopyalanacak grup bağlantısı');
          favoriteStatus.parentElement.append(field);
        }
        field.value = link;
        field.focus();
        field.select();
        feedback.textContent = 'Bağlantıyı seçip kopyalayın.';
      }
    });
  }
  let favoritesOnly = false;
  const cards = Array.from(root.querySelectorAll('.stay-card'));
  const groups = Array.from(root.querySelectorAll('.group'));
  const guestFilter = root.querySelector('.filter-guests');
  const capacityFilter = root.querySelector('.filter-capacity');
  const priceFilter = root.querySelector('.filter-price');
  const travelFilter = root.querySelector('.filter-travel');
  const bedsFilter = root.querySelector('.filter-beds');
  const roomsFilter = root.querySelector('.filter-rooms');
  const availabilityFilter = root.querySelector('.filter-availability');
  const filterPanel = root.querySelector('.filter-panel');
  const mobileFilterButton = root.querySelector('.mobile-filter-toggle');
  const filterResults = root.querySelector('.filter-results');
  const resultsContent = root.querySelector('.results-content');
  let availabilitySummary = null;
  if (resultsContent) {
    availabilitySummary = document.createElement('div');
    availabilitySummary.className = 'availability-summary';
    availabilitySummary.setAttribute('role', 'status');
    availabilitySummary.hidden = true;
    availabilitySummary.innerHTML = '<b class="sum-date"></b><button type="button" class="sum-ok" data-choice="available" aria-pressed="false"></button><button type="button" class="sum-no" data-choice="unavailable" aria-pressed="false"></button><button type="button" class="sum-missed" data-choice="missed" aria-pressed="false" title="Önce müsait görünüp sonraki kontrolde kapanan ilanlar"></button><span class="sum-rest"></span>';
    resultsContent.prepend(availabilitySummary);
    // Each count opens that group at once; pressing it again shows all again.
    availabilitySummary.addEventListener('click', event => {
      const button = event.target.closest('button[data-choice]');
      const select = root.querySelector('.filter-availability');
      if (!button || !select) return;
      select.value = select.value === button.dataset.choice ? 'all' : button.dataset.choice;
      applyFilters(); if (sort) applySort();
    });
  }
  // Open filters are named above the results, each with its own remove button.
  let activeFilterBar = null;
  if (resultsContent) {
    activeFilterBar = document.createElement('div');
    activeFilterBar.className = 'active-filters';
    activeFilterBar.setAttribute('role', 'group');
    activeFilterBar.setAttribute('aria-label', 'Açık filtreler');
    activeFilterBar.hidden = true;
    resultsContent.prepend(activeFilterBar);
  }
  const filterValues = [capacityFilter, priceFilter, travelFilter, bedsFilter, roomsFilter, availabilityFilter].filter(Boolean);
  const knownNumber = value => value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  let availabilityRecords = embeddedAvailability;
  let favoriteAnchor = null;
  root.addEventListener('pointerover', event => {
    const detail = event.target.closest('.caution-popover');
    if (detail && event.pointerType === 'mouse' && !detail.contains(event.relatedTarget)) detail.open = true;
  });
  root.addEventListener('pointerout', event => {
    const detail = event.target.closest('.caution-popover');
    if (detail && event.pointerType === 'mouse' && !detail.contains(event.relatedTarget) && !detail.contains(document.activeElement)) detail.open = false;
  });
  root.addEventListener('click', event => {
    root.querySelectorAll('.caution-popover[open]').forEach(detail => { if (!detail.contains(event.target)) detail.open = false; });
  });
  cards.forEach(card => {
    card.dataset.planGroup = (card.closest('.group')?.id || '').replace(/^p[67]-/, '');
    if (card.closest('.conditional')) card.dataset.conditional = 'true';
  });
  const applyCapacityEvidence = card => {
    // Only a dated, source-verified maximum may replace an older capacity.
    const capacityEvidence = availabilityRecords.filter(entry => entry.scope === 'card' && entry.id === card.dataset.id && entry.checkIn === card.dataset.checkIn && entry.checkOut === card.dataset.checkOut && Number.isInteger(entry.maxGuests) && entry.maxGuests > 0 && entry.capacityEvidence && entry.capacitySourceUrl).sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0];
    if (capacityEvidence) {
      card.dataset.capacity = String(capacityEvidence.maxGuests);
      const capacityFact = Array.from(card.querySelectorAll('.facts span')).find(span => span.textContent.includes('İlan Kapasitesi'));
      const capacityNumber = capacityFact?.querySelector('b');
      if (capacityNumber) capacityNumber.textContent = String(capacityEvidence.maxGuests);
      card.querySelectorAll('[data-capacity-value]').forEach(node => { node.textContent = String(capacityEvidence.maxGuests); });
      card.querySelectorAll('tr[data-share-people]').forEach(row => {
        const warning = row.querySelector('.share-limit');
        if (warning && Number(row.dataset.sharePeople) <= capacityEvidence.maxGuests) warning.remove();
      });
    }
  };
  cards.forEach(applyCapacityEvidence);
  // Preserve separate offers and favorite identities while displaying a known
  // property only once for each date range.
  const duplicateOffers = new Map();
  cards.forEach(card => {
    const link = card.querySelector('a.listing');
    if (!link) return;
    let url;
    try { url = new URL(link.href); } catch (_) { return; }
    const match = /(^|\.)airbnb\.[^/]+$/i.test(url.hostname) && url.pathname.match(/^\/rooms\/(\d+)/);
    // Booking and Airbnb both publish the same house at Mittelstrasse 11.
    // Group only these exact listing identities, not merely nearby addresses.
    const knownBooking = card.dataset.id === 'idyllisches-haus' && /(^|\.)booking\.com$/i.test(url.hostname) && /\/idyllisches-haus-mitten-in-berlin\./.test(url.pathname);
    const knownAirbnb = card.dataset.id === 'six-house-19794276-full' && match && match[1] === '19794276';
    const identity = knownBooking || knownAirbnb ? 'confirmed-mittelstrasse-11' : match && 'airbnb-' + match[1];
    if (!identity) return;
    const key = [identity, card.dataset.planGroup, card.dataset.checkIn, card.dataset.checkOut].join('|');
    if (!duplicateOffers.has(key)) duplicateOffers.set(key, []);
    duplicateOffers.get(key).push(card);
  });
  const relatedQuotes = [];
  duplicateOffers.forEach(offers => {
    const six = offers.find(card => card.dataset.offerAdults === '6');
    const seven = offers.find(card => card.dataset.offerAdults === '7');
    if (!six || !seven) return;
    const makeRelated = (target, other) => {
      const body = target.querySelector('.card-body');
      if (!body) return null;
      const row = document.createElement('div'); row.className = 'related-quote'; row.hidden = true;
      const text = document.createElement('span');
      const source = /booking\.com/i.test(other.querySelector('a.listing')?.href || '') ? 'Booking' : 'Airbnb';
      text.textContent = `Aynı ev · ${source}, ${other.dataset.offerAdults} kişilik önceki teklif: ${other.querySelector('.amount strong')?.textContent || 'Fiyat teyitsiz'}. Güncel durumu kontrol edin.`;
      const open = document.createElement('button'); open.type = 'button'; open.className = 'related-offer-open';
      open.textContent = 'Teklifi Gör';
      open.dataset.offerId = other.dataset.id; open.dataset.checkIn = other.dataset.checkIn; open.dataset.checkOut = other.dataset.checkOut;
      row.append(text, open); body.prepend(row);
      return row;
    };
    const sixRow = makeRelated(six, seven), sevenRow = makeRelated(seven, six);
    if (sixRow && sevenRow) relatedQuotes.push({six, seven, sixRow, sevenRow});
  });
  const newFilter = byId('new-filter');
  const newRow = byId('new-filter-row');
  const newStatus = byId('new-filter-status');
  if (newRow) newRow.hidden = !cards.some(card => card.dataset.new === 'true');
  let newOnly = false;
  const setNewOnly = enabled => {
    newOnly = enabled; root.dataset.newOnly = String(enabled);
    newFilter?.setAttribute('aria-pressed', String(enabled));
    if (newStatus && !enabled) newStatus.textContent = '';
  };
  const homes=new Map(cards.map(card=>[card,card.parentElement]));
  const favoritesSection=document.createElement('section');favoritesSection.className='group group-favorites';favoritesSection.hidden=true;favoritesSection.innerHTML='<div class=section-heading><h2>Ortak Favoriler</h2><p>Seçili sıralama ve beğeniler kullanılır. Aynı tarayıcıdan bir beğeni sayılır; isim gösterilmez.</p></div><div class=card-grid></div>';root.querySelector('.groups').prepend(favoritesSection);
  const favoriteGrid=favoritesSection.querySelector('.card-grid');
  const groupLinks = Array.from(root.querySelectorAll('.group-nav a'));
  const bestButtons = Array.from(root.querySelectorAll('.best-choice'));
  const allPlanId = 'hepsi';
  let selectedGroup = null, activeBest = '';
  const pairSection = byId('villa-daire');
  const splitLayout = pairSection?.querySelector('.split-layout');
  const planPanels = pairSection ? Array.from(pairSection.children).filter(el => el.classList.contains('pairings')) : [];
  const viewChoice = root.querySelector('.view-choice');
  const toolbar = root.querySelector('.toolbar');
  const mapPanel = byId('map-panel');
  const narrow = window.matchMedia('(max-width:639px)');
  const placeControls = () => {
    if (viewChoice && toolbar && mapPanel) { if (narrow.matches) toolbar.append(viewChoice); else mapPanel.before(viewChoice); }
    if (splitLayout && planPanels.length) { if (narrow.matches) splitLayout.after(...planPanels); else splitLayout.before(...planPanels); }
  };
  placeControls();
  if (narrow.addEventListener) narrow.addEventListener('change', placeControls); else narrow.addListener(placeControls);
  const setCurrentGroup = (id, force = false) => {
    if (!groupLinks.some(link => link.hash === `#${id}`)) return;
    const previous = groupLinks.find(link => link.getAttribute('aria-current') === 'location')?.hash.slice(1);
    groupLinks.forEach(link => {
      if (link.hash === `#${id}`) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    if (force || previous !== id) root.dispatchEvent(new CustomEvent('group-current-changed', {bubbles:true, detail:{id:activeBest || id}}));
  };
  const selectPlan = (id, best = '') => {
    const target = groups.find(section => section.id === id) || null;
    selectedGroup = target; activeBest = best; root.dataset.activeBest = best;
    bestButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.bestPlan === best)));
    groups.forEach(section => { section.hidden = Boolean(target) && section !== target; });
    const current = target?.id || allPlanId;
    setCurrentGroup(current, true);
    groupLinks.forEach(link => { link.setAttribute('aria-selected', String(link.hash === '#' + current)); });
  };
  selectPlan(routeHash().replace(/^p6-/, 'p7-'));
  groupLinks.forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    if(favoritesOnly){favoritesOnly=false;favoriteFilter?.setAttribute('aria-pressed','false');}
    selectPlan(link.hash.slice(1));
    history.replaceState(history.state, '', link.hash);
    applyFilters();
  }));
  window.addEventListener('hashchange', () => { selectPlan(routeHash().replace(/^p6-/, 'p7-')); applyFilters(); });
  bestButtons.forEach(button => button.addEventListener('click', () => {
    const best = button.dataset.bestPlan;
    const key = best === 'best-apartment' ? 'full-daire' : 'full-villa';
    const target = groups.find(section => section.id.replace(/^p[67]-/, '') === key);
    if (!target) return;
    favoritesOnly = false; favoriteFilter?.setAttribute('aria-pressed','false');
    selectPlan(target.id, activeBest === best ? '' : best);
    history.replaceState(history.state, '', '#' + target.id);
    applyFilters();
  }));
  newFilter?.addEventListener('click', () => {
    favoritesOnly = false; favoriteFilter?.setAttribute('aria-pressed','false');
    setNewOnly(!newOnly);
    applyFilters();
  });
  root.querySelectorAll('.best-reset').forEach(button => button.addEventListener('click', () => {
    favoritesOnly = false; favoriteFilter?.setAttribute('aria-pressed','false');
    selectPlan(button.closest('.group').id); applyFilters();
  }));
  root.querySelectorAll('.show-split-houses').forEach(button => button.addEventListener('click', () => {
    const target = byId('villa-daire');
    if (!target) return;
    favoritesOnly = false; favoriteFilter?.setAttribute('aria-pressed', 'false');
    selectPlan(target.id); history.replaceState(history.state, '', '#' + target.id); applyFilters();
  }));
  function applyFilters() {
    if (!favoritesOnly) for(const [card,home] of homes)if(card.parentElement===favoriteGrid)home.append(card);
    favoritesSection.hidden=!favoritesOnly;
    const party = guestFilter?.value === '7' ? 7 : 6;
    const hasExtraFilters = filterValues.some(control => control.value !== 'all');
    const filtering = favoritesOnly || activeBest !== '' || newOnly || hasExtraFilters;
    root.querySelectorAll('tr[data-share-people]').forEach(row => { row.hidden = Number(row.dataset.sharePeople) !== party; });
    const houseHasBest = cards.some(card => card.dataset.planGroup === 'full-villa' && (card.dataset.bestEligible === 'true' || card.dataset.bestCandidate === 'true') && (party === 6 || knownNumber(card.dataset.normalBeds) >= party));
    const showHouseAlternatives = activeBest === 'best-house' && !houseHasBest;
    cards.forEach(card => {
      const favoriteMatch = !favoritesOnly || favorites.entries.has(offerKey(offerFromCard(card)));
      const newMatch = !newOnly || card.dataset.new === 'true';
      const capacity = knownNumber(card.dataset.capacity);
      const price = knownNumber(card.dataset.priceEur);
      const travel = knownNumber(card.dataset.tresorCarMin);
      const beds = knownNumber(card.dataset.normalBeds);
      const rooms = knownNumber(card.dataset.rooms);
      const guestMatch = !capacityFilter || capacityFilter.value === 'all' ||
        (capacity !== null && (capacityFilter.value === '6' ? capacity === 6 : capacity >= 7));
      const priceMatch = !priceFilter || priceFilter.value === 'all' || (price !== null && price <= Number(priceFilter.value));
      const travelMatch = !travelFilter || travelFilter.value === 'all' || (travel !== null && travel <= Number(travelFilter.value));
      const bedsMatch = !bedsFilter || bedsFilter.value === 'all' || (beds !== null && beds >= party);
      const roomMatch = !roomsFilter || roomsFilter.value === 'all' || (rooms !== null && rooms >= Number(roomsFilter.value));
      const generalMatch = favoriteMatch && newMatch && guestMatch && priceMatch && travelMatch && bedsMatch && roomMatch;
      const bestMatch = ((card.dataset.bestEligible === 'true' || card.dataset.bestCandidate === 'true') && (party === 6 || (beds !== null && beds >= party))) ||
        (activeBest === 'best-apartment' && card.dataset.planGroup === 'full-daire' && card.dataset.bestAlternative === 'true') ||
        (showHouseAlternatives && card.dataset.planGroup === 'full-villa' && card.dataset.bestAlternative === 'true');
      const sameStay = entry => entry.checkIn === card.dataset.checkIn && entry.checkOut === card.dataset.checkOut;
      const status = partyRecord(availabilityRecords, entry => entry.scope === 'card' && entry.id === card.dataset.id && sameStay(entry), party);
      const offerRows = Array.from(card.querySelectorAll('.ruebezahl-table tr[data-source-id]'));
      const offerStatus = row => partyRecord(availabilityRecords, entry => entry.scope === 'offer' && entry.id === row.dataset.sourceId && sameStay(entry), party);
      const allOffersUnavailable = offerRows.length > 0 && offerRows.every(row => offerStatus(row)?.status === 'unavailable');
      // One provider's sold-out result cannot make a multi-offer property sold out.
      const visibleStatus = status?.status === 'unavailable' && offerRows.length && !allOffersUnavailable ? null : status;
      const quoteNote = card.querySelector('.party-quote-note');
      if (quoteNote) {
        const selected = Number(guestFilter?.value || 6);
        const notes = [];
        // The price is the same for 6 or 7 people; only the listing's capacity can limit the group.
        if (capacity !== null && capacity < selected) notes.push(`İlan kapasitesi ${capacity} kişi; ${selected}. kişi için ev sahibi onayı gerekir.`);
        quoteNote.hidden = notes.length === 0;
        quoteNote.textContent = notes.join(' ');
      }
      const statusNode = card.querySelector('.availability-status');
      card.dataset.availability = visibleStatus?.status || 'unknown';
      // "Missed": a dated check found it available, a later one found it closed.
      card.dataset.missed = String(visibleStatus?.status === 'unavailable' && Number.isFinite(Date.parse(visibleStatus.lastAvailableAt || '')));
      const availabilityChoice = availabilityFilter?.value || 'all';
      const availabilityMatch = availabilityChoice === 'all' ||
        (availabilityChoice === 'available' && card.dataset.availability === 'available') ||
        (availabilityChoice === 'hide-unavailable' && card.dataset.availability !== 'unavailable') ||
        (availabilityChoice === 'unavailable' && card.dataset.availability === 'unavailable') ||
        (availabilityChoice === 'missed' && card.dataset.missed === 'true');
      card.dataset.generalMatch = String(generalMatch && availabilityMatch);
      card.hidden = !(generalMatch && availabilityMatch) || (activeBest !== '' && !bestMatch);
      if (statusNode) {
        statusNode.hidden = !visibleStatus;
        // The photo chip stays short; the full dated observation is in the summary tab.
        const overview = card.querySelector('.detail-panel[data-panel="overview"]');
        let full = overview?.querySelector('.availability-full');
        if (visibleStatus) {
          const day = trDay(visibleStatus.checkedAt);
          let text = `${visibleStatus.status === 'unavailable' ? 'Bu Tarihlerde Müsait Değil' : 'Kaynakta Müsait Göründü'} · ${visibleStatus.adults} Kişi · ${day}`;
          const wasAvailable = visibleStatus.status === 'unavailable' && Number.isFinite(Date.parse(visibleStatus.lastAvailableAt || ''));
          if (wasAvailable) text = `${trDayAt(visibleStatus.lastAvailableAt)} ${visibleStatus.adults} kişi için müsait görünüyordu. ${trDayTime(visibleStatus.checkedAt)} kontrolünde bu tarihler artık müsait değil; ilan başkası tarafından kiralanmış ya da takvimi kapatılmış olabilir.`;
          if (typeof visibleStatus.displayPrice === 'string' && visibleStatus.displayPrice) text += ` · ${visibleStatus.displayPrice}`;
          if (visibleStatus.lastAttempt?.result === 'unknown') text += ' · Son kontrol doğrulanamadı';
          statusNode.textContent = `${visibleStatus.status === 'unavailable' ? 'Müsait değil' : 'Müsait göründü'} · ${visibleStatus.adults} kişi · ${day}`;
          statusNode.title = text;
          statusNode.setAttribute('aria-label', text);
          if (overview) {
            if (!full) { full = document.createElement('p'); full.className = 'availability-full'; overview.querySelector('.panel-title')?.after(full); }
            full.textContent = text;
            full.dataset.status = visibleStatus.status;
          }
        } else if (full) full.remove();
      }
      // Unavailable offers stay listed: greyed, crossed out and dated.
      let stamp = card.querySelector('.unavailable-stamp');
      if (visibleStatus?.status === 'unavailable') {
        if (!stamp) {
          stamp = document.createElement('div');
          stamp.className = 'unavailable-stamp';
          stamp.setAttribute('aria-hidden', 'true');
          stamp.innerHTML = '<span class="stamp-x"><svg class="i"><use href="#i-x"></use></svg></span><b>Bu tarihler artık müsait değil</b><span class="stamp-history" hidden></span><small></small>';
          card.querySelector('.card-media')?.append(stamp);
        }
        // "It was available on X and closed by Y" only when the data records X.
        const history = stamp.querySelector('.stamp-history');
        const lastAvailable = visibleStatus.lastAvailableAt;
        history.hidden = !Number.isFinite(Date.parse(lastAvailable || ''));
        if (!history.hidden) history.textContent = `${trDayAt(lastAvailable)} müsaitti, ${trDayAt(visibleStatus.checkedAt)} kapandı`;
        stamp.querySelector('small').textContent = `${visibleStatus.adults} kişi · Son kontrol ${trDayTime(visibleStatus.checkedAt)}`;
      } else if (stamp) stamp.remove();
      card.querySelectorAll('.ruebezahl-table tr[data-source-id]').forEach(row => {
        const offer = offerStatus(row);
        row.dataset.availability = offer?.status || 'unknown';
        const label = row.querySelector('.offer-availability');
        if (label) { label.hidden = !offer; label.textContent = offer ? `${offer.status === 'unavailable' ? 'Bu tarihlerde müsait değil' : 'Kaynakta müsait göründü'} · ${new Intl.DateTimeFormat('tr-TR',{day:'numeric',month:'long'}).format(new Date(offer.checkedAt))}` : ''; }
      });
    });
    relatedQuotes.forEach(({six, seven, sixRow, sevenRow}) => {
      const together = !six.hidden && !seven.hidden;
      const useSeven = guestFilter?.value === '7';
      sixRow.hidden = !together || useSeven;
      sevenRow.hidden = !together || !useSeven;
      if (together) {
        const suppressed = useSeven ? six : seven;
        suppressed.hidden = true;
        suppressed.dataset.generalMatch = 'false';
      }
    });
    root.querySelectorAll('.pairings').forEach(panel => { panel.hidden = filtering; });
    groups.forEach(group => {
      const groupCards = Array.from(group.querySelectorAll('.stay-card'));
      const n = groupCards.filter(card => !card.hidden).length;
      const count = group.querySelector('.group-count');
      const conditionalCount = groupCards.filter(card => !card.hidden && (card.dataset.bestCandidate==='true'||(activeBest && card.dataset.bestAlternative==='true')||card.dataset.conditional==='true'||card.closest('.conditional'))).length;
      if (count) count.textContent = showHouseAlternatives && group === selectedGroup
        ? `${n} Alternatif · Koşulları Kontrol Edin`
        : `${n - conditionalCount} Seçenek${conditionalCount ? ` · ${conditionalCount} Dikkat Gerektiren` : ''}`;
      const empty = group.querySelector('.search-empty');
      if (empty) empty.hidden = Boolean(activeBest) || !filtering || n > 0 || groupCards.length === 0;
      const bestEmpty = group.querySelector('.best-empty');
      const alternativesIntro = group.querySelector('.best-alternatives-intro');
      if (alternativesIntro) alternativesIntro.hidden = !showHouseAlternatives || group !== selectedGroup || n === 0;
      const apartmentIntro = group.querySelector('.best-apartment-intro');
      if (apartmentIntro) apartmentIntro.hidden = activeBest !== 'best-apartment' || group !== selectedGroup || n === 0;
      if (bestEmpty) {
        bestEmpty.hidden = !activeBest || group !== selectedGroup || n > 0;
        const allBest = groupCards.some(card => card.dataset.bestEligible === 'true' || card.dataset.bestCandidate === 'true');
        bestEmpty.querySelector('p').textContent = allBest
          ? 'Bu favori filtresiyle eşleşen en uygun seçenek yok.'
          : `En uygun ölçütlerini karşılayan veya vergili toplamı kontrol edilmesi gereken dört gecelik ${group.id.endsWith('full-daire') ? 'daire' : 'villa'} bulunamadı.`;
      }
      group.querySelectorAll(':scope > .empty:not(.best-empty):not(.search-empty)').forEach(el => { el.hidden = Boolean(activeBest); });
      group.querySelectorAll('.subsection').forEach(subsection => {
        subsection.hidden = filtering && !Array.from(subsection.querySelectorAll('.stay-card')).some(card => !card.hidden);
      });
      group.querySelectorAll('.conditional').forEach(section => {
        section.hidden = filtering && !Array.from(section.querySelectorAll('.stay-card')).some(card => !card.hidden);
      });
    });
    if(favoritesOnly){groups.forEach(g=>g.hidden=true);cards.filter(c=>!c.hidden && c.parentElement!==favoriteGrid).forEach(c=>favoriteGrid.append(c));}
    else {groups.forEach(g=>g.hidden=Boolean(selectedGroup) && g!==selectedGroup);}
    if (newStatus && newOnly) {
      const visibleNew = cards.filter(card => !card.hidden && !card.closest('.group')?.hidden).length;
      newStatus.textContent = `${visibleNew} son eklenen seçenek gösteriliyor`;
    }
    if (status) status.textContent = filtering ? `${cards.filter(card => !card.hidden).length} sonuç` : 'Tüm gruplara dönüldü';
    if (availabilitySummary) {
      const shown = cards.filter(card => !card.hidden && (favoritesOnly || !card.closest('.group')?.hidden));
      const available = shown.filter(card => card.dataset.availability === 'available').length;
      const unavailable = shown.filter(card => card.dataset.availability === 'unavailable').length;
      const missed = shown.filter(card => card.dataset.missed === 'true').length;
      const latest = availabilityRecords.map(entry => Date.parse(entry.checkedAt)).filter(Number.isFinite).sort((a, b) => b - a)[0];
      availabilitySummary.hidden = !latest || !(available || unavailable);
      if (!availabilitySummary.hidden) {
        const day = new Intl.DateTimeFormat('tr-TR', {day:'numeric', month:'long'}).format(new Date(latest));
        availabilitySummary.querySelector('.sum-date').textContent = `Son müsaitlik kontrolü · ${day} · ${party} kişi`;
        const ok = availabilitySummary.querySelector('.sum-ok');
        const no = availabilitySummary.querySelector('.sum-no');
        ok.hidden = !available; ok.textContent = `${available} ilan müsait göründü`;
        no.hidden = !unavailable; no.textContent = `${unavailable} ilan artık müsait değil`;
        const lost = availabilitySummary.querySelector('.sum-missed');
        lost.hidden = !missed; lost.textContent = `${missed} ilan kaçırıldı`;
        availabilitySummary.querySelectorAll('button[data-choice]').forEach(button => {
          const pressed = availabilityFilter?.value === button.dataset.choice;
          button.setAttribute('aria-pressed', String(pressed));
          button.setAttribute('aria-label', `${button.textContent}: ${pressed ? 'tüm ilanlara dön' : 'yalnız bunları göster'}`);
        });
        availabilitySummary.querySelector('.sum-rest').textContent = shown.length - available - unavailable
          ? `${shown.length - available - unavailable} ilan bu kontrolde doğrulanmadı. Fiyatlar ve müsaitlik değişebilir.`
          : 'Fiyatlar ve müsaitlik değişebilir.';
      }
    }
    if (filterResults) {
      const visibleCount = cards.filter(card => !card.hidden && (favoritesOnly || !card.closest('.group')?.hidden)).length;
      filterResults.textContent = hasExtraFilters ? `${visibleCount} seçenek gösteriliyor` : '';
    }
    const filterCount = filterValues.filter(control => control.value !== 'all').length;
    const mobileCount = mobileFilterButton?.querySelector('.active-filter-count');
    if (mobileCount) mobileCount.textContent = filterCount ? `(${filterCount})` : '';
    renderActiveFilters();
    root.dispatchEvent(new Event('cards-filtered', {bubbles:true}));
  }
  function renderActiveFilters() {
    filterValues.forEach(control => control.classList.toggle('is-active', control.value !== 'all'));
    const chips = filterValues.filter(control => control.value !== 'all').map(control => {
      const name = (control.closest('label')?.firstChild?.textContent || '').trim();
      const value = control.selectedOptions[0]?.textContent.trim() || control.value;
      return {text:name ? `${name}: ${value}` : value, clear:() => { control.value = 'all'; }};
    });
    if (activeBest) chips.unshift({text:activeBest === 'best-house' ? 'En Uygun Villa' : 'En Uygun Daire', clear:() => selectPlan(selectedGroup?.id || allPlanId)});
    if (newOnly) chips.unshift({text:'Son Eklenenler', clear:() => setNewOnly(false)});
    root.dataset.activeFilters = String(chips.length);
    if (!activeFilterBar) return;
    activeFilterBar.hidden = !chips.length;
    if (!chips.length) { activeFilterBar.replaceChildren(); return; }
    const after = () => { applyFilters(); if (sort) applySort(); };
    const heading = document.createElement('b'); heading.className = 'active-filters-title';
    heading.textContent = chips.length === 1 ? 'Açık filtre' : `${chips.length} açık filtre`;
    const nodes = [heading];
    chips.forEach(chip => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'filter-chip';
      button.setAttribute('aria-label', `${chip.text} filtresini kaldır`);
      const label = document.createElement('span'); label.textContent = chip.text;
      button.append(label, icon('x'));
      button.addEventListener('click', () => { chip.clear(); after(); activeFilterBar.querySelector('.filter-chip, .filter-chips-clear')?.focus({preventScroll:true}); });
      nodes.push(button);
    });
    if (chips.length > 1) {
      const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'filter-chips-clear'; clear.textContent = 'Tümünü kaldır';
      clear.addEventListener('click', () => { chips.forEach(chip => chip.clear()); after(); });
      nodes.push(clear);
    }
    if (favoritesOnly) {
      let total = cards.filter(card => favorites.entries.has(offerKey(offerFromCard(card)))).length;
      relatedQuotes.forEach(({six, seven}) => {
        if (favorites.entries.has(offerKey(offerFromCard(six))) && favorites.entries.has(offerKey(offerFromCard(seven)))) total--;
      });
      const shown = cards.filter(card => !card.hidden).length;
      if (total > shown) {
        const note = document.createElement('p'); note.className = 'active-filters-note';
        note.textContent = shown ? `${total} favoriden ${shown} tanesi gösteriliyor; diğerleri bu filtrelere takılıyor.` : `${total} favorinin hiçbiri bu filtrelere uymuyor.`;
        nodes.push(note);
      }
    }
    activeFilterBar.replaceChildren(...nodes);
  }
  function icon(name) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('class', 'i'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(ns, 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use);
    return svg;
  }
  filterValues.forEach(control => control.addEventListener('change', () => { applyFilters(); if (sort) applySort(); }));
  guestFilter?.addEventListener('change', () => { applyFilters(); if (sort) applySort(); });
  root.querySelector('.filters-clear')?.addEventListener('click', () => {
    filterValues.forEach(control => { control.value = 'all'; });
    if (guestFilter) guestFilter.value = '6';
    favoritesOnly = false; favoriteFilter?.setAttribute('aria-pressed', 'false');
    setNewOnly(false); selectPlan(allPlanId);
    history.replaceState(history.state, '', '#' + allPlanId);
    applyFilters(); if (sort) applySort();
  });
  function setMobileFilters(open) { filterPanel?.classList.toggle('mobile-open', open); mobileFilterButton?.setAttribute('aria-expanded', String(open)); }
  mobileFilterButton?.addEventListener('click', () => setMobileFilters(mobileFilterButton.getAttribute('aria-expanded') !== 'true'));
  root.querySelector('.mobile-filter-done')?.addEventListener('click', () => { setMobileFilters(false); mobileFilterButton?.focus({preventScroll:true}); });
  function updateFavoriteControls() {
    const ready = favorites.state === 'ready';
    if (!ready) favoritesOnly = false;
    let count = cards.filter(card => favorites.entries.has(offerKey(offerFromCard(card)))).length;
    relatedQuotes.forEach(({six, seven}) => {
      if (favorites.entries.has(offerKey(offerFromCard(six))) && favorites.entries.has(offerKey(offerFromCard(seven)))) count--;
    });
    if (favoriteFilter) {
      favoriteFilter.disabled = !ready;
      favoriteFilter.setAttribute('aria-pressed', String(favoritesOnly));
      favoriteFilter.querySelector('.favorite-count').textContent = ready ? `(${count})` : '';
    }
    if (favoriteStatus) {
      favoriteStatus.textContent = favorites.state === 'ready'
        ? (window.BerlinPrototype ? 'Önizleme: Beğeniler yalnızca bu denemede tutulur, ortak listeye yazılmaz.' : favorites.uncertain ? 'Bir beğeni kaydedilemedi. Kalbe yeniden basın.' : 'İsimsiz beğeniler siteyi açan herkese görünür. Her tarayıcı bir kez beğenebilir; favoriler en çok beğenilene göre sıralanır.')
        : favorites.state === 'loading' ? 'Ortak favoriler yükleniyor; beğenebilirsiniz, liste gelince eşitlenir.'
        : favorites.state === 'error' ? 'Ortak favoriler şu an yüklenemedi; beğenileriniz bu tarayıcıda bekletilip yeniden denenir.'
          : window.BerlinFavoritesEndpointConfigured ? 'Ortak favoriler henüz bağlanamadı.'
          : 'Ortak favoriler bağlanmadı.';
    }
    if (favoriteRetry) {
      favoriteRetry.hidden = !adapter();
      favoriteRetry.disabled = favorites.busy;
      favoriteRetry.textContent = ready ? 'Güncelle' : 'Yeniden Dene';
    }
    // A map dialog contains a live clone, so refresh original and copied buttons.
    root.querySelectorAll('.favorite-button').forEach(button => {
      const card = button.closest('.stay-card');
      if (!card) return;
      const key = offerKey(offerFromCard(card));
      // A vote the server has acknowledged no longer looks busy; it still waits
      // for the shared list, so an older list can't flip the heart back.
      const pending = favorites.pending.get(key)?.written === false;
      const failed = favorites.errors.has(key);
      const selected = favorites.mine.has(key);
      const vote=favorites.metadata.get(key)||{count:0};
      card.dataset.votes=String(vote.count);
      card.classList.toggle('liked-two',vote.count===2);card.classList.toggle('liked-many',vote.count>=3);
      let badge=card.querySelector('.vote-badge');if(!badge){badge=document.createElement('span');badge.className='vote-badge';(card.querySelector('.media-flags')||card.querySelector('.card-title')).prepend(badge);}
      badge.textContent=vote.count?`${vote.count} Beğeni`:vote.legacy?'Önceki Ortak Favori':'';badge.hidden=!badge.textContent;
      const name = card.querySelector('.card-title h3, .card-title h4')?.textContent || 'Konaklama';
      const dates = card.querySelector('.card-kicker')?.textContent || '';
      // The heart stays usable while the shared list loads or a vote syncs.
      const usable = Boolean(adapter());
      button.disabled = !usable;
      button.setAttribute('aria-busy', String(Boolean(pending)));
      button.toggleAttribute('data-syncing', Boolean(pending));
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', usable ? `${name}, ${dates}: ${selected ? 'favorilerden kaldır' : 'favorilere ekle'}${pending ? ' (kaydediliyor)' : ''}` : 'Ortak favoriler şu anda kullanılamıyor');
      button.querySelector('.favorite-heart').textContent = selected ? '♥' : '♡';
      button.querySelector('.favorite-label').textContent = selected ? 'Beğendin' : 'Beğen';
      const unavailable = button.closest('.favorite-control')?.querySelector('.favorite-unavailable');
      if (unavailable) {
        unavailable.hidden = usable && !failed;
        unavailable.textContent = failed ? 'Beğeni kaydedilemedi; yeniden deneyin'
          : window.BerlinFavoritesEndpointConfigured ? 'Ortak liste bağlanamadı' : 'Ortak liste bağlı değil';
      }
    });
    const before = favoriteAnchor?.isConnected && !favoriteAnchor.hidden ? favoriteAnchor.getBoundingClientRect().top : null;
    applyFilters();
    if(ready && sort && (favoritesOnly || sort.value === 'votes')) applySort();
    if (before !== null && favoriteAnchor?.isConnected && !favoriteAnchor.hidden) {
      const delta = favoriteAnchor.getBoundingClientRect().top - before;
      if (Math.abs(delta) > 1) window.scrollBy({top:delta, behavior:'instant'});
    }
  }
  document.addEventListener('berlin-favorites-state', updateFavoriteControls);
  if (favoriteRetry) favoriteRetry.addEventListener('click', refreshFavorites);
  if (favoriteFilter) favoriteFilter.addEventListener('click', () => {
    favoritesOnly = !favoritesOnly;
    if (favoritesOnly && (activeBest || newOnly)) {
      setNewOnly(false); selectPlan(selectedGroup?.id || allPlanId);
    }
    favoriteFilter.setAttribute('aria-pressed', String(favoritesOnly));
    applyFilters();
    if(sort)applySort();
  });
  root.addEventListener('click', event => {
    const button = event.target.closest('.favorite-button');
    if (!button || button.disabled || !root.contains(button)) return;
    const card = button.closest('.stay-card');
    if (card) {
      favoriteAnchor = card;
      const operation = toggleFavorite(offerFromCard(card));
      if (operation) operation.finally(() => { if (favoriteAnchor === card) favoriteAnchor = null; });
      else favoriteAnchor = null;
    }
  });
  const cardDialog = byId('card-dialog');
  if (cardDialog) cardDialog.addEventListener('close', () => {
    // The opener can disappear when its favorite is removed under a filter.
    // Give the map's normal focus-restoration handler a chance to run first.
    Promise.resolve().then(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.getClientRects().length) return;
      const mapControl = mapPanel && !mapPanel.hidden ? byId('map-group') : null;
      const fallback = mapControl || (favoriteFilter && !favoriteFilter.disabled ? favoriteFilter : byId('view-list'));
      if (fallback && fallback.getClientRects().length) fallback.focus({preventScroll:true});
    });
  });
  updateFavoriteControls();

  const number = (card, field) => {
    const raw = card.dataset[field];
    if (raw === undefined || raw === '') return Infinity;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : Infinity;
  };
  function score(card, mode) {
    if (mode === 'price' || mode === 'price-desc') { const value=number(card, 'priceEur'); return mode === 'price-desc' && Number.isFinite(value) ? -value : value; }
    if (mode === 'balance') return Math.max(number(card, 'rsoCarMin'), number(card, 'tresorCarMin'));
    const fields = {'rso-car':'rsoCarMin', 'tresor-car':'tresorCarMin', 'rso-transit':'rsoTransitMin', 'tresor-transit':'tresorTransitMin'};
    return number(card, fields[mode]);
  }
  function applySort() {
    root.querySelectorAll('.card-grid').forEach(grid => {
      const existing = Array.from(grid.children).filter(node => node.classList.contains('stay-card'));
      const children = existing.slice();
      children.sort((a, b) => {
        // Votes lead in favorites; ties keep the selected sort's existing rules.
        if(favoritesOnly || sort.value==='votes'){const diff=Number(b.dataset.votes||0)-Number(a.dataset.votes||0);if(diff)return diff;}
        if (sort.value === 'best-priority') {
          const best = card => card.dataset.bestEligible === 'true' && (guestFilter?.value !== '7' || number(card, 'normalBeds') >= 7) ? 0 : card.dataset.bestCandidate === 'true' && (guestFilter?.value !== '7' || number(card, 'normalBeds') >= 7) ? 1 : 2;
          const diff = best(a) - best(b); if (diff) return diff;
        }
        if (sort.value === 'best-priority' || (sort.value === 'priority' && !favoritesOnly)) {
          const far = card => (['villa', 'private_house'].includes(card.dataset.category) || (card.dataset.category === 'multiunit' && card.dataset.planGroup === 'full-villa')) && number(card, 'tresorCarMin') > 35 ? 1 : 0;
          const distance = far(a) - far(b); if (distance) return distance;
          const required = guestFilter?.value === '7' ? 7 : 6;
          const priority = card => number(card, 'normalBeds') !== Infinity && number(card, 'normalBeds') >= required ? 0 : 1;
          const beds = priority(a) - priority(b); if (beds) return beds;
          const compare = field => { const x=number(a,field), y=number(b,field); return x === y ? 0 : x < y ? -1 : 1; };
          return compare('tresorCarMin') || compare('priceEur') || Number(a.dataset.order) - Number(b.dataset.order);
        }
        const x = score(a, sort.value), y = score(b, sort.value);
        return (x === y ? 0 : x < y ? -1 : 1) || Number(a.dataset.order) - Number(b.dataset.order);
      });
      if (children.every((child, index) => child === existing[index])) return;
      children.forEach((child, index) => { const at = Array.from(grid.children).filter(node => node.classList.contains('stay-card'))[index]; if (at !== child) grid.insertBefore(child, at || null); });
    });
  }
  if (sort) { sort.addEventListener('change', applySort); applySort(); }
  document.addEventListener('berlin-availability', event => {
    availabilityRecords = event.detail;
    cards.forEach(applyCapacityEvidence);
    applyFilters();
  });
  // Lira-priced offers change their euro value with the day's rate.
  document.addEventListener('berlin-fx', () => { applyFilters(); if (sort) applySort(); });

  // Card tiles load a smaller copy; if that copy fails, try the original once.
  const useOriginal = img => {
    const full = img.closest('a')?.dataset.photoUrl;
    if (!full || img.getAttribute('src') === full) return false;
    img.src = full;
    return true;
  };
  const markImageFailure = img => {
    const anchor = img.closest('a');
    const listing = img.closest('.stay-card').querySelector('.listing');
    if (anchor && listing) {
      anchor.classList.add('photo-failed');
      anchor.href = listing.href;
      anchor.target = '_blank';
      anchor.setAttribute('aria-label', `Fotoğraf yüklenemedi; ${img.closest('.stay-card').querySelector('.card-title h3, .card-title h4').textContent} ilanını aç`);
    }
  };
  root.addEventListener('error', event => {
    if (!(event.target instanceof HTMLImageElement) || !event.target.matches('.photo-grid img')) return;
    // A failed small copy is not a failed photo: retry the original quietly.
    if (useOriginal(event.target)) { event.stopPropagation(); return; }
    markImageFailure(event.target);
  }, true);
  root.querySelectorAll('.photo-grid img').forEach(img => {
    if (img.complete && img.currentSrc && img.naturalWidth === 0 && !useOriginal(img)) markImageFailure(img);
  });

  // Shareable offer links. One page serves every offer: the address
  // #ilan=<id>&giris=<giriş>&cikis=<çıkış>&kisi=<6|7> opens that offer's large view.
  // The same identity (id + dates) is used by the shared favorites.
  const parseListingHash = (hash = location.hash) => {
    const raw = String(hash || '').replace(/^#/, '');
    if (!raw.startsWith('ilan=')) return null;
    const params = new URLSearchParams(raw);
    const id = params.get('ilan') || '';
    if (!/^[A-Za-z0-9-]{1,160}$/.test(id)) return null;
    const checkIn = params.get('giris') || '', checkOut = params.get('cikis') || '', adults = params.get('kisi') || '';
    return {id, checkIn: isDay(checkIn) ? checkIn : '', checkOut: isDay(checkOut) ? checkOut : '', adults: /^[67]$/.test(adults) ? adults : ''};
  };
  const listingHash = card => '#' + new URLSearchParams({ilan:card.dataset.id, giris:card.dataset.checkIn, cikis:card.dataset.checkOut, kisi:card.dataset.offerAdults === '7' ? '7' : '6'}).toString();
  const listingUrl = card => {
    const url = new URL(location.href);
    url.search = '';
    // A new address also skips an older cached copy of the page.
    const release = document.querySelector('meta[name="berlin-release"]')?.getAttribute('content') || '';
    if (/^[a-f0-9]{16}$/.test(release)) url.searchParams.set('v', release);
    url.hash = listingHash(card).slice(1);
    return url.toString();
  };
  const findListingCard = target => {
    const matches = cards.filter(card => card.dataset.id === target.id &&
      (!target.checkIn || card.dataset.checkIn === target.checkIn) && (!target.checkOut || card.dataset.checkOut === target.checkOut));
    return matches.find(card => !target.adults || card.dataset.offerAdults === target.adults) || matches[0] || null;
  };
  const setAddress = hash => {
    try { history.replaceState(history.state, '', location.pathname + location.search + hash); } catch (_) { /* file:// or a locked history */ }
  };
  let hashBeforeDialog = null, sharedCard = null;
  if (cardDialog) {
    // Keep the address bar on the open offer, so the browser's own share menu
    // also sends this offer. Closing restores the previous plan address.
    cardDialog.addEventListener('card-shown', event => {
      const card = event.detail && event.detail.card;
      if (!card || !card.dataset || !card.dataset.id || !cards.includes(card)) return;
      if (hashBeforeDialog === null) hashBeforeDialog = parseListingHash() ? '' : location.hash;
      setAddress(listingHash(card));
    });
    cardDialog.addEventListener('close', () => {
      if (hashBeforeDialog !== null) {
        const restore = hashBeforeDialog;
        hashBeforeDialog = null;
        if (parseListingHash()) setAddress(restore);
      }
      const card = sharedCard;
      sharedCard = null;
      // After a shared link, show the offer in the list as well.
      if (card && !card.hidden && card.getClientRects().length) {
        // A direct jump: the list can be very long, and the dialog was covering it.
        card.scrollIntoView({block:'center', behavior:'instant'});
        card.classList.add('is-shared');
        setTimeout(() => card.classList.remove('is-shared'), 2600);
      }
    });
  }
  const sharedNotice = message => {
    if (!resultsContent) return;
    let notice = resultsContent.querySelector('.shared-missing');
    if (!notice) {
      notice = document.createElement('p');
      notice.className = 'shared-missing';
      notice.setAttribute('role', 'status');
      resultsContent.prepend(notice);
    }
    notice.textContent = message;
    notice.hidden = false;
    setTimeout(() => { notice.hidden = true; }, 12000);
  };
  const openListingFromHash = () => {
    const target = parseListingHash();
    if (!target) return;
    const card = findListingCard(target);
    if (!card) { sharedNotice('Paylaşılan ilan artık listede yok. Güncel seçenekler aşağıda.'); return; }
    if (target.adults && guestFilter && guestFilter.value !== target.adults) {
      guestFilter.value = target.adults;
      guestFilter.dispatchEvent(new Event('change', {bubbles:true}));
    }
    const opener = card.querySelector('.card-open-main');
    if (!opener) return;
    sharedCard = card;
    opener.click();
  };
  window.addEventListener('hashchange', openListingFromHash);
  // The map script opens the large view; it is registered after this script.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(openListingFromHash, 0), {once:true});
  else setTimeout(openListingFromHash, 0);
  const shareFeedback = (button, message) => {
    const control = button.closest('.favorite-control') || button.parentElement;
    let note = control.querySelector('.share-feedback');
    if (!note) {
      note = document.createElement('span');
      note.className = 'share-feedback';
      note.setAttribute('role', 'status');
      note.setAttribute('aria-live', 'polite');
      button.after(note);
    }
    note.textContent = message;
    note.hidden = false;
    clearTimeout(note.timer);
    note.timer = setTimeout(() => { note.hidden = true; }, 2600);
  };
  root.addEventListener('click', async event => {
    const button = event.target.closest('.share-button');
    if (!button || !root.contains(button)) return;
    const card = button.closest('.stay-card');
    if (!card || !card.dataset.id) return;
    event.preventDefault();
    const url = listingUrl(card);
    const name = card.querySelector('.card-title h3, .card-title h4')?.textContent.trim() || 'Berlin konaklaması';
    const dates = card.querySelector('.card-kicker')?.textContent.trim() || '';
    const priceNode = card.querySelector('.amount strong')?.cloneNode(true);
    priceNode?.querySelectorAll('.price-qualifier').forEach(node => node.remove());
    const summary = [name, dates, priceNode?.textContent.trim() || ''].filter(Boolean).join(' · ');
    // Phones get the system share sheet (WhatsApp, Messages); computers copy the link.
    // The link goes inside the text: given separate text and url fields, iOS
    // "Copy" and some apps (WhatsApp) keep only the text and drop the link.
    if (typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({text:`${summary}\n${url}`}); return; }
      catch (error) { if (error && error.name === 'AbortError') return; }
    }
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(url);
      shareFeedback(button, 'Bağlantı kopyalandı');
    } catch (_) {
      window.prompt('Bu ilanın bağlantısını kopyalayın:', url);
    }
  });

  const dialog = byId('lightbox');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  root.classList.add('gallery-modal');
  const large = dialog.querySelector('img');
  const title = byId('lightbox-title');
  const caption = byId('lightbox-caption');
  const source = byId('lightbox-source');
  const imageError = dialog.querySelector('.lightbox-error');
  const previous = dialog.querySelector('[data-step="-1"]');
  const next = dialog.querySelector('[data-step="1"]');
  let photos = [], index = 0, opener = null, galleryTitle = ''; 
  function render() {
    const photo = photos[index];
    if (!photo) return;
    imageError.hidden = true;
    large.hidden = false;
    large.src = photo.url;
    large.alt = photo.label || '';
    title.textContent = galleryTitle;
    caption.textContent = `${photo.label || 'Fotoğraf'} · ${index + 1} / ${photos.length}`;
    source.href = photo.url;
    previous.disabled = next.disabled = photos.length < 2;
  }
  large.addEventListener('error', () => { large.hidden = true; imageError.hidden = false; });
  function openGallery(anchor, origin) {
    opener = origin;
    window.BerlinExpandPhotos(anchor.closest('.photo-grid'));
    const anchors = Array.from(anchor.closest('.photo-grid').querySelectorAll('a'));
    index = anchors.indexOf(anchor);
    galleryTitle = anchor.closest('.stay-card').querySelector('.card-title h3, .card-title h4').textContent;
    photos = anchors.map(item => ({url: item.dataset.photoUrl || item.href, label: item.dataset.label || ''}));
    render();
    dialog.showModal();
  }
  root.addEventListener('click', event => {
    const anchor = event.target.closest('.photo-grid a');
    if (!anchor || anchor.classList.contains('photo-failed') || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openGallery(anchor, anchor);
  });
  root.addEventListener('click', event => { const button=event.target.closest('.gallery-open'); if (button) { const anchor=button.closest('.stay-card').querySelector('.photo-grid a'); if(anchor)openGallery(anchor,button); } });
  const step = amount => { if (photos.length) { index = (index + amount + photos.length) % photos.length; render(); } };
  previous.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
  });
  dialog.addEventListener('close', () => { large.removeAttribute('src'); if (opener) opener.focus(); });
  });
  loadLiveAvailability();
  loadDailyRate();
  // Every list read waits for the server's lock, so read less often: on
  // load, on return to the tab (at most every 10 s) and once a minute.
  const freshRead = () => { if (adapter() && Date.now() - favorites.lastReadAt > 10000) refreshFavorites(); };
  if (adapter()) { refreshFavorites(); if (favorites.pending.size) scheduleSync(0); }
  window.addEventListener('berlin-favorites-transport-ready', () => { refreshFavorites(); scheduleSync(0); });
  window.addEventListener('focus', freshRead);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) freshRead(); });
  window.setInterval(() => { if (!document.hidden && adapter()) refreshFavorites(); }, 60000);
})();
