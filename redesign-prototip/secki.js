/* Seçki: a short list chosen by the group, shown above the results and beside
   the map, with a ballot. Everyone gives 2 main and up to 2 backup votes, each
   to a different home, once, with a personal one-time code. Each home shows
   one total (main and backup together); which vote was main or backup never
   shows. When the vote is closed, only the two most-voted homes show who
   voted for them; every other vote stays nameless.
   Main votes decide first; if those homes fall through, backups are looked at.
   The live ballot lives on a small Apps Script service (secki.json "server");
   without one (the preview) a stand-in keeps everything in this browser. */
(function () {
  'use strict';
  const dataNode = document.getElementById('secki-data');
  const root = document.querySelector('.results-content');
  if (!dataNode || !root) return;
  let data;
  try { data = JSON.parse(dataNode.textContent); } catch (_) { return; }
  if (!data || !Array.isArray(data.items) || !data.items.length) return;
  const MAIN = Number(data.ballot?.main) || 2, BACKUP = Number(data.ballot?.backup) || 2;
  const VOTERS = Number(data.ballot?.voters) || 6;
  // Yasin (16 Nov, after the vote closed): asıl and yedek homes by ranked points
  // (Asıl 1 = 4 … Yedek 2 = 1; a tie goes to the home put first more often).
  // Worked out once from the closed ballots; the service itself is unchanged.
  const RESULT = Array.isArray(data.result?.order) && data.result.order.length ? data.result : null;
  const allCards = Array.from(document.querySelectorAll('.groups .stay-card'));
  const findCard = it => allCards.find(c => c.dataset.id === it.id && c.dataset.checkIn === it.checkIn && c.dataset.checkOut === it.checkOut) || null;
  const items = data.items.map(it => ({...it, card: findCard(it)})).filter(it => it.card);
  if (!items.length) return;
  items.forEach(it => { it.card.dataset.secki = 'true'; });
  const key = it => `${it.id}|${it.checkIn}|${it.checkOut}`;
  const itemByKey = new Map(items.map(it => [key(it), it]));
  const itemByCard = new Map(items.map(it => [it.card, it]));
  const numberOf = it => items.indexOf(it) + 1;
  const titleOf = it => it.card.querySelector('.card-title h3, .card-title h4')?.textContent.trim() || it.area || it.id;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // ---- Service ------------------------------------------------------------
  const SERVER = typeof data.server === 'string' && /^https:\/\//.test(data.server) ? data.server : '';
  const preview = window.BerlinPrototype === true || !SERVER;
  const PREVIEW_STORE = 'berlin-secki-preview-v2';
  // Preview stand-in: demo codes, no network, nothing leaves this browser.
  const demoCodes = Array.from({length: VOTERS}, (_, i) => [`DENEME-${i + 1}`, `Kişi ${i + 1}`]);
  // Same rules as the server (secki-oylama-sunucu.gs summary_), for the preview:
  // one total per home; once closed, a ranking where only places 1 and 2 (and
  // anything tied exactly with place 2) carry the voters' names.
  const RANK_BY = 'total'; // 'total': all four votes count, main breaks ties
  function tallyOf(ballots) {
    const keys = data.items.map(it => `${it.id}|${it.checkIn}|${it.checkOut}`), t = {};
    keys.forEach(k => { t[k] = {total: 0, main: 0, names: []}; });
    ballots.forEach(b => {
      b.main.forEach(k => { if (t[k]) { t[k].total++; t[k].main++; t[k].names.push(b.name); } });
      b.backup.forEach(k => { if (t[k]) { t[k].total++; t[k].names.push(b.name); } });
    });
    const counts = {};
    keys.forEach(k => { if (t[k].total) counts[k] = {total: t[k].total}; });
    const score = k => RANK_BY === 'main' ? [t[k].main, t[k].total] : [t[k].total, t[k].main];
    const order = keys.slice().sort((x, y) => { const a = score(x), b = score(y); return b[0] - a[0] || b[1] - a[1] || keys.indexOf(x) - keys.indexOf(y); });
    const cut = order[1], same = (x, y) => y && score(x)[0] === score(y)[0] && score(x)[1] === score(y)[1];
    let place = 0, prev = null;
    const ranking = order.map((k, i) => {
      if (!prev || !same(k, prev)) place = i + 1;
      prev = k;
      const r = {key: k, total: t[k].total, place};
      if (t[k].total > 0 && (i < 2 || same(k, cut))) r.names = t[k].names.slice().sort((a, b) => a.localeCompare(b, 'tr'));
      return r;
    });
    return {counts, ranking};
  }
  const DEMO_ADMIN = 'DENEME-YONETICI';
  // Same folding as the server: case and Turkish letters do not matter ("tuğrul" = "TUGRUL").
  const FOLD = {'ç': 'C', 'Ç': 'C', 'ğ': 'G', 'Ğ': 'G', 'ı': 'I', 'İ': 'I', 'ö': 'O', 'Ö': 'O', 'ş': 'S', 'Ş': 'S', 'ü': 'U', 'Ü': 'U', 'â': 'A', 'Â': 'A', 'î': 'I', 'Î': 'I', 'û': 'U', 'Û': 'U'};
  const norm = code => String(code || '').normalize('NFC').trim().replace(/[çÇğĞıİöÖşŞüÜâÂîÎûÛ]/g, ch => FOLD[ch]).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, '');
  const localApi = {
    load() { try { return JSON.parse(localStorage.getItem(PREVIEW_STORE) || 'null') || {ballots: [], closed: false}; } catch (_) { return {ballots: [], closed: false}; } },
    save(db) { localStorage.setItem(PREVIEW_STORE, JSON.stringify(db)); },
    summary(db) {
      const t = tallyOf(db.ballots.map(b => ({name: b.name, main: b.main, backup: b.backup})));
      return {ok: true, open: !db.closed, total: VOTERS, voted: db.ballots.length, counts: t.counts, ranking: db.closed ? t.ranking : null};
    },
    async status() { await wait(150); return this.summary(this.load()); },
    async check(code) {
      await wait(250);
      const hit = demoCodes.find(([c]) => c === norm(code)), db = this.load();
      if (!hit) return {ok: false, error: 'invalid'};
      return {ok: true, used: db.ballots.some(b => b.code === hit[0])};
    },
    async vote(code, main, backup) {
      await wait(400);
      const db = this.load(), hit = demoCodes.find(([c]) => c === norm(code));
      const all = [...main, ...backup];
      if (main.length !== MAIN || backup.length !== BACKUP || new Set(all).size !== all.length || !all.every(k => itemByKey.has(k))) return {ok: false, error: 'bad'};
      if (db.closed) return {ok: false, error: 'closed'};
      if (!hit) return {ok: false, error: 'invalid'};
      if (db.ballots.some(b => b.code === hit[0])) return {ok: false, error: 'used'};
      db.ballots.push({code: hit[0], name: hit[1], main, backup, at: new Date().toISOString()});
      this.save(db);
      return {ok: true};
    },
    async close(admin) {
      await wait(250);
      if (norm(admin) !== DEMO_ADMIN) return {ok: false, error: 'invalid'};
      const db = this.load(); db.closed = true; this.save(db); return {ok: true};
    },
    async unvote(admin, code) {
      await wait(250);
      if (norm(admin) !== DEMO_ADMIN) return {ok: false, error: 'invalid'};
      const hit = demoCodes.find(([c]) => c === norm(code));
      if (!hit) return {ok: false, error: 'who'};
      const db = this.load(), before = db.ballots.length;
      db.ballots = db.ballots.filter(b => b.code !== hit[0]); this.save(db);
      return {ok: true, removed: before - db.ballots.length};
    },
    async reset() { localStorage.removeItem(PREVIEW_STORE); }
  };
  const remoteApi = {
    async status() {
      const r = await fetch(`${SERVER}?action=status&t=${Date.now()}`, {cache: 'no-store'});
      return r.json();
    },
    async post(payload) {
      // text/plain keeps this a simple request (no CORS preflight to Apps Script).
      const r = await fetch(SERVER, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify(payload)});
      return r.json();
    },
    check(code) { return this.post({action: 'check', code: norm(code)}); },
    vote(code, main, backup) { return this.post({action: 'vote', code: norm(code), main, backup}); },
    close(admin) { return this.post({action: 'close', admin: norm(admin)}); },
    unvote(admin, code) { return this.post({action: 'unvote', admin: norm(admin), code: norm(code)}); }
  };
  const api = preview ? localApi : remoteApi;

  // ---- State --------------------------------------------------------------
  // This device remembers the ballot it sent (its picks) so the voter sees
  // it again; the service is what actually keeps a code from voting twice.
  const LOCAL = 'berlin-secki-ballot-v2', OPEN = 'berlin-secki-open-v1';
  const picks = {main: new Set(), backup: new Set()};
  let phase = 'choose'; // choose | confirm | sending | done
  let status = null, statusError = '', note = '';
  let voter = null; // {code}: set by the code gate, kept in memory only
  let inVote = false; // the vote panel (full-screen map + list) is open
  let mine = null; // {main, backup, at}
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL) || 'null');
    if (saved && Array.isArray(saved.main) && Array.isArray(saved.backup) && saved.at) {
      mine = saved;
      saved.main.forEach(k => itemByKey.has(k) && picks.main.add(k));
      saved.backup.forEach(k => itemByKey.has(k) && picks.backup.add(k));
      phase = 'done';
    }
  } catch (_) {}
  // Once the result is out, the badges (rows, pins) show it instead of this device's ballot.
  const resultEntry = k => RESULT ? RESULT.order.find(r => r.key === k) || null : null;
  const resultSlot = k => resultEntry(k)?.slot || '';
  const kindOf = k => {
    if (resultOn()) { const s = resultSlot(k); return s.startsWith('Asıl') ? 'main' : s.startsWith('Yedek') ? 'backup' : ''; }
    return picks.main.has(k) ? 'main' : picks.backup.has(k) ? 'backup' : '';
  };
  const rankOf = k => {
    if (resultOn()) { const s = resultSlot(k); return s ? Number(s.split(' ')[1]) || 1 : 0; }
    const kind = kindOf(k); return kind ? [...picks[kind]].indexOf(k) + 1 : 0;
  };
  const countOf = k => {
    const c = status?.counts?.[k] || {};
    const main = Number(c.main) || 0, backup = Number(c.backup) || 0;
    return {total: Number(c.total ?? main + backup) || 0, main, backup};
  };
  const closedNow = () => status?.open === false;
  const isOpen = () => !status || status.open !== false;
  // Live: shown unless the service says the vote is open. Preview: after its own close.
  function resultOn() { return Boolean(RESULT) && (preview ? closedNow() : status?.open !== true); }
  const resultLabel = r => r.label || (itemByKey.get(r.key) ? titleOf(itemByKey.get(r.key)) : '');
  const resultPicks = () => RESULT ? RESULT.order.filter(r => r.slot) : [];

  // ---- Small builders -----------------------------------------------------
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  // ---- Night public transport (VBB timetable; Lime only as a marked estimate)
  // Shown in the listing's detail view (Ulaşım tab), not on the seçki row.
  const CLUBS = [['tresor', 'Tresor', "Tresor'a", "Tresor'dan"], ['rso', 'RSO', "RSO'ya", "RSO'dan"]];
  const fmtKm = new Intl.NumberFormat('tr-TR', {minimumFractionDigits: 1, maximumFractionDigits: 1});
  const fmtM = new Intl.NumberFormat('tr-TR');
  const roadKm = (it, k) => Number.isFinite(it.transit?.[k]?.roadKm) ? `${fmtKm.format(it.transit[k].roadKm)} km` : '';
  const legText = l => l.walkM != null ? `yürü ${fmtM.format(l.walkM)} m (${l.min} dk)` : `${l.line} ${l.min} dk`;
  const limeText = e => Number.isFinite(e?.limeMin) && e.limeMin < e.min ? `yürüme yerine Lime ≈ ${e.limeMin} dk` : '';
  function transitBlock(it) {
    const t = it.transit;
    if (!t) return null;
    const box = el('div', 'secki-transit');
    CLUBS.forEach(([k, name, to, from]) => {
      const c = t[k];
      if (!c) return;
      const head = el('p', 'secki-transit-line');
      head.append(el('b', '', `${to}`));
      const car = it.card?.dataset[`${k}CarMin`];
      const parts = [car && `taksi ${Math.round(Number(car))} dk`, roadKm(it, k) && `${roadKm(it, k)} yol`,
        c.go && `toplu taşıma ${c.go.min} dk`].filter(Boolean);
      head.append(document.createTextNode(' ' + parts.join(' · ')));
      box.append(head);
      [['go', 'Gidiş, 31 Ara 23:30'], ['back', 'Dönüş, 1 Oca 05:00']].forEach(([dir, label]) => {
        const e = c[dir];
        if (!e) return;
        const p = el('p', 'secki-transit-route');
        p.append(el('span', 'secki-transit-label', `${label}: ${e.min} dk`));
        const lime = limeText(e);
        p.append(document.createTextNode(` · ${e.legs.map(legText).join(' › ')}` + (lime ? ` · ${lime}` : '')));
        box.append(p);
      });
    });
    const n = data.transitNote || {};
    box.append(el('p', 'secki-transit-note', [n.source, n.silvester, n.lime, n.road].filter(Boolean).join(' ')));
    return box;
  }
  // The large view's panels are inflated on first open ('berlin-more').
  function addTransitToDetail(it) {
    const panel = it.card.querySelector('[data-panel="route"]');
    if (!panel || panel.querySelector('.secki-transit-detail')) return;
    const block = transitBlock(it);
    if (!block) return;
    block.classList.add('secki-transit-detail');
    const title = panel.querySelector('.panel-title');
    if (title) title.after(block); else panel.prepend(block);
  }
  items.forEach(addTransitToDetail);
  document.addEventListener('berlin-more', e => { const it = itemByCard.get(e.detail?.card); if (it) addTransitToDetail(it); });

  const button = (cls, text) => { const b = el('button', cls, text); b.type = 'button'; return b; };
  const badgeText = (kind, rank) => kind === 'main' ? `Asıl ${rank}` : `Yedek ${rank}`;
  function badge() { const b = el('span', 'secki-badge'); b.hidden = true; return b; }
  function paintBadge(node, k) {
    const kind = kindOf(k), rank = rankOf(k);
    node.hidden = !kind; node.dataset.kind = kind;
    node.replaceChildren();
    if (!kind) { node.removeAttribute('aria-label'); return; }
    node.append(el('span', 'secki-badge-mark', kind === 'main' ? '★' : '☆'), document.createTextNode(badgeText(kind, rank)));
    node.setAttribute('aria-label', kind === 'main' ? `${rank}. asıl seçimin` : `${rank}. yedek seçimin`);
  }
  const tallyText = k => { const r = resultOn() && resultEntry(k); return r ? `${r.points} puan` : `${countOf(k).total} oy`; };
  // The photo tile's chip on a phone: the slot for the four picks, points for the rest.
  const chipText = k => { const r = resultOn() && resultEntry(k); return r ? (r.slot || `${r.points} puan`) : tallyText(k); };
  function thumbSrc(card) {
    const img0 = card.querySelector('.photo-grid img');
    let src = img0 ? (img0.getAttribute('src') || img0.dataset.gmSrc || '') : '';
    if (src.startsWith('data:')) src = img0.dataset.gmSrc || '';
    // Small copies: a row needs ~200 px, not the card's 1024 px photo.
    return src.replace('/max1024x768/', '/max500/').replace(/([?&]im_w=)\d+/, '$1480');
  }
  function openCard(card) {
    const guest = document.querySelector('.filter-guests');
    const adults = card.dataset.offerAdults;
    if (guest && /^[67]$/.test(adults || '') && guest.value !== adults && card.hidden) { guest.value = adults; guest.dispatchEvent(new Event('change', {bubbles: true})); }
    card.querySelector('.card-open-main')?.click();
  }
  const fmtEur = new Intl.NumberFormat('tr-TR', {maximumFractionDigits: 0});
  const trDay = iso => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('tr-TR', {day: 'numeric', month: 'long'}).format(d) : ''; };
  // Availability and the all-in price: a seçki check (item.check) wins over the card.
  function availabilityOf(it) {
    const c = it.check;
    if (c && typeof c.available === 'boolean') return {state: c.available ? 'available' : 'unavailable', when: trDay(c.checkedAt)};
    const s = it.card.dataset.availability;
    return {state: s === 'available' || s === 'unavailable' ? s : 'unknown', when: ''};
  }
  function availabilityText(it) {
    const a = availabilityOf(it);
    if (a.state === 'available' && it.check?.available4Nights === false) return `${trDay(it.checkIn)}–${trDay(it.checkOut)} müsait · 4 gece müsait değil${a.when ? ` · ${a.when} kontrolü` : ''}`;
    if (a.state === 'available') return `Müsait${a.when ? ` · ${a.when} kontrolü` : ''}`;
    if (a.state === 'unavailable') return `Müsait değil${a.when ? ` · ${a.when} kontrolü` : ''}`;
    return 'Müsaitlik doğrulanmadı';
  }
  const allInEur = it => { const v = it.check?.allInEur; return typeof v === 'number' && Number.isFinite(v) ? v : null; };
  // The all-in total from the seçki check, and how sure it is about the city tax.
  function allInText(it) {
    const c = it.check, total = allInEur(it);
    if (total === null) return '';
    const head = `${c.allInConfirmed ? 'Her şey dahil' : 'Toplam'} ${c.allInConfirmed ? '' : '≈ '}${fmtEur.format(Math.round(total))} € (kişi başı ${fmtEur.format(Math.round(total / 6))} €)`;
    const tax = typeof c.cityTaxEur === 'number' ? fmtEur.format(Math.round(c.cityTaxEur)) : '';
    if (c.allInConfirmed) return `${head} · vergi ve temizlik dahil, ödeme sayfasında görüldü`;
    if (c.cityTaxIncluded === false) return `${head} · şehir vergisi${tax ? ` (≈ ${tax} €)` : ''} ödeme sayfasında yok, toplama biz ekledik`;
    return `${head} · şehir vergisi gösterilmiyor, ev sahibi yerinde isteyebilir`;
  }

  // Street View at the listing's point. Many listings only show the
  // neighbourhood until booking, so say when the point is approximate.
  // Two separate controls (Yasin, 16 Nov: "ayır, anlaşılsın"): "Sokağı gör"
  // opens it inside the map (map.js, "secki-street"); "Google Maps ↗" leaves
  // for Google in a new tab.
  const exactPoint = card => card.dataset.mapAccuracy === 'address';
  const streetUrl = card => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${Number(card.dataset.lat)},${Number(card.dataset.lon)}`;
  function streetLinks(it, cls, text, outText = 'Google Maps ↗') {
    if (!Number.isFinite(Number(it.card.dataset.lat)) || !it.card.dataset.lat) return [];
    const url = streetUrl(it.card);
    const inPage = button(`${cls} secki-sv`, text);
    inPage.title = exactPoint(it.card) ? 'Sokak görünümü bu sayfada, haritanın üstünde açılır' : 'Sokak görünümü bu sayfada açılır; konum yaklaşık, evin önü olmayabilir';
    inPage.addEventListener('click', event => {
      event.stopPropagation();
      const detail = {card: it.card, handled: false};
      inPage.dispatchEvent(new CustomEvent('secki-street', {bubbles: true, detail}));
      if (!detail.handled) window.open(url, '_blank', 'noopener');
    });
    const out = el('a', `${cls} secki-gmaps`, outText); out.href = url; out.target = '_blank'; out.rel = 'noopener noreferrer';
    out.title = 'Google Haritalar yeni sekmede açılır';
    out.addEventListener('click', event => event.stopPropagation());
    return [inPage, out];
  }

  // Vote buttons for one home; several copies (panel, map list, map card) stay in sync.
  const voteBoxes = new Set();
  function voteBox(it, compact = false, keep = false) {
    const k = key(it);
    const box = el('div', `secki-vote${compact ? ' is-compact' : ''}`); box.setAttribute('role', 'group'); box.setAttribute('aria-label', `${numberOf(it)}. ev için oyun`);
    const mainBtn = button('vote-main', 'Asıl'); mainBtn.dataset.kind = 'main';
    const backupBtn = button('vote-backup', 'Yedek'); backupBtn.dataset.kind = 'backup';
    const tally = el('p', 'secki-tally');
    mainBtn.addEventListener('click', event => { event.stopPropagation(); choose(k, 'main'); });
    backupBtn.addEventListener('click', event => { event.stopPropagation(); choose(k, 'backup'); });
    box.append(mainBtn, backupBtn, tally);
    const entry = {box, k, mainBtn, backupBtn, tally, keep};
    voteBoxes.add(entry); paintVote(entry);
    return box;
  }
  function paintVote({k, mainBtn, backupBtn, tally}) {
    const kind = kindOf(k), locked = phase !== 'choose' || !isOpen() || !voter;
    mainBtn.setAttribute('aria-pressed', String(kind === 'main'));
    backupBtn.setAttribute('aria-pressed', String(kind === 'backup'));
    mainBtn.textContent = kind === 'main' ? `★ Asıl ${rankOf(k)}` : 'Asıl';
    backupBtn.textContent = kind === 'backup' ? `☆ Yedek ${rankOf(k)}` : 'Yedek';
    mainBtn.disabled = backupBtn.disabled = locked;
    // Without a code only the counts (and this device's own sent ballot) show.
    const showAll = voter && phase !== 'done' && isOpen();
    mainBtn.hidden = resultOn() || (!showAll && kind !== 'main');
    backupBtn.hidden = resultOn() || (!showAll && kind !== 'backup');
    tally.hidden = !status && !resultOn();
    tally.textContent = status || resultOn() ? tallyText(k) : '';
  }

  // ---- Panel markup -------------------------------------------------------
  const section = el('section', 'secki'); section.id = 'secki'; section.setAttribute('aria-labelledby', 'secki-title');
  const head = el('div', 'secki-head');
  const headText = el('div', 'secki-head-text');
  const h2 = el('h2', '', 'Seçki'); h2.id = 'secki-title';
  const sub = el('p', 'secki-sub');
  headText.append(h2, sub);
  const toggle = button('secki-toggle'); toggle.setAttribute('aria-controls', 'secki-body');
  const headButtons = el('div', 'secki-head-buttons');
  const toMap = button('secki-to-map', 'Haritada Gör');
  toMap.addEventListener('click', () => section.dispatchEvent(new CustomEvent('secki-map', {bubbles: true})));
  headButtons.append(toMap, toggle);
  head.append(headText, headButtons);
  const body = el('div', 'secki-body'); body.id = 'secki-body';
  const how = el('p', 'secki-how');
  const HOW = `Herkes ${MAIN} asıl ve ${BACKUP} yedek oy verir; dördü de zorunlu ve her oy ayrı bir eve gider. Önce en çok oy alan iki eve bakılır (eşitlikte asıl oyu fazla olan öne geçer), onlar olmazsa sıradakilere. Oy, sana verilen tek kullanımlık şifreyle bir kez verilir. Her evin yalnız toplam oyu görünür; hangi oyun asıl, hangisinin yedek olduğu anlaşılmaz. Oylama bitince yalnız en çok oy alan iki eve kimlerin oy verdiği yazar, öteki oylar isimsiz kalır.`;
  how.textContent = HOW;
  const list = el('ol', 'secki-list');
  const results = el('div', 'secki-results'); results.hidden = true;
  const foot = el('div', 'secki-foot');
  body.append(how, list, results);
  section.append(head, body);
  root.prepend(section);

  const rows = new Map();
  items.forEach(it => {
    const card = it.card, k = key(it);
    const li = el('li', 'secki-row'); li.dataset.key = k;
    const thumb = button('secki-thumb'); thumb.setAttribute('aria-label', `${titleOf(it)}: ilanı aç`);
    const src = thumbSrc(card);
    if (src) { const img = el('img'); img.src = src; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer'; thumb.append(img); }
    thumb.append(el('span', 'secki-thumb-hint', 'İlanı aç'));
    const main = el('div', 'secki-main');
    const titleRow = el('div', 'secki-title');
    titleRow.append(el('span', 'secki-no', String(numberOf(it))));
    const titleText = el('div', 'secki-title-text');
    const h3 = el('h3'); const titleBtn = button('secki-title-open', titleOf(it)); h3.append(titleBtn);
    const b = badge();
    titleText.append(h3, el('p', 'secki-area', (card.querySelector('.card-title .area')?.textContent || it.area || '').replace(/^[^·]*·\s*/, '').trim()));
    titleRow.append(titleText, b);
    const facts = el('p', 'secki-facts');
    const price = card.querySelector('.amount > strong')?.textContent.trim() || '';
    const eur = Number(card.dataset.priceEur);
    const nights = card.querySelector('.quote-label')?.textContent.split('·')[0].trim() || '';
    const per6 = card.querySelector('tr[data-share-people="6"] .share-main')?.textContent.trim() || '';
    const beds = card.querySelector('.fact-tile[data-tab="beds"] b')?.textContent.trim() || '';
    const rooms = card.querySelector('.fact-tile[data-tab="overview"] b')?.textContent.trim() || '';
    facts.append(el('b', '', price + (price.includes('€') || !Number.isFinite(eur) ? '' : ` (≈ ${fmtEur.format(eur)} €)`)));
    [nights, per6 && `kişi başı ${per6}`, card.dataset.tresorCarMin && `taksiyle Tresor ${card.dataset.tresorCarMin} dk` + (roadKm(it, 'tresor') ? ` (${roadKm(it, 'tresor')})` : ''), card.dataset.rsoCarMin && `RSO ${card.dataset.rsoCarMin} dk` + (roadKm(it, 'rso') ? ` (${roadKm(it, 'rso')})` : ''), beds, rooms]
      .filter(Boolean).forEach(text => facts.append(document.createTextNode(' · ' + text)));
    const check = el('p', 'secki-check');
    const avail = el('span', 'secki-avail');
    const allIn = el('span', 'secki-allin');
    check.append(avail, allIn);
    const pc = el('div', 'secki-pc');
    const pros = el('ul', 'secki-pros'); pros.setAttribute('aria-label', 'Artılar');
    (it.pros || []).forEach(t => pros.append(el('li', '', t)));
    const cons = el('ul', 'secki-cons'); cons.setAttribute('aria-label', 'Eksiler');
    (it.cons || []).forEach(t => cons.append(el('li', '', t)));
    pc.append(pros, cons);
    const actions = el('div', 'secki-actions');
    const open = button('secki-open', 'Ayrıntılar');
    open.addEventListener('click', () => openCard(card));
    thumb.addEventListener('click', () => openCard(card));
    titleBtn.addEventListener('click', () => openCard(card));
    const mapButton = button('secki-map', 'Harita');
    mapButton.addEventListener('click', () => card.querySelector('.map-show')?.click());
    actions.append(open, mapButton);
    const streets = streetLinks(it, 'secki-street', 'Sokağı gör');
    actions.append(...streets);
    const listing = card.querySelector('a.listing');
    if (listing) { const a = el('a', 'secki-listing', 'İlan ↗'); a.href = listing.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; actions.append(a); }
    if (streets.length && !exactPoint(card)) actions.append(el('span', 'secki-street-note', 'Konum yaklaşık; sokak görünümü evin önü olmayabilir.'));
    main.append(titleRow, facts, check, pc, actions);
    li.append(thumb, main, voteBox(it, false, true));
    list.append(li);
    rows.set(k, {li, badge: b, avail, allIn, it});
  });

  // ---- Ballot bar (in the panel and under the map list) -------------------
  const bars = [];
  function makeBar(where) {
    const node = el('div', `secki-bar secki-bar-${where}`);
    const text = el('p', 'secki-bar-text'); text.setAttribute('role', 'status'); text.setAttribute('aria-live', 'polite');
    const buttons = el('div', 'secki-bar-buttons');
    const cancel = button('secki-cancel', 'Vazgeç');
    const submit = button('secki-submit');
    buttons.append(cancel, submit);
    node.append(text, buttons);
    cancel.addEventListener('click', () => { if (phase === 'confirm') { phase = 'choose'; note = ''; render(); } });
    submit.addEventListener('click', () => onSubmit(where));
    const bar = {node, text, cancel, submit, where};
    bars.push(bar);
    return bar;
  }
  const panelBar = makeBar('panel');
  body.append(panelBar.node, foot);

  // ---- Code gate: the vote panel opens only with a personal code ----------
  const gate = el('dialog', 'secki-gate'); gate.setAttribute('aria-labelledby', 'secki-gate-title');
  const gateForm = el('form', 'secki-gate-form'); gateForm.method = 'dialog';
  const gateTitle = el('h3', '', 'Oy ver'); gateTitle.id = 'secki-gate-title';
  const gateText = el('p', 'secki-gate-text', 'Şifreni gir. Şifre doğrulanınca yalnız seçki evlerinin olduğu oy paneli açılır. Her şifreyle bir kez oy verilir; oy gönderilemezse aynı şifreyle yeniden denenebilir.');
  const gateLabel = el('label', 'secki-code-label');
  const gateInput = el('input', 'secki-code-input');
  Object.assign(gateInput, {type: 'text', autocomplete: 'off', spellcheck: false, placeholder: 'Oy şifren', required: true});
  gateInput.setAttribute('autocapitalize', 'characters');
  gateLabel.append(el('span', '', 'Şifre'), gateInput);
  const gateMsg = el('p', 'secki-code-who'); gateMsg.setAttribute('role', 'status');
  const gateButtons = el('div', 'secki-gate-buttons');
  const gateCancel = button('secki-cancel', 'Vazgeç');
  const gateGo = el('button', 'secki-submit', 'Gir'); gateGo.type = 'submit';
  gateButtons.append(gateCancel, gateGo);
  gateForm.append(gateTitle, gateText, gateLabel, gateMsg, gateButtons);
  gate.append(gateForm);
  document.body.append(gate);
  gateCancel.addEventListener('click', () => gate.close());
  gate.addEventListener('click', event => { if (event.target === gate) gate.close(); });
  function openGate() {
    if (!isOpen()) return;
    gateInput.value = ''; gateMsg.textContent = ''; gateMsg.dataset.state = ''; gateGo.disabled = false;
    // Above a modal map (phone) the gate must join the top layer too.
    if (typeof gate.showModal === 'function') gate.showModal(); else gate.setAttribute('open', '');
    gateInput.focus();
  }
  gateForm.addEventListener('submit', async event => {
    event.preventDefault();
    const asked = norm(gateInput.value);
    if (asked.length < 4) { gateMsg.dataset.state = 'invalid'; gateMsg.textContent = 'Şifreyi gir.'; return; }
    gateGo.disabled = true; gateMsg.dataset.state = 'checking'; gateMsg.textContent = 'Kontrol ediliyor…';
    let r = null;
    try { r = await api.check(asked); } catch (_) { r = null; }
    gateGo.disabled = false;
    if (!r) { gateMsg.dataset.state = 'invalid'; gateMsg.textContent = 'Bağlantı kurulamadı; biraz sonra tekrar dene.'; return; }
    if (!r.ok) { gateMsg.dataset.state = 'invalid'; gateMsg.textContent = 'Şifre tanınmadı.'; return; }
    if (r.used) { gateMsg.dataset.state = 'used'; gateMsg.textContent = 'Bu şifreyle oy verilmiş. Her şifre bir kez kullanılır.'; return; }
    // A new voter starts from a clean ballot, even on a device used before.
    voter = {code: asked};
    mine = null; picks.main.clear(); picks.backup.clear(); phase = 'choose'; note = '';
    try { localStorage.removeItem(LOCAL); } catch (_) {}
    gate.close();
    inVote = true;
    render();
    section.dispatchEvent(new CustomEvent('secki-vote-open', {bubbles: true}));
  });
  function leaveVote() {
    inVote = false;
    if (phase !== 'sending') { voter = null; if (phase !== 'done') { picks.main.clear(); picks.backup.clear(); phase = 'choose'; } }
    render();
  }
  document.addEventListener('secki-vote-ended', leaveVote);

  // What is still missing, in plain words ("2 yedek oy vermedin").
  function missingText() {
    const m = MAIN - picks.main.size, b = BACKUP - picks.backup.size;
    const parts = [m > 0 && `${m} asıl`, b > 0 && `${b} yedek`].filter(Boolean);
    return parts.length ? `Henüz ${parts.join(' ve ')} oy vermedin; ${MAIN} asıl ve ${BACKUP} yedeğin dördü de zorunlu.` : '';
  }
  function onSubmit(where) {
    if (!isOpen()) return;
    if (!voter && phase !== 'done') { openGate(); return; }
    if (phase === 'choose') {
      const missing = missingText();
      if (missing) { note = missing; render(); return; }
      phase = 'confirm'; note = ''; render(); return;
    }
    if (phase === 'confirm') { send(); return; }
    if (phase === 'done') {
      if (where === 'map' && inVote) { mapList.dispatchEvent(new CustomEvent('secki-vote-exit', {bubbles: true})); return; }
      openGate(); // someone else on this device
    }
  }

  async function send() {
    if (!voter) { openGate(); return; }
    phase = 'sending'; note = ''; render();
    const main = [...picks.main], backup = [...picks.backup];
    let r = null, lost = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { r = await api.vote(voter.code, main, backup); break; } catch (_) { lost = true; await wait(1200 * (attempt + 1)); }
    }
    // A lost answer may hide a vote the server did store: "used" right after it means ours.
    if (r && !r.ok && r.error === 'used' && lost) r = {ok: true};
    if (r && r.ok) {
      mine = {main, backup, at: new Date().toISOString()};
      try { localStorage.setItem(LOCAL, JSON.stringify(mine)); } catch (_) {}
      phase = 'done'; voter = null;
    } else {
      phase = 'confirm';
      note = !r ? 'Oy gönderilemedi; bağlantını kontrol edip tekrar dene.'
        : r.error === 'used' ? 'Bu şifreyle zaten oy verilmiş.'
        : r.error === 'invalid' ? 'Şifre tanınmadı.'
        : r.error === 'closed' ? 'Oylama kapandı.'
        : 'Oy kabul edilmedi; seçimini kontrol et.';
    }
    await refresh();
  }

  function choose(k, kind) {
    if (phase !== 'choose' || !isOpen()) return;
    const set = picks[kind], other = picks[kind === 'main' ? 'backup' : 'main'];
    note = '';
    if (set.has(k)) set.delete(k);
    else {
      const limit = kind === 'main' ? MAIN : BACKUP;
      if (set.size >= limit) { note = `En çok ${limit} ${kind === 'main' ? 'asıl' : 'yedek'} oy verebilirsin; önce birini kaldır.`; render(); return; }
      other.delete(k); // one vote per home
      set.add(k);
    }
    render();
  }

  async function refresh() {
    try {
      const r = await api.status();
      if (!r || !r.ok) throw new Error('status');
      status = r; statusError = '';
    } catch (_) {
      statusError = 'Oy sayıları şu an okunamadı; biraz sonra tekrar denenecek.';
    }
    render();
  }

  // ---- Rendering ----------------------------------------------------------
  // Short names (number + the part before "|") keep ballots readable on a phone.
  const shortTitle = it => titleOf(it).split('|')[0].trim();
  const nameList = keys => keys.map(k => { const it = itemByKey.get(k); return it ? `${numberOf(it)}. ${shortTitle(it)}` : ''; }).filter(Boolean);
  function paintBars() {
    bars.forEach(bar => {
      const {text, cancel, submit, where} = bar;
      cancel.hidden = phase !== 'confirm';
      submit.hidden = false; submit.disabled = false; submit.classList.remove('is-quiet');
      if (!isOpen()) {
        const picked = resultOn() ? resultPicks() : [];
        const names = slot => picked.filter(r => r.slot.startsWith(slot)).map(resultLabel).join(', ');
        text.textContent = picked.length ? `Sonuç · Asıl: ${names('Asıl')} · Yedek: ${names('Yedek')}` : 'Oylama bitti. Sonuç seçki panelinde.';
        submit.hidden = true; cancel.hidden = true;
      } else if (phase === 'done') {
        text.textContent = note || 'Oyun kaydedildi. Teşekkürler.';
        if (where === 'map' && inVote) submit.textContent = 'Paneli kapat';
        else { submit.textContent = 'Başka biri oy verecek'; submit.classList.add('is-quiet'); }
      } else if (!voter) {
        // Two parts so a phone's map bar can keep only the count.
        text.replaceChildren(el('span', 'secki-bar-lead', 'Oy vermek için sana verilen şifreyle gir. '), el('span', 'secki-bar-count', status ? `${status.voted || 0}/${status.total || VOTERS} kişi oy verdi.` : ''));
        submit.textContent = 'Oy Ver';
      } else if (phase === 'choose') {
        text.textContent = note || `Asıl ${picks.main.size}/${MAIN} · Yedek ${picks.backup.size}/${BACKUP}`;
        submit.textContent = 'Oyumu Ver';
        submit.classList.toggle('is-quiet', Boolean(missingText()));
      } else if (phase === 'confirm') {
        text.textContent = note || `Asıl: ${nameList([...picks.main]).join(', ')} · Yedek: ${nameList([...picks.backup]).join(', ')}. Oy bir kez verilir, sonra değiştirilemez.`;
        submit.textContent = 'Onayla ve Gönder';
      } else {
        text.textContent = 'Oyun gönderiliyor…'; submit.disabled = true; submit.textContent = 'Gönderiliyor';
      }
      bar.node.dataset.phase = !isOpen() ? 'closed' : phase === 'done' ? 'done' : voter ? phase : 'gate';
    });
  }

  // The result puts the four picks first, then the rest by points (once).
  let resultOrdered = false;
  function orderByResult() {
    if (resultOrdered || !resultOn()) return;
    resultOrdered = true;
    RESULT.order.forEach(r => { const a = rows.get(r.key); if (a) list.append(a.li); const b = mapRows.get(r.key); if (b) mlRows.append(b.li); });
  }
  function render() {
    const open = section.dataset.open !== 'false';
    orderByResult();
    how.textContent = resultOn() ? `Oylama bitti. Asıl ve yedek evler sıralı puanla belirlendi: ${RESULT.rule} Önce asıl evlere bakılır, olmazsa yedeklere.` : HOW;
    body.hidden = !open;
    toggle.textContent = open ? 'Kapat' : 'Seçkiyi Aç';
    toggle.setAttribute('aria-expanded', String(open));
    sub.textContent = `${items.length} ev · ${status ? `${status.voted || 0}/${status.total || VOTERS} kişi oy verdi${status.open === false ? ' · oylama bitti' : ''}` : statusError ? 'oylar okunamadı' : 'oylar yükleniyor'}${mine ? ' · oyunu verdin' : ''}`;
    rows.forEach((row, k) => {
      row.li.dataset.vote = kindOf(k);
      paintBadge(row.badge, k);
      const a = availabilityOf(row.it);
      row.avail.dataset.state = a.state;
      row.avail.textContent = availabilityText(row.it);
      row.allIn.textContent = allInText(row.it);
      row.allIn.hidden = !row.allIn.textContent;
    });
    items.forEach(it => {
      const k = key(it), kind = kindOf(k);
      it.card.dataset.seckiVote = kind;
      it.card.dataset.seckiRank = kind ? String(rankOf(k)) : '';
    });
    voteBoxes.forEach(entry => { if (!entry.keep && !entry.box.isConnected) { voteBoxes.delete(entry); return; } paintVote(entry); });
    paintBars();
    renderResults();
    renderMapList();
    renderFoot();
    section.dispatchEvent(new CustomEvent('secki-change', {bubbles: true}));
  }

  function renderFoot() {
    foot.replaceChildren();
    foot.append(el('p', '', (preview ? `Önizleme: oylar yalnız bu tarayıcıda tutulur. Deneme şifreleri DENEME-1 … DENEME-${VOTERS}; oylamayı bitirmek için ${DEMO_ADMIN}. ` : '') + 'Artı ve eksiler kartlardaki kayıtlardan derlendi; fiyat ve müsaitlik son kontrole aittir.'));
    const buttons = el('div', 'secki-foot-buttons');
    if (isOpen()) {
      const closeBtn = button('secki-quiet', 'Oylamayı bitir (yönetici)'); closeBtn.addEventListener('click', () => adminForm('close'));
      // Someone's vote went wrong: the admin clears it and that code works again.
      const undoBtn = button('secki-quiet', 'Bir oyu sıfırla (yönetici)'); undoBtn.addEventListener('click', () => adminForm('unvote'));
      buttons.append(closeBtn, undoBtn);
    }
    if (preview) {
      const resetBtn = button('secki-quiet', 'Önizlemeyi sıfırla');
      resetBtn.addEventListener('click', async () => {
        await localApi.reset(); try { localStorage.removeItem(LOCAL); } catch (_) {}
        mine = null; voter = null; picks.main.clear(); picks.backup.clear(); phase = 'choose'; note = '';
        await refresh();
      });
      buttons.append(resetBtn);
    }
    if (buttons.childNodes.length) foot.append(buttons);
  }

  // Admin actions: a small inline form for the admin code (no browser dialogs).
  // "close" ends the vote; "unvote" clears one person's vote so their code works again.
  let closing = null;
  function adminForm(kind) {
    if (closing) closing.remove();
    closing = el('div', 'secki-admin');
    const who = el('input', 'secki-code-input'); Object.assign(who, {type: 'text', placeholder: 'Kimin oyu? (şifresi)', autocomplete: 'off'});
    const input = el('input', 'secki-code-input'); Object.assign(input, {type: 'password', placeholder: 'Yönetici şifresi', autocomplete: 'off'});
    const ok = button('secki-submit', kind === 'close' ? 'Oylamayı bitir' : 'Oyu sıfırla'), no = button('secki-cancel', 'Vazgeç');
    const msg = el('span', 'secki-code-who');
    if (kind === 'unvote') closing.append(who);
    closing.append(input, ok, no, msg);
    foot.after(closing);
    (kind === 'unvote' ? who : input).focus();
    no.addEventListener('click', () => { closing.remove(); closing = null; });
    const go = async () => {
      if (kind === 'unvote' && norm(who.value).length < 3) { msg.textContent = 'Kimin oyu sıfırlanacak, şifresini yaz.'; return; }
      ok.disabled = true; msg.textContent = 'Gönderiliyor…';
      try {
        const r = kind === 'close' ? await api.close(input.value) : await api.unvote(input.value, who.value);
        if (r && r.ok) {
          if (kind === 'unvote') { msg.textContent = r.removed ? 'Oy silindi; bu şifreyle yeniden oy verilebilir.' : 'Bu şifreyle verilmiş oy yok.'; ok.disabled = false; await refresh(); return; }
          closing.remove(); closing = null; await refresh(); return;
        }
        msg.textContent = r && r.error === 'who' ? 'Bu şifre bir seçmene ait değil.' : 'Yönetici şifresi tanınmadı.';
      } catch (_) { msg.textContent = 'Gönderilemedi.'; }
      ok.disabled = false;
    };
    ok.addEventListener('click', go);
    [who, input].forEach(field => field.addEventListener('keydown', event => { if (event.key === 'Enter') go(); }));
  }

  function renderResults() {
    if (resultOn()) { renderPointResults(); return; }
    results.hidden = !status;
    if (results.hidden) return;
    const closed = closedNow() && Array.isArray(status.ranking);
    results.replaceChildren();
    results.append(el('h3', '', closed ? 'Sonuç' : 'Şu ana kadarki oylar'));
    results.append(el('p', 'secki-results-sub', closed
      ? `${status.voted || 0}/${status.total || VOTERS} kişi oy verdi. Sıralama toplam oya göre, eşitlikte asıl oyu fazla olan öne geçer. Yalnız ilk iki evde oy verenlerin adı yazar.`
      : `${status.voted || 0}/${status.total || VOTERS} kişi oy verdi. Her evin toplam oyu; asıl ve yedek ayrımı ve isimler görünmez.`));
    const rows = closed
      ? status.ranking.map(r => ({it: itemByKey.get(r.key), t: Number(r.total) || 0, place: r.place, names: Array.isArray(r.names) ? r.names : null})).filter(r => r.it)
      : items.map(it => ({it, t: countOf(key(it)).total})).sort((x, y) => y.t - x.t);
    const max = Math.max(1, ...rows.map(r => r.t));
    const named = rows.filter(r => r.names).length;
    const ol = el('ol', 'secki-rank');
    rows.forEach((r, i) => {
      const li = el('li');
      if (closed && r.names) li.dataset.tier = 'main';
      else if (closed && r.t > 0 && i < named + 2) li.dataset.tier = 'backup';
      const meter = el('span', 'rank-meter'); meter.setAttribute('aria-hidden', 'true');
      const mt = el('i', 'm-t'); mt.style.width = `${(r.t / max) * 100}%`;
      meter.append(mt);
      const tier = el('span', 'rank-tier', li.dataset.tier === 'main' ? `${r.place}. sırada` : li.dataset.tier === 'backup' ? 'Olmazsa bunlara' : '');
      li.append(el('span', 'rank-name', `${numberOf(r.it)}. ${titleOf(r.it)}`), meter, el('span', 'rank-num', `${r.t} oy`), tier);
      if (r.names && r.names.length) li.append(el('span', 'rank-who', `Oy verenler: ${r.names.join(', ')}`));
      ol.append(li);
    });
    results.append(ol);
  }

  // Ranked points (Yasin, 16 Nov): the four picks first; names only for Asıl 1 and 2,
  // and only as the service gives them (its closed ranking names its top two).
  function renderPointResults() {
    results.hidden = false;
    results.replaceChildren();
    results.append(el('h3', '', 'Sonuç'));
    const voted = status ? `${status.voted || 0}/${status.total || VOTERS} kişi oy verdi. ` : '';
    results.append(el('p', 'secki-results-sub', `${voted}Sıralama puanla: ${RESULT.rule}`));
    const named = new Map((status?.ranking || []).filter(r => Array.isArray(r.names)).map(r => [r.key, r.names]));
    const max = Math.max(1, ...RESULT.order.map(r => Number(r.points) || 0));
    const ol = el('ol', 'secki-rank secki-rank-points');
    RESULT.order.forEach(r => {
      const it = itemByKey.get(r.key);
      if (!it) return;
      const li = el('li');
      if (Number(r.place) > 0) li.value = Number(r.place);
      if (r.slot) li.dataset.tier = r.slot.startsWith('Asıl') ? 'main' : 'backup';
      const meter = el('span', 'rank-meter'); meter.setAttribute('aria-hidden', 'true');
      const mt = el('i', 'm-t'); mt.style.width = `${((Number(r.points) || 0) / max) * 100}%`;
      meter.append(mt);
      const firsts = Number(r.firsts) > 0 ? ` · ${r.firsts} kişinin 1. tercihi` : '';
      li.append(el('span', 'rank-name', `${numberOf(it)}. ${titleOf(it)}`), meter, el('span', 'rank-num', `${Number(r.points) || 0} puan`),
        el('span', 'rank-tier', `${r.slot || ''}${r.slot ? firsts : firsts.replace(/^ · /, '')}`));
      const who = r.slot && r.slot.startsWith('Asıl') ? named.get(r.key) : null;
      if (who && who.length) li.append(el('span', 'rank-who', `Oy verenler: ${who.join(', ')}`));
      ol.append(li);
    });
    results.append(ol);
  }

  // ---- The list beside the map -------------------------------------------
  const mapList = el('aside', 'secki-maplist'); mapList.setAttribute('aria-label', 'Seçki listesi');
  const mlHead = el('div', 'secki-maplist-head');
  const mlTitle = el('h3', '', 'Seçki');
  const mlSub = el('p', 'secki-maplist-sub');
  const mlRotate = el('p', 'secki-rotate');
  mlRotate.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect class="r-phone" x="7" y="3" width="10" height="18" rx="2.2"/><path d="M11 18h2"/><path class="r-arrow" d="M20.5 9.5a8 8 0 0 0-4-5.5m4 5.5V6m0 3.5H17"/></svg>';
  mlRotate.append(document.createTextNode('Ayrıntı için telefonu yan çevir'));
  const mlText = el('div', 'secki-maplist-headtext');
  mlText.append(mlTitle, mlSub, mlRotate);
  // Map + list by default; "Yalnız liste" hides the map, as asked.
  const mlView = button('secki-maplist-view');
  const mlExit = button('secki-maplist-exit', 'Kapat'); mlExit.hidden = true;
  mlExit.addEventListener('click', () => mapList.dispatchEvent(new CustomEvent('secki-vote-exit', {bubbles: true})));
  mlView.addEventListener('click', () => {
    const panel = mapList.closest('.map-panel');
    if (!panel) return;
    panel.classList.toggle('secki-list-only');
    renderMapList();
    mapList.dispatchEvent(new CustomEvent('secki-list-view', {bubbles: true}));
  });
  const mlHeadButtons = el('div', 'secki-maplist-buttons');
  mlHeadButtons.append(mlView, mlExit);
  mlHead.append(mlText, mlHeadButtons);
  const mlRows = el('ol', 'secki-maplist-rows');
  const mapBar = makeBar('map');
  mapList.append(mlHead, mlRows, mapBar.node);
  const mapRows = new Map();
  const tilesQuery = window.matchMedia('(max-width: 639px) and (orientation: portrait), (max-width: 999px) and (orientation: landscape) and (max-height: 540px)');
  const tilesNow = () => tilesQuery.matches && mapList.dataset.view !== 'list';
  items.forEach(it => {
    const k = key(it);
    const li = el('li', 'secki-mrow'); li.dataset.key = k; li.tabIndex = 0;
    const focus = () => section.dispatchEvent(new CustomEvent('secki-focus', {bubbles: true, detail: {card: it.card}}));
    li.setAttribute('aria-label', `${numberOf(it)}. ${titleOf(it)}: haritada göster`);
    const thumb = button('secki-mrow-thumb'); thumb.setAttribute('aria-label', `${titleOf(it)}: ilanı aç`);
    const src = thumbSrc(it.card);
    if (src) { const img = el('img'); img.src = src; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer'; thumb.append(img); }
    const count = el('span', 'secki-mrow-count'); count.hidden = true;
    thumb.append(el('span', 'secki-no', String(numberOf(it))), el('span', 'secki-mrow-open', '↗'), count);
    // On a phone (upright or on its side) the photo shows the home's card on the map.
    thumb.addEventListener('click', event => { event.stopPropagation(); if (tilesNow()) focus(); else openCard(it.card); });
    const text = el('div', 'secki-mrow-text');
    const title = el('p', 'secki-mrow-title', titleOf(it));
    const total = allInEur(it);
    const price = total !== null ? `${it.check.allInConfirmed ? '' : '≈ '}${fmtEur.format(Math.round(total))} €` : (it.card.querySelector('.amount > strong')?.textContent.trim() || '');
    const per6 = total !== null ? `${fmtEur.format(Math.round(total / 6))} €` : (it.card.querySelector('tr[data-share-people="6"] .share-main')?.textContent.trim() || '');
    const meta = el('p', 'secki-mrow-meta', [price, per6 && `kişi başı ${per6}`].filter(Boolean).join(' · '));
    meta.title = allInText(it);
    const line = el('p', 'secki-mrow-line');
    const avail = el('span', 'secki-mrow-avail');
    line.append(avail);
    const b = badge();
    text.append(title, meta, line);
    const pp = el('p', 'secki-mrow-pp', per6 ? `${total !== null && !it.check.allInConfirmed ? '≈ ' : ''}${per6}` : '');
    if (per6) pp.append(el('span', '', ' / kişi'));
    if (total !== null) { const sure = el('span', 'secki-mrow-tax', it.check.allInConfirmed ? 'Her şey dahil' : it.check.cityTaxIncluded === false ? 'Vergiyi ekledik' : 'Vergi ayrıca olabilir'); sure.dataset.sure = String(Boolean(it.check.allInConfirmed)); line.append(sure); }
    const top = el('div', 'secki-mrow-top');
    top.append(thumb, text, b);
    const box = voteBox(it, true, true);
    const foot = el('div', 'secki-mrow-foot');
    const tallyNode = box.querySelector('.secki-tally');
    if (tallyNode) foot.append(tallyNode);
    const streets = streetLinks(it, 'secki-mrow-street', exactPoint(it.card) ? 'Sokağı gör' : 'Sokak (yaklaşık)', 'Maps ↗');
    if (streets.length) { const s = el('span', 'secki-mrow-streets'); s.append(...streets); foot.append(s); }
    li.append(top, pp, box, foot);
    li.addEventListener('click', event => { if (!event.target.closest('button')) focus(); });
    li.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target === li) { event.preventDefault(); focus(); } });
    mlRows.append(li);
    mapRows.set(k, {li, badge: b, avail, count, it});
  });
  function renderMapList() {
    mapList.dataset.phase = isOpen() ? phase : 'closed';
    const listOnly = Boolean(mapList.closest('.map-panel')?.classList.contains('secki-list-only'));
    mapList.dataset.view = listOnly ? 'list' : 'map';
    mlView.textContent = listOnly ? 'Haritayı göster' : 'Yalnız liste';
    mlTitle.textContent = inVote ? 'Oy paneli' : 'Seçki';
    mlExit.hidden = !inVote;
    mlSub.textContent = inVote && voter ? 'Şifren kabul edildi'
      : resultOn() ? `Sonuç: 2 asıl, 2 yedek ev · sıralı puanla${listOnly ? '' : ' · haritada görmek için eve dokun'}`
      : `${items.length} ev · ${status ? `${status.voted || 0}/${status.total || VOTERS} kişi oy verdi` : 'oylar yükleniyor'}${listOnly ? '' : ' · haritada görmek için eve dokun'}`;
    mapRows.forEach((row, k) => {
      row.li.dataset.vote = kindOf(k);
      paintBadge(row.badge, k);
      const a = availabilityOf(row.it);
      row.avail.dataset.state = a.state;
      row.avail.textContent = a.state === 'available' ? (row.it.check?.available4Nights === false ? 'Yalnız 2 gece müsait' : 'Müsait') : a.state === 'unavailable' ? 'Müsait değil' : 'Müsaitlik doğrulanmadı';
      row.avail.title = availabilityText(row.it);
      row.count.hidden = !status && !resultOn();
      row.count.textContent = status || resultOn() ? chipText(k) : '';
      row.count.dataset.kind = resultOn() ? kindOf(k) : '';
    });
  }
  function markMapRow(card) {
    mapRows.forEach(row => {
      const on = row.it.card === card;
      row.li.classList.toggle('is-active', on);
      if (on && mapList.isConnected && mapList.offsetParent) {
        // Scroll only the list, never the page or the map dialog.
        const box = mlRows.getBoundingClientRect(), r = row.li.getBoundingClientRect();
        if (mlRows.scrollWidth > mlRows.clientWidth + 2) mlRows.scrollBy({left: r.left - box.left - 8, behavior: 'smooth'});
        else if (r.top < box.top || r.bottom > box.bottom) mlRows.scrollBy({top: r.top - box.top - 8, behavior: 'smooth'});
      }
    });
  }
  document.addEventListener('map-card-selected', event => markMapRow(event.detail?.card || null));
  document.addEventListener('secki-focus', event => markMapRow(event.detail?.card || null));

  // ---- Public surface for the map ----------------------------------------
  window.BerlinSecki = {
    mapList,
    voteBox(card) { const it = itemByCard.get(card); return it ? voteBox(it, true) : null; },
    // The map card shows the same notes as the list: total, pros and cons, street view.
    details(card) {
      const it = itemByCard.get(card);
      if (!it) return null;
      const box = el('div', 'secki-details');
      const line = el('p', 'secki-check');
      const a = availabilityOf(it), avail = el('span', 'secki-avail', availabilityText(it)); avail.dataset.state = a.state;
      line.append(avail);
      const total = allInText(it);
      if (total) line.append(el('span', 'secki-allin', total));
      box.append(line);
      const pc = el('div', 'secki-pc');
      const pros = el('ul', 'secki-pros'); pros.setAttribute('aria-label', 'Artılar');
      (it.pros || []).forEach(t => pros.append(el('li', '', t)));
      const cons = el('ul', 'secki-cons'); cons.setAttribute('aria-label', 'Eksiler');
      (it.cons || []).forEach(t => cons.append(el('li', '', t)));
      pc.append(pros, cons);
      box.append(pc);
      const streets = streetLinks(it, 'secki-street', exactPoint(card) ? 'Sokağı gör' : 'Sokağı gör (konum yaklaşık)', 'Google Maps\'te aç ↗');
      if (streets.length) { const p = el('p', 'secki-details-street'); p.append(...streets); box.append(p); }
      return box;
    },
    badge(card) { const it = itemByCard.get(card); if (!it) return null; const k = key(it), kind = kindOf(k); return kind ? {kind, rank: rankOf(k), text: badgeText(kind, rankOf(k))} : null; }
  };

  toggle.addEventListener('click', () => {
    section.dataset.open = String(section.dataset.open === 'false');
    try { localStorage.setItem(OPEN, section.dataset.open); } catch (_) {}
    render();
  });
  try { if (localStorage.getItem(OPEN) === 'false' && location.hash !== '#secki') section.dataset.open = 'false'; } catch (_) {}
  if (location.hash === '#secki') requestAnimationFrame(() => section.scrollIntoView({block: 'start'}));
  window.addEventListener('hashchange', () => { if (location.hash === '#secki') { section.dataset.open = 'true'; render(); section.scrollIntoView({block: 'start'}); } });
  document.addEventListener('availability-updated', render);
  render();
  refresh();
  // Yasin (16 Nov): the seçki and its vote open on the map, list beside it;
  // "Yalnız liste" or the dock's "Liste" switches over. Shared links (#ilan=…) keep their own view.
  // Vote link (#oy, Yasin 16 Nov: "Oy için link de hazırla direkt şifre sorsun"):
  // the seçki map opens with the code asked at once; the code opens the vote panel.
  const openVoteLink = () => { section.dispatchEvent(new CustomEvent('secki-map', {bubbles: true})); setTimeout(openGate, 60); };
  if (location.hash === '#oy') setTimeout(openVoteLink, 0);
  else if (!location.hash || location.hash === '#secki') setTimeout(() => section.dispatchEvent(new CustomEvent('secki-map', {bubbles: true})), 0);
  window.addEventListener('hashchange', () => { if (location.hash === '#oy' && !inVote && !gate.open) openVoteLink(); });
  // Others vote too: read again now and then while the page is visible.
  setInterval(() => { if (document.visibilityState === 'visible' && phase !== 'sending') refresh(); }, 30000);
})();
