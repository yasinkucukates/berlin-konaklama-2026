/* Seçki: a short list chosen by the group, shown above the results and beside
   the map, with a ballot. Everyone gives 2 main and up to 2 backup votes, each
   to a different home, once, with a personal one-time code. Vote counts are
   always visible; who voted for what stays hidden until the vote is closed.
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
  const DEMO_ADMIN = 'DENEME-YONETICI';
  const norm = code => String(code || '').trim().toUpperCase().replace(/\s+/g, '');
  const localApi = {
    load() { try { return JSON.parse(localStorage.getItem(PREVIEW_STORE) || 'null') || {ballots: [], closed: false}; } catch (_) { return {ballots: [], closed: false}; } },
    save(db) { localStorage.setItem(PREVIEW_STORE, JSON.stringify(db)); },
    summary(db) {
      const counts = {};
      db.ballots.forEach(b => {
        b.main.forEach(k => { (counts[k] ||= {main: 0, backup: 0}).main++; });
        b.backup.forEach(k => { (counts[k] ||= {main: 0, backup: 0}).backup++; });
      });
      return {ok: true, open: !db.closed, total: VOTERS, voted: db.ballots.length, counts, ballots: db.closed ? db.ballots.map(({name, main, backup}) => ({name, main, backup})) : null};
    },
    async status() { await wait(150); return this.summary(this.load()); },
    async check(code) {
      await wait(250);
      const hit = demoCodes.find(([c]) => c === norm(code)), db = this.load();
      if (!hit) return {ok: false, error: 'invalid'};
      return {ok: true, name: hit[1], used: db.ballots.some(b => b.code === hit[0])};
    },
    async vote(code, main, backup) {
      await wait(400);
      const db = this.load(), hit = demoCodes.find(([c]) => c === norm(code));
      if (db.closed) return {ok: false, error: 'closed'};
      if (!hit) return {ok: false, error: 'invalid'};
      if (db.ballots.some(b => b.code === hit[0])) return {ok: false, error: 'used'};
      db.ballots.push({code: hit[0], name: hit[1], main, backup, at: new Date().toISOString()});
      this.save(db);
      return {ok: true, name: hit[1]};
    },
    async close(admin) {
      await wait(250);
      if (norm(admin) !== DEMO_ADMIN) return {ok: false, error: 'invalid'};
      const db = this.load(); db.closed = true; this.save(db); return {ok: true};
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
    close(admin) { return this.post({action: 'close', admin: norm(admin)}); }
  };
  const api = preview ? localApi : remoteApi;

  // ---- State --------------------------------------------------------------
  // This device remembers the ballot it sent (name + picks) so the voter sees
  // it again; the service is what actually keeps a code from voting twice.
  const LOCAL = 'berlin-secki-ballot-v2', OPEN = 'berlin-secki-open-v1';
  const picks = {main: new Set(), backup: new Set()};
  let phase = 'choose'; // choose | confirm | sending | done
  let status = null, statusError = '', note = '', code = '', codeName = '', codeState = ''; // codeState: '' | checking | ok | used | invalid
  let mine = null; // {name, main, backup, at}
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL) || 'null');
    if (saved && Array.isArray(saved.main) && Array.isArray(saved.backup) && saved.name) {
      mine = saved;
      saved.main.forEach(k => itemByKey.has(k) && picks.main.add(k));
      saved.backup.forEach(k => itemByKey.has(k) && picks.backup.add(k));
      phase = 'done';
    }
  } catch (_) {}
  const kindOf = k => picks.main.has(k) ? 'main' : picks.backup.has(k) ? 'backup' : '';
  const rankOf = k => { const kind = kindOf(k); return kind ? [...picks[kind]].indexOf(k) + 1 : 0; };
  const countOf = k => status?.counts?.[k] || {main: 0, backup: 0};
  const isOpen = () => !status || status.open !== false;

  // ---- Small builders -----------------------------------------------------
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
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
  const tallyText = k => { const c = countOf(k); return `${c.main} asıl · ${c.backup} yedek oy`; };
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
    if (a.state === 'available') return `Müsait${a.when ? ` · ${a.when} kontrolü` : ''}`;
    if (a.state === 'unavailable') return `Müsait değil${a.when ? ` · ${a.when} kontrolü` : ''}`;
    return 'Müsaitlik doğrulanmadı';
  }
  function allInText(it) {
    const c = it.check;
    if (!c || !Number.isFinite(Number(c.allInEur)) || c.allInEur === null) return '';
    const per = Math.round(Number(c.allInEur) / 6);
    const tax = c.cityTaxIncluded === true ? 'şehir vergisi dahil' : c.cityTaxIncluded === false ? `şehir vergisi ayrıca${Number.isFinite(Number(c.cityTaxEur)) && c.cityTaxEur !== null ? ` ≈ ${fmtEur.format(Number(c.cityTaxEur))} €` : ''}` : '';
    return `Her şey dahil ≈ ${fmtEur.format(Number(c.allInEur))} € (kişi başı ≈ ${fmtEur.format(per)} €)${tax ? ` · ${tax}` : ''}`;
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
    const kind = kindOf(k), locked = phase !== 'choose' || !isOpen();
    mainBtn.setAttribute('aria-pressed', String(kind === 'main'));
    backupBtn.setAttribute('aria-pressed', String(kind === 'backup'));
    mainBtn.textContent = kind === 'main' ? `★ Asıl ${rankOf(k)}` : 'Asıl';
    backupBtn.textContent = kind === 'backup' ? `☆ Yedek ${rankOf(k)}` : 'Yedek';
    mainBtn.disabled = backupBtn.disabled = locked;
    mainBtn.hidden = (phase === 'done' || !isOpen()) && kind !== 'main';
    backupBtn.hidden = (phase === 'done' || !isOpen()) && kind !== 'backup';
    tally.hidden = !status;
    tally.textContent = status ? tallyText(k) : '';
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
  how.textContent = `Herkes ${MAIN} asıl ve ${BACKUP} yedek oy verir; her oy ayrı bir eve gider. Önce en çok asıl oy alan evlere bakılır, onlar olmazsa yedeklere. Oy, sana verilen tek kullanımlık şifreyle bir kez verilir. Oy sayıları herkese açıktır; kimin neye oy verdiği oylama bitince görünür.`;
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
    [nights, per6 && `kişi başı ${per6}`, card.dataset.tresorCarMin && `Tresor ${card.dataset.tresorCarMin} dk`, card.dataset.rsoCarMin && `RSO ${card.dataset.rsoCarMin} dk`, beds, rooms]
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
    const listing = card.querySelector('a.listing');
    if (listing) { const a = el('a', 'secki-listing', 'İlan ↗'); a.href = listing.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; actions.append(a); }
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
    const form = el('div', 'secki-code');
    const label = el('label', 'secki-code-label');
    const labelText = el('span', '', 'Oy şifren');
    const input = el('input', 'secki-code-input');
    Object.assign(input, {type: 'text', autocomplete: 'off', spellcheck: false, placeholder: 'Sana verilen şifre'});
    input.setAttribute('autocapitalize', 'characters');
    label.append(labelText, input);
    const who = el('span', 'secki-code-who');
    form.append(label, who);
    const buttons = el('div', 'secki-bar-buttons');
    const cancel = button('secki-cancel', 'Vazgeç');
    const submit = button('secki-submit');
    buttons.append(cancel, submit);
    node.append(text, form, buttons);
    const bar = {node, text, form, input, who, cancel, submit, where};
    input.addEventListener('input', () => {
      code = input.value; codeState = ''; codeName = '';
      bars.forEach(other => { if (other !== bar) other.input.value = code; });
      scheduleCheck(); paintBars();
    });
    input.addEventListener('keydown', event => { if (event.key === 'Enter') submit.click(); });
    cancel.addEventListener('click', () => { if (phase === 'confirm') { phase = 'choose'; note = ''; render(); } });
    submit.addEventListener('click', onSubmit);
    bars.push(bar);
    return bar;
  }
  const panelBar = makeBar('panel');
  body.append(panelBar.node, foot);

  let checkTimer = null;
  function scheduleCheck() {
    clearTimeout(checkTimer);
    if (norm(code).length < 6) return;
    checkTimer = setTimeout(async () => {
      const asked = norm(code);
      codeState = 'checking'; paintBars();
      try {
        const r = await api.check(asked);
        if (norm(code) !== asked) return;
        if (r && r.ok) { codeName = r.name || ''; codeState = r.used ? 'used' : 'ok'; }
        else codeState = 'invalid';
      } catch (_) { codeState = ''; }
      paintBars();
    }, 450);
  }

  function onSubmit() {
    if (!isOpen()) return;
    if (phase === 'choose' && picks.main.size === MAIN) {
      phase = 'confirm'; note = ''; render();
      requestAnimationFrame(() => bars.find(b => b.node.offsetParent)?.input.focus({preventScroll: true}));
      return;
    }
    if (phase === 'confirm' && codeState === 'ok') { send(); return; }
    if (phase === 'done') { // let someone else vote on this device
      mine = null; picks.main.clear(); picks.backup.clear(); phase = 'choose'; code = ''; codeName = ''; codeState = ''; note = '';
      bars.forEach(b => { b.input.value = ''; });
      try { localStorage.removeItem(LOCAL); } catch (_) {}
      render();
    }
  }

  async function send() {
    phase = 'sending'; note = ''; render();
    const main = [...picks.main], backup = [...picks.backup];
    let r = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { r = await api.vote(norm(code), main, backup); break; } catch (_) { await wait(1200 * (attempt + 1)); }
    }
    if (r && r.ok) {
      mine = {name: r.name || codeName, main, backup, at: new Date().toISOString()};
      try { localStorage.setItem(LOCAL, JSON.stringify(mine)); } catch (_) {}
      phase = 'done'; code = ''; codeState = ''; bars.forEach(b => { b.input.value = ''; });
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
      const {text, form, input, who, cancel, submit} = bar;
      cancel.hidden = phase !== 'confirm';
      form.hidden = phase !== 'confirm';
      input.disabled = phase !== 'confirm';
      who.dataset.state = codeState;
      who.textContent = codeState === 'checking' ? 'Kontrol ediliyor…'
        : codeState === 'ok' ? `Merhaba ${codeName}`
        : codeState === 'used' ? `${codeName}: bu şifreyle oy verilmiş`
        : codeState === 'invalid' ? 'Şifre tanınmadı'
        : '';
      submit.hidden = false; submit.disabled = false; submit.classList.remove('is-quiet');
      if (!isOpen()) {
        text.textContent = 'Oylama bitti. Sonuç ve kimin neye oy verdiği seçki panelinde.';
        submit.hidden = true; cancel.hidden = true; form.hidden = true;
      } else if (phase === 'choose') {
        text.textContent = note || `Asıl ${picks.main.size}/${MAIN} · Yedek ${picks.backup.size}/${BACKUP}${picks.main.size < MAIN ? ` · ${MAIN - picks.main.size} asıl daha seç` : ''}`;
        submit.textContent = 'Oyumu Ver'; submit.disabled = picks.main.size !== MAIN;
      } else if (phase === 'confirm') {
        text.textContent = note || `Asıl: ${nameList([...picks.main]).join(', ')}${picks.backup.size ? ` · Yedek: ${nameList([...picks.backup]).join(', ')}` : ' · Yedek yok'}. Şifreni gir; oy bir kez verilir, sonra değiştirilemez.`;
        submit.textContent = 'Onayla ve Gönder'; submit.disabled = codeState !== 'ok';
      } else if (phase === 'sending') {
        text.textContent = 'Oyun gönderiliyor…'; submit.disabled = true; submit.textContent = 'Gönderiliyor';
      } else {
        text.textContent = note || `${mine?.name ? `${mine.name}, oyun` : 'Oyun'} kaydedildi. Teşekkürler.`;
        submit.textContent = 'Başka biri bu cihazdan oy verecek';
        submit.classList.add('is-quiet');
      }
      bar.node.dataset.phase = isOpen() ? phase : 'closed';
    });
  }

  function render() {
    const open = section.dataset.open !== 'false';
    body.hidden = !open;
    toggle.textContent = open ? 'Kapat' : 'Seçkiyi Aç';
    toggle.setAttribute('aria-expanded', String(open));
    sub.textContent = `${items.length} ev · ${status ? `${status.voted || 0}/${status.total || VOTERS} kişi oy verdi${status.open === false ? ' · oylama bitti' : ''}` : statusError ? 'oylar okunamadı' : 'oylar yükleniyor'}${mine?.name ? ' · oyunu verdin' : ''}`;
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
    if (isOpen()) { const closeBtn = button('secki-quiet', 'Oylamayı bitir (yönetici)'); closeBtn.addEventListener('click', closeVote); buttons.append(closeBtn); }
    if (preview) {
      const resetBtn = button('secki-quiet', 'Önizlemeyi sıfırla');
      resetBtn.addEventListener('click', async () => {
        await localApi.reset(); try { localStorage.removeItem(LOCAL); } catch (_) {}
        mine = null; picks.main.clear(); picks.backup.clear(); phase = 'choose'; code = ''; codeState = ''; note = '';
        await refresh();
      });
      buttons.append(resetBtn);
    }
    if (buttons.childNodes.length) foot.append(buttons);
  }

  // Closing: a small inline form for the admin code (no browser dialogs).
  let closing = null;
  function closeVote() {
    if (closing) { closing.querySelector('input')?.focus(); return; }
    closing = el('div', 'secki-admin');
    const input = el('input', 'secki-code-input'); Object.assign(input, {type: 'password', placeholder: 'Yönetici şifresi', autocomplete: 'off'});
    const ok = button('secki-submit', 'Oylamayı bitir'), no = button('secki-cancel', 'Vazgeç');
    const msg = el('span', 'secki-code-who');
    closing.append(input, ok, no, msg);
    foot.after(closing);
    input.focus();
    no.addEventListener('click', () => { closing.remove(); closing = null; });
    const go = async () => {
      ok.disabled = true; msg.textContent = 'Gönderiliyor…';
      try {
        const r = await api.close(input.value);
        if (r && r.ok) { closing.remove(); closing = null; await refresh(); return; }
        msg.textContent = 'Şifre tanınmadı.';
      } catch (_) { msg.textContent = 'Gönderilemedi.'; }
      ok.disabled = false;
    };
    ok.addEventListener('click', go);
    input.addEventListener('keydown', event => { if (event.key === 'Enter') go(); });
  }

  function renderResults() {
    results.hidden = !status;
    if (results.hidden) return;
    const ranked = items.map(it => ({it, a: countOf(key(it)).main, b: countOf(key(it)).backup}));
    const byMain = ranked.slice().sort((x, y) => y.a - x.a || y.b - x.b);
    const topMain = byMain.filter(r => r.a > 0).slice(0, 2);
    const rest = ranked.filter(r => !topMain.includes(r)).sort((x, y) => y.b - x.b || y.a - x.a);
    const topBackup = rest.filter(r => r.b > 0).slice(0, 2);
    results.replaceChildren();
    results.append(el('h3', '', status.open === false ? 'Sonuç' : 'Şu ana kadarki oylar'));
    results.append(el('p', 'secki-results-sub', `${status.voted || 0}/${status.total || VOTERS} kişi oy verdi. Sıralama asıl oylara, eşitlikte yedek oylara göre.`));
    const max = Math.max(1, ...ranked.map(r => r.a + r.b));
    const ol = el('ol', 'secki-rank');
    byMain.forEach(r => {
      const li = el('li');
      if (topMain.includes(r)) li.dataset.tier = 'main';
      else if (topBackup.includes(r)) li.dataset.tier = 'backup';
      const name = el('span', 'rank-name', `${numberOf(r.it)}. ${titleOf(r.it)}`);
      const meter = el('span', 'rank-meter'); meter.setAttribute('aria-hidden', 'true');
      const ma = el('i', 'm-a'); ma.style.width = `${(r.a / max) * 100}%`;
      const mb = el('i', 'm-b'); mb.style.width = `${(r.b / max) * 100}%`;
      meter.append(ma, mb);
      const num = el('span', 'rank-num', `${r.a} asıl · ${r.b} yedek`);
      const tier = el('span', 'rank-tier', li.dataset.tier === 'main' ? 'Önce bunlara bakılır' : li.dataset.tier === 'backup' ? 'Olmazsa bunlara' : '');
      li.append(name, meter, num, tier);
      ol.append(li);
    });
    results.append(ol);
    // Who voted for what: only once the vote is closed.
    if (status.open === false && Array.isArray(status.ballots)) {
      results.append(el('h3', 'secki-who-title', 'Kim neye oy verdi'));
      const table = el('table', 'secki-who');
      const thead = el('thead'); const hr = el('tr');
      ['Kişi', 'Asıl', 'Yedek'].forEach(t => hr.append(el('th', '', t)));
      thead.append(hr); table.append(thead);
      const tbody = el('tbody');
      status.ballots.forEach(bl => {
        const tr = el('tr');
        tr.append(el('td', '', bl.name || ''), el('td', '', nameList(bl.main || []).join('\n') || '—'), el('td', '', nameList(bl.backup || []).join('\n') || '—'));
        tbody.append(tr);
      });
      table.append(tbody);
      results.append(table);
      const missingVoters = (status.total || VOTERS) - status.ballots.length;
      if (missingVoters > 0) results.append(el('p', 'secki-results-sub', `${missingVoters} kişi oy vermedi.`));
    }
  }

  // ---- The list beside the map -------------------------------------------
  const mapList = el('aside', 'secki-maplist'); mapList.setAttribute('aria-label', 'Seçki listesi');
  const mlHead = el('div', 'secki-maplist-head');
  const mlTitle = el('h3', '', 'Seçki');
  const mlSub = el('p', 'secki-maplist-sub');
  mlHead.append(mlTitle, mlSub);
  const mlRows = el('ol', 'secki-maplist-rows');
  const mapBar = makeBar('map');
  mapList.append(mlHead, mlRows, mapBar.node);
  const mapRows = new Map();
  items.forEach(it => {
    const k = key(it);
    const li = el('li', 'secki-mrow'); li.dataset.key = k; li.tabIndex = 0;
    li.setAttribute('aria-label', `${numberOf(it)}. ${titleOf(it)}: haritada göster`);
    const thumb = button('secki-mrow-thumb'); thumb.setAttribute('aria-label', `${titleOf(it)}: ilanı aç`);
    const src = thumbSrc(it.card);
    if (src) { const img = el('img'); img.src = src; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer'; thumb.append(img); }
    thumb.append(el('span', 'secki-no', String(numberOf(it))), el('span', 'secki-mrow-open', '↗'));
    thumb.addEventListener('click', event => { event.stopPropagation(); openCard(it.card); });
    const text = el('div', 'secki-mrow-text');
    const title = el('p', 'secki-mrow-title', titleOf(it));
    const price = it.card.querySelector('.amount > strong')?.textContent.trim() || '';
    const per6 = it.card.querySelector('tr[data-share-people="6"] .share-main')?.textContent.trim() || '';
    const meta = el('p', 'secki-mrow-meta', [(it.area || '').split('·')[0].split(',')[0].trim(), price, per6 && `kişi ${per6}`].filter(Boolean).join(' · '));
    const avail = el('p', 'secki-mrow-avail');
    const b = badge();
    text.append(title, meta, avail);
    const top = el('div', 'secki-mrow-top');
    top.append(thumb, text, b);
    li.append(top, voteBox(it, true, true));
    const focus = () => section.dispatchEvent(new CustomEvent('secki-focus', {bubbles: true, detail: {card: it.card}}));
    li.addEventListener('click', event => { if (!event.target.closest('button')) focus(); });
    li.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target === li) { event.preventDefault(); focus(); } });
    mlRows.append(li);
    mapRows.set(k, {li, badge: b, avail, it});
  });
  function renderMapList() {
    mapList.dataset.phase = isOpen() ? phase : 'closed';
    mlSub.textContent = `${items.length} ev · ${status ? `${status.voted || 0}/${status.total || VOTERS} kişi oy verdi` : 'oylar yükleniyor'} · haritada görmek için eve dokun`;
    mapRows.forEach((row, k) => {
      row.li.dataset.vote = kindOf(k);
      paintBadge(row.badge, k);
      const a = availabilityOf(row.it);
      row.avail.dataset.state = a.state;
      row.avail.textContent = availabilityText(row.it);
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
  // Others vote too: read again now and then while the page is visible.
  setInterval(() => { if (document.visibilityState === 'visible' && phase !== 'sending') refresh(); }, 30000);
})();
