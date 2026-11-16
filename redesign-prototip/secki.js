/* Seçki: a short list chosen by the group, shown above the results, with an
   anonymous ballot. Everyone gives 2 main and up to 2 backup votes, each to a
   different listing, once. Main votes decide first; if those homes fall
   through, the backup votes are looked at.
   Votes travel through the shared favorites service as separate items
   (secki-ana-<id>, secki-yedek-<id>), so a seçki vote never changes a heart.
   The service counts one vote per browser per item and never sees a name. */
(function () {
  'use strict';
  const dataNode = document.getElementById('secki-data');
  const root = document.querySelector('.results-content');
  if (!dataNode || !root) return;
  let data;
  try { data = JSON.parse(dataNode.textContent); } catch (_) { return; }
  if (!data || !Array.isArray(data.items) || !data.items.length) return;
  const MAIN = Number(data.ballot?.main) || 2, BACKUP = Number(data.ballot?.backup) || 2;
  const allCards = Array.from(document.querySelectorAll('.groups .stay-card'));
  const findCard = it => allCards.find(c => c.dataset.id === it.id && c.dataset.checkIn === it.checkIn && c.dataset.checkOut === it.checkOut) || null;
  const items = data.items.map(it => ({...it, card: findCard(it)})).filter(it => it.card);
  if (!items.length) return;
  items.forEach(it => { it.card.dataset.secki = 'true'; });
  const key = it => `${it.id}|${it.checkIn}|${it.checkOut}`;
  const voteItem = (it, kind) => ({id:`secki-${kind === 'main' ? 'ana' : 'yedek'}-${it.id}`, checkIn:it.checkIn, checkOut:it.checkOut});
  const byVoteId = new Map();
  items.forEach(it => { byVoteId.set(voteItem(it, 'main').id, [it, 'main']); byVoteId.set(voteItem(it, 'backup').id, [it, 'backup']); });

  // ---- Service ------------------------------------------------------------
  // The preview never writes to the shared list: it keeps the ballot in this
  // browser only, so the whole flow can be tried safely.
  const PREVIEW_STORE = 'berlin-secki-preview-votes-v1';
  const preview = window.BerlinPrototype === true || !window.BerlinFavoritesTransport || typeof window.BerlinFavoritesTransport.send !== 'function';
  const api = preview ? {
    async list() {
      let mine = [];
      try { mine = JSON.parse(localStorage.getItem(PREVIEW_STORE) || '[]'); } catch (_) {}
      return mine.map(x => ({...x, count:1, mine:true}));
    },
    async send(op, item) {
      let mine = [];
      try { mine = JSON.parse(localStorage.getItem(PREVIEW_STORE) || '[]'); } catch (_) {}
      if (op === 'add' && !mine.some(x => x.id === item.id)) mine.push(item);
      if (op === 'remove') mine = mine.filter(x => x.id !== item.id);
      try { localStorage.setItem(PREVIEW_STORE, JSON.stringify(mine)); } catch (_) { return 'unknown'; }
      await new Promise(r => setTimeout(r, 350));
      return 'ok';
    }
  } : window.BerlinFavoritesTransport;

  // ---- State --------------------------------------------------------------
  const LOCAL = 'berlin-secki-ballot-v1', OPEN = 'berlin-secki-open-v1';
  const picks = {main: new Set(), backup: new Set()}; // listing keys
  let phase = 'choose'; // choose | confirm | sending | done
  let serverReady = false, serverError = '', counts = new Map(), lastSent = null;
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL) || 'null');
    if (saved && Array.isArray(saved.main) && Array.isArray(saved.backup) && saved.sentAt) {
      saved.main.forEach(k => picks.main.add(k)); saved.backup.forEach(k => picks.backup.add(k));
      phase = 'done'; lastSent = saved;
    }
  } catch (_) {}
  const itemByKey = new Map(items.map(it => [key(it), it]));
  const kindOf = k => picks.main.has(k) ? 'main' : picks.backup.has(k) ? 'backup' : '';

  // ---- Markup -------------------------------------------------------------
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const section = el('section', 'secki'); section.id = 'secki'; section.setAttribute('aria-labelledby', 'secki-title');
  const head = el('div', 'secki-head');
  const headText = el('div', 'secki-head-text');
  const h2 = el('h2', '', 'Seçki'); h2.id = 'secki-title';
  const sub = el('p', 'secki-sub');
  headText.append(h2, sub);
  const toggle = el('button', 'secki-toggle'); toggle.type = 'button'; toggle.setAttribute('aria-controls', 'secki-body');
  const headButtons = el('div', 'secki-head-buttons');
  const toMap = el('button', 'secki-to-map', 'Haritada Gör'); toMap.type = 'button';
  toMap.addEventListener('click', () => section.dispatchEvent(new CustomEvent('secki-map', {bubbles:true})));
  headButtons.append(toMap, toggle);
  head.append(headText, headButtons);
  const body = el('div', 'secki-body'); body.id = 'secki-body';
  const how = el('p', 'secki-how');
  how.textContent = `Herkes ${MAIN} ana ve ${BACKUP} yedek oy verir; her oy ayrı bir eve gider. Önce en çok ana oy alan evlere bakılır, onlar olmazsa yedeklere. Oylar isimsizdir, bir kez verilir; sonuçları oyunu verdikten sonra görürsün.`;
  const list = el('ol', 'secki-list');
  const results = el('div', 'secki-results'); results.hidden = true;
  const bar = el('div', 'secki-bar');
  const barText = el('p', 'secki-bar-text'); barText.setAttribute('role', 'status'); barText.setAttribute('aria-live', 'polite');
  const barButtons = el('div', 'secki-bar-buttons');
  const cancel = el('button', 'secki-cancel', 'Vazgeç'); cancel.type = 'button'; cancel.hidden = true;
  const submit = el('button', 'secki-submit'); submit.type = 'button';
  barButtons.append(cancel, submit);
  bar.append(barText, barButtons);
  const foot = el('p', 'secki-foot');
  foot.textContent = (preview ? 'Önizleme: oyun yalnız bu tarayıcıda tutulur, ortak listeye yazılmaz. ' : '') + 'Artı ve eksiler kartlardaki kayıtlardan derlendi; fiyat ve müsaitlik kartlardaki son kontrole aittir. Aynı tarayıcıdan bir oy verilir.';
  body.append(how, list, results, bar, foot);
  section.append(head, body);
  root.prepend(section);

  const fmtEur = new Intl.NumberFormat('tr-TR', {maximumFractionDigits:0});
  const rows = new Map();
  items.forEach((it, index) => {
    const card = it.card;
    const li = el('li', 'secki-row'); li.dataset.key = key(it);
    const thumb = el('button', 'secki-thumb'); thumb.type = 'button'; thumb.setAttribute('aria-label', 'İlanı aç');
    const img0 = card.querySelector('.photo-grid img');
    let src = img0 ? (img0.getAttribute('src') || img0.dataset.gmSrc || '') : '';
    if (src.startsWith('data:')) src = img0.dataset.gmSrc || '';
    // Small copies: a row needs ~200 px, not the card's 1024 px photo.
    src = src.replace('/max1024x768/', '/max500/').replace(/([?&]im_w=)\d+/, '$1480');
    if (src) { const img = el('img'); img.src = src; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer'; thumb.append(img); }
    const hint = el('span', 'secki-thumb-hint', 'İlanı aç'); thumb.append(hint);
    const main = el('div', 'secki-main');
    const titleRow = el('div', 'secki-title');
    titleRow.append(el('span', 'secki-no', String(index + 1)));
    const titleText = el('div');
    const h3 = el('h3'); const titleBtn = el('button', 'secki-title-open', card.querySelector('.card-title h3, .card-title h4')?.textContent.trim() || it.id); titleBtn.type = 'button'; h3.append(titleBtn);
    titleText.append(h3, el('p', 'secki-area', (card.querySelector('.card-title .area')?.textContent || it.area || '').replace(/^[^·]*·\s*/, '').trim()));
    titleRow.append(titleText);
    const facts = el('p', 'secki-facts');
    const price = card.querySelector('.amount > strong')?.textContent.trim() || '';
    const eur = Number(card.dataset.priceEur);
    const nights = card.querySelector('.quote-label')?.textContent.split('·')[0].trim() || '';
    const per6 = card.querySelector('tr[data-share-people="6"] .share-main')?.textContent.trim() || '';
    const beds = card.querySelector('.fact-tile[data-tab="beds"] b')?.textContent.trim() || '';
    const rooms = card.querySelector('.fact-tile[data-tab="overview"] b')?.textContent.trim() || '';
    const priceSpan = el('b', '', price + (price.includes('€') || !Number.isFinite(eur) ? '' : ` (≈ ${fmtEur.format(eur)} €)`));
    facts.append(priceSpan);
    [nights, per6 && `kişi başı ${per6}`, card.dataset.tresorCarMin && `Tresor ${card.dataset.tresorCarMin} dk`, card.dataset.rsoCarMin && `RSO ${card.dataset.rsoCarMin} dk`, beds, rooms]
      .filter(Boolean).forEach(text => facts.append(document.createTextNode(' · ' + text)));
    const status = el('p', 'secki-status');
    const pc = el('div', 'secki-pc');
    const pros = el('ul', 'secki-pros'); pros.setAttribute('aria-label', 'Artılar');
    (it.pros || []).forEach(t => pros.append(el('li', '', t)));
    const cons = el('ul', 'secki-cons'); cons.setAttribute('aria-label', 'Eksiler');
    (it.cons || []).forEach(t => cons.append(el('li', '', t)));
    pc.append(pros, cons);
    const actions = el('div', 'secki-actions');
    const open = el('button', 'secki-open', 'Ayrıntılar'); open.type = 'button';
    const openCard = () => {
      const guest = document.querySelector('.filter-guests');
      const adults = card.dataset.offerAdults;
      if (guest && /^[67]$/.test(adults || '') && guest.value !== adults && card.hidden) { guest.value = adults; guest.dispatchEvent(new Event('change', {bubbles:true})); }
      card.querySelector('.card-open-main')?.click();
    };
    open.addEventListener('click', openCard);
    thumb.addEventListener('click', openCard);
    titleBtn.addEventListener('click', openCard);
    const mapButton = el('button', 'secki-map', 'Harita'); mapButton.type = 'button';
    mapButton.addEventListener('click', () => card.querySelector('.map-show')?.click());
    actions.append(open, mapButton);
    const listing = card.querySelector('a.listing');
    if (listing) { const a = el('a', 'secki-listing', 'İlan ↗'); a.href = listing.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; actions.append(a); }
    main.append(titleRow, facts, status, pc, actions);
    const vote = el('div', 'secki-vote'); vote.setAttribute('role', 'group'); vote.setAttribute('aria-label', 'Oyun');
    const mainBtn = el('button', 'vote-main', 'Ana oy'); mainBtn.type = 'button'; mainBtn.dataset.kind = 'main';
    const backupBtn = el('button', 'vote-backup', 'Yedek'); backupBtn.type = 'button'; backupBtn.dataset.kind = 'backup';
    const tally = el('p', 'secki-tally'); tally.hidden = true;
    vote.append(mainBtn, backupBtn, tally);
    li.append(thumb, main, vote);
    list.append(li);
    rows.set(key(it), {li, mainBtn, backupBtn, tally, status, card});
  });

  // ---- Behaviour ----------------------------------------------------------
  let note = '';
  function choose(k, kind) {
    if (phase !== 'choose') return;
    const set = picks[kind], other = picks[kind === 'main' ? 'backup' : 'main'];
    note = '';
    if (set.has(k)) set.delete(k);
    else {
      const limit = kind === 'main' ? MAIN : BACKUP;
      if (set.size >= limit) { note = `En çok ${limit} ${kind === 'main' ? 'ana' : 'yedek'} oy verebilirsin; önce birini kaldır.`; render(); return; }
      other.delete(k); // one vote per home
      set.add(k);
    }
    render();
  }
  rows.forEach(({mainBtn, backupBtn}, k) => {
    mainBtn.addEventListener('click', () => choose(k, 'main'));
    backupBtn.addEventListener('click', () => choose(k, 'backup'));
  });
  cancel.addEventListener('click', () => { if (phase === 'confirm') { phase = 'choose'; note = ''; render(); } });
  submit.addEventListener('click', () => {
    if (phase === 'choose' && picks.main.size === MAIN) { phase = 'confirm'; render(); return; }
    if (phase === 'confirm') { send(); return; }
    if (phase === 'done' && missing().length) send(missing());
  });

  const wanted = () => [...picks.main].map(k => voteItem(itemByKey.get(k), 'main')).concat([...picks.backup].map(k => voteItem(itemByKey.get(k), 'backup')));
  let mineIds = new Set();
  const missing = () => wanted().filter(v => serverReady && !mineIds.has(v.id));

  async function send(only) {
    const todo = only || wanted();
    phase = 'sending'; note = ''; render();
    try { localStorage.setItem(LOCAL, JSON.stringify({main:[...picks.main], backup:[...picks.backup], sentAt:new Date().toISOString()})); } catch (_) {}
    let refused = 0;
    for (const v of todo) {
      let outcome = 'unknown';
      for (let attempt = 0; attempt < 3 && outcome !== 'ok'; attempt++) {
        try { outcome = await api.send('add', v); } catch (_) { outcome = 'unknown'; }
        if (outcome === 'rejected') break;
        if (outcome !== 'ok') await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      }
      if (outcome === 'rejected') refused++;
    }
    phase = 'done';
    if (refused) note = 'Sunucu oylarının bir kısmını kabul etmedi. Biraz sonra “Eksik oyları gönder”e bas.';
    await refresh();
  }

  async function refresh() {
    try {
      const all = await api.list();
      counts = new Map(); mineIds = new Set();
      all.forEach(x => {
        if (!byVoteId.has(x.id)) return;
        counts.set(x.id, Number(x.count) || 0);
        if (x.mine) mineIds.add(x.id);
      });
      serverReady = true; serverError = '';
      if (mineIds.size && phase !== 'sending') {
        // The service remembers this browser's ballot even if local storage was cleared.
        picks.main.clear(); picks.backup.clear();
        mineIds.forEach(id => { const [it, kind] = byVoteId.get(id); picks[kind].add(key(it)); });
        phase = 'done';
      }
    } catch (_) {
      serverError = 'Oylar şu an okunamadı; sayfayı biraz sonra yenile.';
    }
    render();
  }

  const totalMain = () => items.reduce((sum, it) => sum + (counts.get(voteItem(it, 'main').id) || 0), 0);
  function render() {
    const open = section.dataset.open !== 'false';
    body.hidden = !open;
    toggle.textContent = open ? 'Kapat' : 'Seçkiyi Aç';
    toggle.setAttribute('aria-expanded', String(open));
    const voters = Math.round(totalMain() / MAIN);
    sub.textContent = `${items.length} ev · ${serverReady ? (voters ? `${voters} kişi oy verdi` : 'henüz oy yok') : 'oylar yükleniyor'}${phase === 'done' ? ' · oyunu verdin' : ''}`;
    const locked = phase !== 'choose';
    rows.forEach((row, k) => {
      const kind = kindOf(k);
      row.li.dataset.vote = kind;
      row.mainBtn.setAttribute('aria-pressed', String(kind === 'main'));
      row.backupBtn.setAttribute('aria-pressed', String(kind === 'backup'));
      row.mainBtn.disabled = row.backupBtn.disabled = locked;
      row.mainBtn.hidden = row.backupBtn.hidden = phase === 'done' && !kind;
      if (phase === 'done') { row.mainBtn.hidden = kind !== 'main'; row.backupBtn.hidden = kind !== 'backup'; }
      const it = itemByKey.get(k);
      const a = counts.get(voteItem(it, 'main').id) || 0, b = counts.get(voteItem(it, 'backup').id) || 0;
      row.tally.hidden = phase !== 'done' || !serverReady;
      row.tally.textContent = `${a} ana · ${b} yedek`;
      const unavailable = row.card.dataset.availability === 'unavailable';
      row.status.hidden = !unavailable;
      row.status.textContent = unavailable ? (row.card.querySelector('.availability-status')?.textContent.trim() || 'Son kontrolde bu tarihler müsait değildi.') : '';
    });
    // Ballot bar
    cancel.hidden = phase !== 'confirm';
    if (phase === 'choose') {
      barText.textContent = note || `Ana ${picks.main.size}/${MAIN} · Yedek ${picks.backup.size}/${BACKUP}${picks.main.size < MAIN ? ` · ${MAIN - picks.main.size} ana oy daha seç` : ''}`;
      submit.textContent = 'Oyumu Ver'; submit.disabled = picks.main.size !== MAIN; submit.hidden = false;
    } else if (phase === 'confirm') {
      const names = k => { const it = itemByKey.get(k); return it ? `${items.indexOf(it) + 1}. ${it.area || ''}` : ''; };
      barText.textContent = `Ana: ${[...picks.main].map(names).join(', ')}${picks.backup.size ? ` · Yedek: ${[...picks.backup].map(names).join(', ')}` : ' · Yedek oy yok'}. Oy bir kez verilir, sonra değiştirilemez.`;
      submit.textContent = 'Onayla ve Gönder'; submit.disabled = false; submit.hidden = false;
    } else if (phase === 'sending') {
      barText.textContent = 'Oyun gönderiliyor…'; submit.disabled = true; submit.textContent = 'Gönderiliyor';
    } else {
      const lack = missing();
      barText.textContent = note || serverError || (lack.length ? 'Oyunun bir kısmı henüz ortak listede görünmüyor.' : 'Oyun kaydedildi. Teşekkürler.');
      submit.hidden = !lack.length; submit.disabled = false; submit.textContent = 'Eksik oyları gönder';
    }
    bar.dataset.phase = phase;
    renderResults();
  }

  function renderResults() {
    results.hidden = phase !== 'done' || !serverReady;
    if (results.hidden) return;
    const ranked = items.map(it => ({it, a: counts.get(voteItem(it, 'main').id) || 0, b: counts.get(voteItem(it, 'backup').id) || 0}));
    const byMain = ranked.slice().sort((x, y) => y.a - x.a || y.b - x.b);
    const topMain = byMain.filter(r => r.a > 0).slice(0, 2);
    const rest = ranked.filter(r => !topMain.includes(r)).sort((x, y) => y.b - x.b || y.a - x.a);
    const topBackup = rest.filter(r => r.b > 0).slice(0, 2);
    results.replaceChildren();
    results.append(el('h3', '', 'Sonuç'));
    const voters = Math.round(totalMain() / MAIN);
    results.append(el('p', 'secki-results-sub', `${voters} kişi oy verdi. Sıralama ana oylara, eşitlikte yedek oylara göre.`));
    const max = Math.max(1, ...ranked.map(r => r.a + r.b));
    const ol = el('ol', 'secki-rank');
    byMain.forEach(r => {
      const li = el('li');
      if (topMain.includes(r)) li.dataset.tier = 'main';
      else if (topBackup.includes(r)) li.dataset.tier = 'backup';
      const name = el('span', 'rank-name', r.it.card.querySelector('.card-title h3, .card-title h4')?.textContent.trim() || r.it.area);
      const meter = el('span', 'rank-meter'); meter.setAttribute('aria-hidden', 'true');
      const ma = el('i', 'm-a'); ma.style.width = `${(r.a / max) * 100}%`;
      const mb = el('i', 'm-b'); mb.style.width = `${(r.b / max) * 100}%`;
      meter.append(ma, mb);
      const num = el('span', 'rank-num', `${r.a} ana · ${r.b} yedek`);
      const tier = el('span', 'rank-tier', li.dataset.tier === 'main' ? 'Önce bunlara bakılır' : li.dataset.tier === 'backup' ? 'Olmazsa bunlara' : '');
      li.append(name, meter, num, tier);
      ol.append(li);
    });
    results.append(ol);
  }

  toggle.addEventListener('click', () => {
    section.dataset.open = String(section.dataset.open === 'false');
    try { localStorage.setItem(OPEN, section.dataset.open); } catch (_) {}
    render();
  });
  try { if (localStorage.getItem(OPEN) === 'false' && location.hash !== '#secki') section.dataset.open = 'false'; } catch (_) {}
  if (location.hash === '#secki') requestAnimationFrame(() => section.scrollIntoView({block:'start'}));
  window.addEventListener('hashchange', () => { if (location.hash === '#secki') { section.dataset.open = 'true'; render(); section.scrollIntoView({block:'start'}); } });
  document.addEventListener('availability-updated', render);
  render();
  refresh();
  // Others vote too: read again now and then while the page is visible.
  setInterval(() => { if (document.visibilityState === 'visible' && phase !== 'sending') refresh(); }, 60000);
})();
