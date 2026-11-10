(() => {
  'use strict';
  const panel = document.querySelector('#map-panel');
  const canvas = document.querySelector('#map-canvas');
  const status = document.querySelector('#map-status');
  const group = document.querySelector('#map-group');
  const planLabel = document.querySelector('#map-plan-label');
  const listButton = document.querySelector('#view-list');
  const mapButton = document.querySelector('#view-map');
  const mapClose = document.querySelector('#map-close');
  const fitButton = document.querySelector('#map-fit');
  const fitClubsButton = document.querySelector('#map-fit-clubs');
  const resetBest = document.querySelector('#map-best-reset');
  const dialog = document.querySelector('#card-dialog');
  if (!panel || !canvas || !status || !group || !listButton || !mapButton) return;
  const view = panel.closest('[data-berlin-view]');
  let clubs = [];
  try { clubs = JSON.parse(document.querySelector('#map-clubs').textContent); } catch (_) { clubs = []; }
  const clubChooser = document.createElement('select');
  clubChooser.setAttribute('aria-label', 'Kulübe git');
  clubChooser.disabled = true;
  const placeholder = document.createElement('option');
  placeholder.value = ''; placeholder.textContent = 'Kulübe Git'; clubChooser.append(placeholder);
  clubs.forEach((club, index) => {
    const option = document.createElement('option'); option.value = String(index); option.textContent = club.name; clubChooser.append(option);
  });
  const mapControls = group.closest('.map-controls');
  if (mapControls) mapControls.append(clubChooser);
  let map, markerLayer, mapFailure = '', mapLoadTimer, opener = null, mapOpener = null, mapIsModal = false;
  let markers = new Map();
  let clubMarkers = new Map(), clubNames = new Map(), namePane;
  let stayPins = [], lastSignature = '', favoritesOnly = false, layoutQueued = false;
  let selectedKeys = null, selectionTimer = null, previewOffer = null, listShown = null;
  const scrollBehavior = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const clubCenter = [52.52, 13.405];
  const markStatus = (message) => { status.textContent = message; };
  const offerKey = card => JSON.stringify([card.dataset.id, card.dataset.checkIn, card.dataset.checkOut]);
  const whole = new Intl.NumberFormat('tr-TR', {maximumFractionDigits:0});
  // One icon family for the whole site: the page's Lucide sprite.
  function svgIcon(name) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'i'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    // Copy the sprite's paths instead of <use> so CSS can fill a heart.
    const symbol = document.getElementById(`i-${name}`);
    if (symbol) {
      ['viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'].forEach(attr => { if (symbol.hasAttribute(attr)) svg.setAttribute(attr, symbol.getAttribute(attr)); });
      Array.from(symbol.childNodes).forEach(node => svg.append(node.cloneNode(true)));
    }
    return svg;
  }
  // Map frame: the canvas plus a small listing card that opens over the map.
  const frame = document.createElement('div'); frame.className = 'map-frame';
  canvas.before(frame); frame.append(canvas);
  const preview = document.createElement('section');
  preview.className = 'map-preview'; preview.hidden = true; preview.setAttribute('aria-live', 'polite');
  frame.append(preview);
  const favoriteToggle = document.createElement('button');
  favoriteToggle.type = 'button'; favoriteToggle.className = 'map-favorites'; favoriteToggle.setAttribute('aria-pressed', 'false');
  favoriteToggle.append(svgIcon('heart'), document.createTextNode(' Yalnız Favoriler '));
  const favoriteCount = document.createElement('span'); favoriteCount.className = 'map-favorites-count'; favoriteToggle.append(favoriteCount);
  if (mapControls) mapControls.prepend(favoriteToggle);
  // Full screen: the browser's own full screen where it exists (desktop),
  // otherwise the panel simply covers the page. Lives in the map's corner.
  const fullButton = document.createElement('button');
  fullButton.type = 'button'; fullButton.className = 'map-full-toggle'; fullButton.setAttribute('aria-pressed', 'false');
  const fullText = document.createElement('span');
  const setFullLabel = on => {
    fullButton.replaceChildren(svgIcon(on ? 'minimize-2' : 'maximize-2'), fullText);
    fullText.textContent = on ? 'Küçült' : 'Tam ekran';
    fullButton.setAttribute('aria-pressed', String(on));
    fullButton.setAttribute('aria-label', on ? 'Tam ekrandan çık' : 'Haritayı tam ekran aç');
  };
  setFullLabel(false);
  let nativeFull = false;
  function setFull(on) {
    if (panel.classList.contains('is-full') === on) return;
    panel.classList.toggle('is-full', on);
    document.documentElement.classList.toggle('map-full-open', on);
    setFullLabel(on);
    if (on && !mapIsModal && panel.requestFullscreen) {
      panel.requestFullscreen().then(() => { nativeFull = true; }).catch(() => { nativeFull = false; });
    } else if (!on && nativeFull) {
      nativeFull = false;
      if (document.fullscreenElement === panel) document.exitFullscreen().catch(() => {});
    }
    // The larger frame shows more: fit every stay again unless a card is open.
    if (map) setTimeout(() => { map.invalidateSize(); if (preview.hidden) fitPoints(); scheduleLayout(); }, 120);
  }
  fullButton.addEventListener('click', () => setFull(!panel.classList.contains('is-full')));
  panel.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && nativeFull) { nativeFull = false; setFull(false); }
    if (map) requestAnimationFrame(() => { map.invalidateSize(); scheduleLayout(); });
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && panel.classList.contains('is-full') && !nativeFull && !mapIsModal && !(dialog && dialog.open)) setFull(false);
  });
  function clearSelection() {
    clearTimeout(selectionTimer); selectionTimer = null;
    canvas.querySelectorAll('.map-pin.selected').forEach(el => el.classList.remove('selected', 'pin-pulse'));
    selectedKeys = null; previewOffer = null;
    preview.hidden = true; preview.replaceChildren();
    scheduleLayout();
  }
  function showMapFailure(message) {
    if (mapFailure) return;
    clearTimeout(mapLoadTimer);
    mapFailure = message;
    canvas.hidden = true;
    if (fitButton) fitButton.disabled = true;
    if (fitClubsButton) fitClubsButton.disabled = true;
    clubChooser.disabled = true;
    const link = document.createElement('a');
    link.href = 'https://www.openstreetmap.org/#map=11/52.5200/13.4050';
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = 'Berlin haritasını aç ↗';
    status.replaceChildren(document.createTextNode(`${message} `), link,
      document.createTextNode(' veya listeye dönüp ilanın Google Haritalar bağlantısını kullanın.'));
  }
  const hasNotes = card => card.dataset.bestCandidate==='true'||card.dataset.bestAlternative==='true'||card.dataset.conditional==='true'||card.closest('.conditional');
  const bestMatch = card => card.dataset.bestEligible === 'true' || card.dataset.bestCandidate === 'true';
  const hasBestHouse = () => Array.from(document.querySelectorAll('.groups .stay-card')).some(card => card.dataset.planGroup === 'full-villa' && bestMatch(card));
  const isFavorite = card => Number(card.dataset.votes || 0) > 0;
  const usableCard = card => card.dataset.generalMatch !== 'false' && (!favoritesOnly || isFavorite(card));
  const inPlan = card => {
    const plan = group.value.replace(/^p[67]-/, '');
    if (plan === 'hepsi') return true;
    if (plan === 'best-apartment') return card.dataset.planGroup === 'full-daire' && (bestMatch(card) || card.dataset.bestAlternative === 'true');
    if (plan === 'best-house') return card.dataset.planGroup === 'full-villa' && (bestMatch(card) || (!hasBestHouse() && card.dataset.bestAlternative === 'true'));
    return card.dataset.planGroup === plan;
  };
  const selectedCards = () => Array.from(document.querySelectorAll('.groups .stay-card')).filter(card => inPlan(card) && usableCard(card));
  const titleFor = card => card.querySelector('.card-title h3, .card-title h4').textContent;
  const updatePlanLabel = () => { if (planLabel) planLabel.textContent = `Plan: ${group.selectedOptions[0]?.textContent || ''}`; };
  const setMapGroup = id => {
    if (!Array.from(group.options).some(option => option.value === id)) return;
    group.value = id;
    updatePlanLabel();
  };
  const currentPageGroup = () => view?.dataset.activeBest || document.querySelector('.group-nav a[aria-current="location"]')?.hash.slice(1) || location.hash.slice(1);
  setMapGroup(currentPageGroup());
  const updateStatus = () => {
    const selected = selectedCards();
    const missing = selected.filter(c => !c.dataset.lat || !c.dataset.lon).length;
    const best = group.value === 'best-apartment' || group.value === 'best-house';
    if (resetBest) resetBest.hidden = !(best && selected.length === 0);
    if (!mapFailure) {
      const candidates = Array.from(document.querySelectorAll('.groups .stay-card')).filter(inPlan);
      if (best && selected.length === 0) markStatus(candidates.length
        ? 'Seçili filtrelerle eşleşen en uygun seçenek yok.'
        : 'En uygun ölçütlerini karşılayan veya vergili toplamı kontrol edilmesi gereken seçenek bulunamadı.');
      else {
        const alternatives = group.value === 'best-house' && !hasBestHouse() ? ' Tam eşleşme yok; koşullara yakın alternatifler gösteriliyor.' : group.value === 'best-apartment' ? ' Teyit gerektiren adaylar da gösteriliyor.' : '';
        const points = new Set(markers.values()).size;
        const favorites = selected.filter(isFavorite).length;
        const filtersOn = Number(view?.dataset.activeFilters || 0);
        if (favoritesOnly && !selected.length) markStatus(filtersOn ? 'Açık filtrelerle eşleşen ortak favori yok.' : 'Bu planda henüz ortak favori yok. Kartlardaki kalp ile beğenebilirsiniz.');
        else markStatus(`${points} konumda ${selected.length} teklif${favorites ? ` · ${favorites} favori` : ''}${missing ? ` · ${missing} ilanın konumu belirsiz` : ''}${filtersOn ? ` · ${filtersOn} filtre açık` : ''}. Konumlar yaklaşıktır.${alternatives}`);
      }
    }
  };
  function library() {
    if (window.__berlinMapLibraries) return window.__berlinMapLibraries;
    const added = [];
    const resource = (kind, url, integrity) => new Promise((resolve, reject) => {
      const el = document.createElement(kind === 'style' ? 'link' : 'script');
      if (kind === 'style') { el.rel = 'stylesheet'; el.href = url; }
      else el.src = url;
      el.integrity = integrity; el.crossOrigin = 'anonymous';
      el.onload = resolve; el.onerror = () => reject(new Error('Map library unavailable'));
      added.push(el); document.head.append(el);
    });
    let timeoutId, cancelled = false;
    const timeout = new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error('Map library timeout')), 15000); });
    const load = (async () => {
      await Promise.all([
        resource('style', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css', 'sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H'),
        resource('style', 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.13.0/dist/maplibre-gl.css', 'sha384-mnM9NG1099tBMNxdDQNDKIxYcn/fmqQXFJvbT5l1MsrWvzfxBEffceBsw75/cW2R'),
        resource('script', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js', 'sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH'),
        resource('script', 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.13.0/dist/maplibre-gl.js', 'sha384-Nvz6wITR4vEzcMz/FWUFgkrmKDhnaQbjYxIIbwwbAFha9kWiRhmR4QjJ3zhrlnR8')
      ]);
      if (cancelled) throw new Error('Map library timeout');
      await resource('script', 'https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-leaflet@0.1.4/dist/leaflet-maplibre-gl.js', 'sha384-tXYNKOHx4T02jMP7YYCtBxPIv1B5gaA5mcVPBzqMp6d7VzWzxJgI2aWF/nJLrQdS');
      if (!window.L || !window.maplibregl || !window.MaplibreGLLeaflet?.maplibreGL) throw new Error('Map library unavailable');
    })();
    window.__berlinMapLibraries = Promise.race([load, timeout]).then(() => clearTimeout(timeoutId)).catch(error => {
      cancelled = true; clearTimeout(timeoutId);
      added.forEach(el => el.remove());
      delete window.__berlinMapLibraries;
      throw error;
    });
    return window.__berlinMapLibraries;
  }
  // Two marker kinds only: a price label for stays and a rainbow disc for clubs.
  const rainbow = () => { const mark = document.createElement('span'); mark.className = 'rainbow'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = '🌈'; return mark; };
  const anchorClub = name => /^(RSO|Tresor)\b/i.test(name);
  const legend = document.createElement('div');
  legend.className = 'map-legend';
  legend.setAttribute('role', 'group');
  legend.setAttribute('aria-label', 'Harita işaretleri açıklaması');
  const swatch = (className, children) => { const el = document.createElement('span'); el.className = `legend-swatch ${className}`; el.setAttribute('aria-hidden', 'true'); el.append(...children); return el; };
  [
    [swatch('stay', ['1.900 €']), 'Konaklama'],
    [swatch('stay favorite', [svgIcon('heart'), '2']), 'Ortak favori'],
    [swatch('stay unavailable', ['1.900 €']), 'Son kontrolde dolu'],
    [swatch('club', [rainbow()]), 'Kulüp'],
    [swatch('club anchor', [rainbow()]), 'Tresor ve RSO']
  ].forEach(([mark, label]) => {
    const item = document.createElement('span'); item.className = 'map-legend-item';
    item.append(mark, document.createTextNode(label)); legend.append(item);
  });
  frame.before(legend);
  const priceOf = card => {
    const eur = Number(card.dataset.priceEur);
    const head = card.querySelector('.card-head .converted-price[data-fx-currency]');
    if (Number.isFinite(eur) && eur > 0) return `${head && head.dataset.fxCurrency !== 'EUR' ? '≈' : ''}${whole.format(Math.round(eur))} €`;
    return 'Fiyat ?';
  };
  // A label always says how many offers it stands for ("4 ilan"), so several
  // offers at one point or grouped nearby are visible without a tap.
  function fillLabel(pill, cards, label) {
    pill.replaceChildren();
    const votes = cards.reduce((sum, card) => sum + Number(card.dataset.votes || 0), 0);
    if (votes) { pill.append(svgIcon('heart')); const v = document.createElement('b'); v.className = 'pin-votes'; v.textContent = String(votes); pill.append(v); }
    const price = document.createElement('span'); price.className = 'pin-price'; price.textContent = label; pill.append(price);
    if (cards.length > 1) { const count = document.createElement('span'); count.className = 'pin-count'; count.textContent = `${cards.length} ilan`; pill.append(count); }
  }
  function stayIcon(samePoint, label, className) {
    const wrap = document.createElement('span');
    const pill = document.createElement('span'); pill.className = 'pin-label';
    fillLabel(pill, samePoint, label);
    const dot = document.createElement('span'); dot.className = 'pin-shape';
    wrap.append(dot, pill);
    return window.L.divIcon({className:`${className}${samePoint.length > 1 ? ' multi' : ''}`, html:wrap.innerHTML, iconSize:[14,14], iconAnchor:[7,7]});
  }
  function clubIcon(name, className) {
    const wrap = document.createElement('span');
    const disc = document.createElement('span'); disc.className = 'pin-shape'; disc.append(rainbow());
    wrap.append(disc);
    const size = className.includes('anchor') ? 30 : 24;
    return window.L.divIcon({className, html:wrap.innerHTML, iconSize:[size,size], iconAnchor:[size/2,size/2], popupAnchor:[0,-size/2]});
  }
  function showCard(card, marker, tab = 'overview') {
    if (!dialog || typeof dialog.showModal !== 'function') {
      const enclosing = card.closest('details');
      if (enclosing) enclosing.open = true;
      // Without a modal dialog the compact card expands in place.
      card.classList.add('is-expanded');
      if (window.BerlinCardTabs) window.BerlinCardTabs.activate(card, tab);
      card.scrollIntoView({behavior:scrollBehavior(),block:'start'});
      card.setAttribute('tabindex','-1'); card.focus({preventScroll:true});
      return;
    }
    opener = marker && marker.getElement ? marker.getElement() : document.activeElement;
    const clone = card.cloneNode(true);
    clone.removeAttribute('id');
    // A card may be hidden by the list's best-plan filter while the map is
    // showing Hepsi. Its independent detail dialog must still be visible.
    clone.hidden = false;
    clone.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    clone.querySelectorAll('.map-show').forEach(el => el.remove());
    // Summary tiles stay in the large view and switch its tabs instead.
    clone.querySelectorAll('.card-open-main').forEach(el => el.remove());
    clone.querySelectorAll('.photo-grid img').forEach(img => {
      const fail = () => {
        const link = img.closest('a'), listing = clone.querySelector('.listing');
        if (!link || !listing) return;
        link.classList.add('photo-failed'); link.href = listing.href;
        link.setAttribute('aria-label', `Fotoğraf yüklenemedi; ${titleFor(card)} ilanını aç`);
      };
      img.addEventListener('error', fail);
      if (img.complete && img.currentSrc && img.naturalWidth === 0) fail();
    });
    dialog.querySelector('#card-dialog-title').textContent = titleFor(card);
    const content = dialog.querySelector('#card-dialog-content');
    content.replaceChildren(clone);
    if (window.BerlinCardTabs) window.BerlinCardTabs.activate(clone, tab);
    if (!dialog.open) dialog.showModal();
    dialog.scrollTop = 0; content.scrollTop = 0;
    if (window.BerlinCardTabs && tab !== 'overview') window.BerlinCardTabs.reveal(clone);
    // The list script keeps the address bar on this offer's shareable link.
    dialog.dispatchEvent(new CustomEvent('card-shown', {detail:{card}}));
  }
  function sourcePropertyKey(card) {
    try {
      const url = new URL(card.querySelector('a.listing').href);
      if (/(^|\.)airbnb\./i.test(url.hostname)) {
        const match = url.pathname.match(/^\/rooms\/(\d+)/); if (match) return `airbnb:${match[1]}`;
      }
      if (/(^|\.)travanto\.de$/i.test(url.hostname)) {
        const match = url.pathname.match(/\/(\d{5,})\//); if (match) return `travanto:${match[1]}`;
      }
      if (/(^|\.)vrbo\.com$/i.test(url.hostname)) {
        const match = url.pathname.match(/\/(p\d+)/); if (match) return `vrbo:${match[1]}`;
      }
    } catch (_) { /* Preserve unknown providers as separate source records. */ }
    return `id:${card.dataset.id}`;
  }
  function groupedOffers(cards) {
    const groups = new Map();
    cards.forEach(card => { const key = sourcePropertyKey(card); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(card); });
    return groups;
  }
  const textOf = (card, selector) => card.querySelector(selector)?.textContent.trim() || '';
  function headPrice(card) {
    const strong = card.querySelector('.amount strong');
    if (!strong) return 'Fiyat teyitsiz';
    const copy = strong.cloneNode(true); copy.querySelectorAll('.price-qualifier').forEach(el => el.remove());
    return copy.textContent.trim();
  }
  function previewSingle(card, samePoint, marker, area = false) {
    previewOffer = card;
    const content = [];
    const close = document.createElement('button'); close.type = 'button'; close.className = 'map-preview-close';
    close.setAttribute('aria-label', 'Kartı kapat'); close.append(svgIcon('x')); close.addEventListener('click', clearSelection);
    content.push(close);
    const img = card.querySelector('.photo-grid img');
    const media = document.createElement('button'); media.type = 'button'; media.className = 'map-preview-media';
    media.setAttribute('aria-label', `${titleFor(card)}: ayrıntıları aç`);
    if (img) { const photo = document.createElement('img'); photo.alt = ''; photo.loading = 'lazy'; photo.src = img.currentSrc || img.src; media.append(photo); }
    media.addEventListener('click', () => showCard(card, marker));
    const body = document.createElement('div'); body.className = 'map-preview-body';
    if (samePoint.length > 1) {
      const back = document.createElement('button'); back.type = 'button'; back.className = 'map-preview-back';
      back.textContent = `← Bu ${area ? 'bölgedeki' : 'konumdaki'} ${samePoint.length} teklif`;
      back.addEventListener('click', () => previewList(samePoint, marker, area));
      body.append(back);
    }
    const kicker = document.createElement('p'); kicker.className = 'map-preview-kicker'; kicker.textContent = textOf(card, '.card-kicker');
    const title = document.createElement('h3'); title.textContent = titleFor(card);
    const price = document.createElement('p'); price.className = 'map-preview-price';
    const main = document.createElement('b'); main.textContent = headPrice(card);
    const other = document.createElement('span'); other.textContent = textOf(card, '.card-head .converted-price');
    price.append(main, other);
    const share = card.querySelector('.share-table tr[data-share-people]:not([hidden])');
    const shareLine = document.createElement('p'); shareLine.className = 'map-preview-share';
    if (share) shareLine.textContent = `Kişi başı (${share.dataset.sharePeople} kişi): ${textOf(share, '.share-main')}${textOf(share, '.share-approx') ? ' · ' + textOf(share, '.share-approx') : ''}`;
    const facts = document.createElement('p'); facts.className = 'map-preview-facts';
    const tresor = Number(card.dataset.tresorCarMin), beds = Number(card.dataset.normalBeds);
    if (Number.isFinite(tresor) && card.dataset.tresorCarMin !== '') facts.append(svgIcon('car-taxi-front'), document.createTextNode(` Tresor’a ${tresor} dk`));
    if (Number.isFinite(beds) && card.dataset.normalBeds !== '') facts.append(svgIcon('bed-double'), document.createTextNode(` ${beds} ayrı yatak`));
    body.append(kicker, title, price);
    if (share) body.append(shareLine);
    if (facts.childNodes.length) body.append(facts);
    if (card.dataset.availability === 'unavailable') {
      const sold = document.createElement('p'); sold.className = 'map-preview-sold'; sold.textContent = 'Son kontrolde bu tarihler müsait değildi.'; body.append(sold);
    }
    const actions = document.createElement('div'); actions.className = 'map-preview-actions';
    const original = card.querySelector('.favorite-button');
    if (original) {
      const fav = document.createElement('button'); fav.type = 'button'; fav.className = 'map-preview-like';
      const votes = Number(card.dataset.votes || 0);
      fav.setAttribute('aria-pressed', original.getAttribute('aria-pressed') || 'false');
      fav.disabled = original.disabled;
      fav.append(svgIcon('heart'), document.createTextNode(original.getAttribute('aria-pressed') === 'true' ? ' Beğendin' : ' Beğen'));
      if (votes) { const count = document.createElement('span'); count.className = 'map-preview-votes'; count.textContent = String(votes); fav.append(count); }
      fav.addEventListener('click', () => original.click());
      actions.append(fav);
    }
    const details = document.createElement('button'); details.type = 'button'; details.className = 'map-preview-details';
    details.append(svgIcon('maximize-2'), document.createTextNode(' Ayrıntılar')); details.addEventListener('click', () => showCard(card, marker));
    actions.append(details);
    const listing = card.querySelector('a.listing');
    if (listing) {
      const link = document.createElement('a'); link.className = 'map-preview-link'; link.href = listing.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.append(svgIcon('square-arrow-out-up-right'), document.createTextNode(' İlan')); actions.append(link);
    }
    preview.classList.toggle('is-unavailable', card.dataset.availability === 'unavailable');
    preview.classList.remove('is-list');
    preview.setAttribute('aria-label', `${titleFor(card)} · seçili ilan`);
    preview.replaceChildren(...content, media, body, actions);
    preview.hidden = false;
  }
  function previewList(samePoint, marker, area = false) {
    previewOffer = null; listShown = {marker, area, count:samePoint.length};
    const close = document.createElement('button'); close.type = 'button'; close.className = 'map-preview-close';
    close.setAttribute('aria-label', 'Kartı kapat'); close.append(svgIcon('x')); close.addEventListener('click', clearSelection);
    const body = document.createElement('div'); body.className = 'map-preview-body';
    const heading = document.createElement('h3'); heading.textContent = `Bu ${area ? 'bölgede' : 'konumda'} ${samePoint.length} teklif`;
    const note = document.createElement('p'); note.className = 'map-preview-kicker';
    note.textContent = area
      ? 'Birbirine yakın teklifler bu ölçekte tek etikette toplandı; yakınlaştırınca ayrılırlar.'
      : 'Aynı yaklaşık noktayı kullanan teklifler; kapı konumları ayrıca doğrulanmadı.';
    let zoomButton = null;
    if (area) {
      const zoom = zoomButton = document.createElement('button'); zoom.type = 'button'; zoom.className = 'map-preview-back map-preview-zoom';
      zoom.textContent = 'Bu bölgeye yakınlaştır →';
      zoom.addEventListener('click', () => {
        const points = samePoint.map(card => [Number(card.dataset.lat), Number(card.dataset.lon)]);
        clearSelection();
        map.fitBounds(window.L.latLngBounds(points), {padding:[70, 70], maxZoom:16});
      });
    }
    const list = document.createElement('div'); list.className = 'map-preview-list';
    samePoint.slice().sort((a, b) => Number(isFavorite(b)) - Number(isFavorite(a)) || a.dataset.checkIn.localeCompare(b.dataset.checkIn) || Number(a.dataset.priceEur) - Number(b.dataset.priceEur)).forEach(card => {
      const row = document.createElement('button'); row.type = 'button'; row.className = 'map-preview-row';
      if (card.dataset.availability === 'unavailable') row.classList.add('is-unavailable');
      const name = document.createElement('span'); name.className = 'row-title'; name.textContent = titleFor(card);
      const date = document.createElement('small'); date.textContent = textOf(card, '.card-kicker');
      const amount = document.createElement('strong'); amount.textContent = headPrice(card);
      if (isFavorite(card)) { const heart = document.createElement('span'); heart.className = 'row-heart'; heart.append(svgIcon('heart'), document.createTextNode(card.dataset.votes)); name.prepend(heart); }
      row.append(name, amount, date);
      row.addEventListener('click', () => previewSingle(card, samePoint, marker, area));
      list.append(row);
    });
    body.append(heading, note, ...(zoomButton ? [zoomButton] : []), list);
    preview.classList.remove('is-unavailable'); preview.classList.add('is-list');
    preview.setAttribute('aria-label', `${samePoint.length} teklif · seçili konum`);
    preview.replaceChildren(close, body);
    preview.hidden = false;
  }
  function selectPoint(samePoint, marker, card = null, area = false) {
    canvas.querySelectorAll('.map-pin.selected').forEach(el => el.classList.remove('selected'));
    marker.getElement()?.classList.add('selected');
    marker.setZIndexOffset(3000);
    selectedKeys = samePoint.map(offerKey);
    if (card || samePoint.length === 1) previewSingle(card || samePoint[0], samePoint, marker, area);
    else previewList(samePoint, marker, area);
    requestAnimationFrame(() => revealPin(marker));
    scheduleLayout();
  }
  // Keep the chosen pin in sight beside (desktop) or above (phone) the card.
  function revealPin(marker) {
    const pin = marker.getElement()?.getBoundingClientRect(), card = preview.getBoundingClientRect();
    if (!map || !pin || preview.hidden) return;
    const area = canvas.getBoundingClientRect(), margin = 48;
    const covered = pin.left < card.right && pin.right > card.left && pin.top < card.bottom && pin.bottom > card.top;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (covered && card.width > area.width * 0.7) map.panBy([0, pin.bottom - card.top + margin], {animate:!reduce});
    else if (covered) map.panBy([pin.right - card.left + margin, 0], {animate:!reduce});
    else if (pin.top < area.top + 10) map.panBy([0, pin.top - area.top - margin], {animate:!reduce});
  }
  const priority = (cards) => cards.some(isFavorite) ? 1 : cards.some(c => c.dataset.availability !== 'unavailable') ? 2 : 4;
  function draw(force = false) {
    if (!map || !markerLayer) return;
    const cards = selectedCards().filter(card => card.dataset.lat && card.dataset.lon &&
      Number.isFinite(Number(card.dataset.lat)) && Number.isFinite(Number(card.dataset.lon)));
    const bestPlan = group.value === 'best-apartment' || group.value === 'best-house';
    // Redraw only when something visible changed; favorites refresh often.
    const signature = [group.value, favoritesOnly, ...cards.map(card => `${offerKey(card)}:${card.dataset.availability}:${card.dataset.votes || 0}:${card.dataset.priceEur}`)].join('|');
    updateFavoriteToggle();
    if (!force && signature === lastSignature) { refreshPreview(); updateStatus(); return; }
    lastSignature = signature;
    const keep = selectedKeys;
    markerLayer.clearLayers(); markers = new Map(); stayPins = [];
    // Equal coordinates may represent several dates, prices or neighboring
    // properties. Keep one marker at the supplied point and let users choose.
    const atPoint = new Map();
    cards.forEach(card => {
      const point = `${Number(card.dataset.lat)},${Number(card.dataset.lon)}`;
      if (!atPoint.has(point)) atPoint.set(point, []);
      atPoint.get(point).push(card);
    });
    let restored = null;
    atPoint.forEach(samePoint => {
      samePoint.sort((a, b) => Number(a.dataset.availability === 'unavailable') - Number(b.dataset.availability === 'unavailable') || Number(a.dataset.priceEur || Infinity) - Number(b.dataset.priceEur || Infinity));
      const card = samePoint[0];
      const lat = Number(card.dataset.lat), lon = Number(card.dataset.lon);
      const name = titleFor(card);
      const label = bestPlan && card.dataset.bestBasis === 'booking' && card.dataset.bestPriceLabel ? card.dataset.bestPriceLabel : priceOf(card);
      const favorite = samePoint.some(isFavorite);
      const unavailable = samePoint.every(c => c.dataset.availability === 'unavailable');
      const votes = samePoint.reduce((sum, c) => sum + Number(c.dataset.votes || 0), 0);
      const accessibleName = samePoint.length > 1
        ? `Bu konumda ${samePoint.length} teklif · en düşük ${label}${favorite ? ` · ${votes} beğeni` : ''} · teklifleri göster`
        : `${name} · ${headPrice(card)}${favorite ? ` · ${votes} beğeni` : ''}${unavailable ? ' · son kontrolde müsait değil' : ''}`;
      const markerClass = `map-pin${favorite ? ' favorite' : ''}${unavailable ? ' unavailable' : ''}`;
      const rank = priority(samePoint) + (unavailable ? 2 : 0);
      const marker = window.L.marker([lat,lon], {icon:stayIcon(samePoint, label, markerClass), title:accessibleName, keyboard:true, zIndexOffset:(5 - rank) * 200, riseOnHover:true});
      const pin = {marker, samePoint, rank, label, accessibleName, price:Number(card.dataset.priceEur) || Infinity, group:null};
      // While nearby pins share this label, a tap lists all of their offers.
      const open = () => pin.group ? selectPoint(pin.group, marker, null, true) : selectPoint(samePoint, marker);
      marker.on('click', open);
      marker.on('add', () => {
        const element = marker.getElement();
        if (!element) return;
        element.setAttribute('role','button'); element.setAttribute('aria-label', accessibleName);
        // Native mouse focus can scroll the mobile map dialog between down and
        // up, making the first tap land on the map instead of this marker.
        element.addEventListener('mousedown', event => {
          if (event.button === 0) { event.preventDefault(); canvas.focus({preventScroll:true}); }
        });
        element.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); open(); }
        });
      });
      marker.addTo(markerLayer); samePoint.forEach(item => markers.set(item, marker));
      stayPins.push(pin);
      if (keep && samePoint.some(c => keep.includes(offerKey(c)))) restored = {samePoint, marker};
    });
    if (restored) {
      const current = previewOffer && restored.samePoint.includes(previewOffer) ? previewOffer : null;
      restored.marker.getElement()?.classList.add('selected'); restored.marker.setZIndexOffset(3000);
      selectedKeys = restored.samePoint.map(offerKey);
      if (current || restored.samePoint.length === 1) previewSingle(current || restored.samePoint[0], restored.samePoint, restored.marker);
      else previewList(restored.samePoint, restored.marker);
    } else if (keep) clearSelection();
    updateStatus();
    scheduleLayout();
  }
  function refreshPreview() {
    if (preview.hidden || !previewOffer) return;
    const marker = markers.get(previewOffer);
    if (!marker) return;
    const samePoint = [...markers].filter(([, m]) => m === marker).map(([card]) => card);
    previewSingle(previewOffer, samePoint, marker);
  }
  function updateFavoriteToggle() {
    const total = Array.from(document.querySelectorAll('.groups .stay-card')).filter(card => inPlan(card) && card.dataset.generalMatch !== 'false' && isFavorite(card)).length;
    favoriteCount.textContent = `(${total})`;
    favoriteToggle.setAttribute('aria-pressed', String(favoritesOnly));
  }
  // Label one stay without grouping (its own offers and price).
  function ownLabel(pin) {
    const el = pin.marker.getElement(), label = el?.querySelector('.pin-label');
    if (!el || !label) return;
    if (pin.group) {
      fillLabel(label, pin.samePoint, pin.label);
      el.classList.toggle('multi', pin.samePoint.length > 1);
      el.classList.toggle('favorite', pin.samePoint.some(isFavorite));
      el.classList.toggle('unavailable', pin.samePoint.every(c => c.dataset.availability === 'unavailable'));
      el.setAttribute('aria-label', pin.accessibleName);
      pin.group = null;
    }
  }
  // One labelling pass for the whole map. Nothing is dropped: every stay in
  // view either gets its own price label or joins the nearest label, which
  // then counts all of its offers ("5 ilan") and lists them on tap. Labels
  // never cover another label, a stay dot or Tresor/RSO. Club names are
  // placed afterwards where room is left; hovering a club shows its name.
  function layoutLabels() {
    if (!map || canvas.hidden) return;
    // Markers glide during a zoom animation; measure where they stop.
    if (canvas.classList.contains('leaflet-zoom-anim')) { setTimeout(scheduleLayout, 120); return; }
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const hit = (a, b, pad = 2) => a.left < b.right + pad && a.right + pad > b.left && a.top < b.bottom + pad && a.bottom + pad > b.top;
    const inside = r => r.left >= bounds.left + 3 && r.right <= bounds.right - 3 && r.top >= bounds.top + 3 && r.bottom <= bounds.bottom - 3;
    const box = (left, top, width, height) => ({left, top, right:left + width, bottom:top + height});
    const placed = Array.from(canvas.querySelectorAll('.leaflet-control')).map(el => el.getBoundingClientRect());
    if (!preview.hidden) placed.push(preview.getBoundingClientRect());
    const anchors = [];
    clubMarkers.forEach(marker => {
      const el = marker.getElement();
      if (el?.classList.contains('anchor')) { const disc = el.querySelector('.pin-shape'); if (disc) anchors.push(disc.getBoundingClientRect()); }
    });
    const marks = [];
    const pins = [];
    stayPins.forEach(pin => {
      ownLabel(pin);
      const el = pin.marker.getElement(), label = el?.querySelector('.pin-label'), dot = el?.querySelector('.pin-shape');
      if (!el || !label || !dot) return;
      el.classList.remove('compact', 'below', 'right', 'left', 'grouped-away');
      const dotRect = dot.getBoundingClientRect();
      if (!hit(dotRect, bounds, 0)) { el.classList.add('compact'); return; }
      const selected = el.classList.contains('selected');
      const order = selected ? 0 : pin.samePoint.some(isFavorite) ? 2 : pin.rank >= 4 ? 5 : 4;
      pins.push({pin, el, label, dot:dotRect, order});
    });
    pins.sort((a, b) => a.order - b.order || a.pin.price - b.pin.price);
    const groups = [];
    const sidesFor = (m, size) => {
      const w = size.width, h = size.height, cy = (m.top + m.bottom) / 2, gap = m.top - size.bottom;
      return [['', box(size.left, size.top, w, h)], ['below', box(size.left, m.bottom + gap, w, h)],
        ['right', box(m.right + gap, cy - h / 2, w, h)], ['left', box(m.left - gap - w, cy - h / 2, w, h)]];
    };
    const free = (rect, self) => inside(rect) && !placed.some(other => hit(rect, other)) && !anchors.some(a => hit(rect, a, 1)) &&
      !groups.some(g => hit(rect, g.rect) || (g !== self && hit(rect, g.dot, 1)));
    const center = r => [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
    const nearest = item => {
      const [x, y] = center(item.dot);
      return groups.reduce((best, g) => {
        const [gx, gy] = center(g.dot), d = Math.hypot(gx - x, gy - y);
        return !best || d < best.d ? {g, d} : best;
      }, null)?.g;
    };
    pins.forEach(item => {
      // A dot under an existing label or next to another dot joins that label.
      const under = item.order === 0 ? null : groups.find(g => hit(item.dot, g.rect, 2) || hit(item.dot, g.dot, 3));
      if (under) { under.members.push(item); return; }
      const choice = sidesFor(item.dot, item.label.getBoundingClientRect()).find(([, rect]) => free(rect, null));
      if (choice) { groups.push({lead:item, members:[item], side:choice[0], rect:choice[1], dot:item.dot}); return; }
      const near = item.order === 0 ? null : nearest(item);
      if (near) near.members.push(item);
      else groups.push({lead:item, members:[item], side:'', rect:item.label.getBoundingClientRect(), dot:item.dot});
    });
    // Write each group's label. The count makes a label wider; if it then
    // fits on no side, the whole group joins its nearest neighbour instead.
    const fits = (rect, g) => inside(rect) && !placed.some(o => hit(rect, o)) && !anchors.some(a => hit(rect, a, 1)) &&
      !groups.some(o => o !== g && (hit(rect, o.rect) || hit(rect, o.dot, 1)));
    const render = g => {
      const {el, label, pin} = g.lead;
      if (g.members.length < 2) return true;
      const cards = g.members.flatMap(m => m.pin.samePoint);
      cards.sort((a, b) => Number(a.dataset.availability === 'unavailable') - Number(b.dataset.availability === 'unavailable') || Number(a.dataset.priceEur || Infinity) - Number(b.dataset.priceEur || Infinity));
      pin.group = cards;
      fillLabel(label, cards, pin.samePoint.includes(cards[0]) ? pin.label : priceOf(cards[0]));
      const favorite = cards.some(isFavorite), unavailable = cards.every(c => c.dataset.availability === 'unavailable');
      el.classList.add('multi'); el.classList.toggle('favorite', favorite); el.classList.toggle('unavailable', unavailable);
      const votes = cards.reduce((sum, c) => sum + Number(c.dataset.votes || 0), 0);
      el.setAttribute('aria-label', `Bu bölgede ${cards.length} teklif · en düşük ${priceOf(cards[0])}${votes ? ` · ${votes} beğeni` : ''} · teklifleri göster`);
      g.members.forEach(m => { m.el.classList.toggle('grouped-away', m !== g.lead); });
      const sides = sidesFor(g.dot, label.getBoundingClientRect());
      const current = sides.find(([side]) => side === g.side);
      const better = fits(current[1], g) ? current : sides.find(([, rect]) => fits(rect, g));
      if (better) { g.side = better[0]; g.rect = better[1]; return true; }
      g.side = current[0]; g.rect = current[1];
      return false;
    };
    for (let pass = 0; pass < 8; pass++) {
      let changed = false;
      for (const g of groups.slice()) {
        if (!groups.includes(g) || render(g) || g.lead.order === 0) continue;
        const others = groups.filter(o => o !== g);
        if (!others.length) continue;
        const [x, y] = center(g.dot);
        const target = others.reduce((best, o) => { const [ox, oy] = center(o.dot), d = Math.hypot(ox - x, oy - y); return !best || d < best.d ? {o, d} : best; }, null).o;
        target.members.push(...g.members);
        groups.splice(groups.indexOf(g), 1);
        ownLabel(g.lead.pin);
        changed = true;
      }
      if (!changed) break;
    }
    groups.forEach(g => { if (g.side) g.lead.el.classList.add(g.side); });
    // An open list follows its label: if the label now counts more or fewer
    // offers (the card itself takes room on the map), list the same offers.
    if (listShown?.area && !preview.hidden && preview.classList.contains('is-list')) {
      const shown = groups.find(g => g.lead.pin.marker === listShown.marker)?.lead.pin;
      const cards = shown ? (shown.group || shown.samePoint) : null;
      if (cards && cards.length !== listShown.count) {
        selectedKeys = cards.map(offerKey);
        if (cards.length > 1) previewList(cards, listShown.marker, Boolean(shown.group)); else previewSingle(cards[0], cards, listShown.marker);
      }
    }
    groups.forEach(g => { placed.push(g.rect); marks.push({el:g.lead.el, rect:g.dot, level:0}); });
    const items = [];
    clubMarkers.forEach((marker, index) => {
      const el = marker.getElement(), label = clubNames.get(index), disc = el?.querySelector('.pin-shape');
      if (!el || !label || !disc) return;
      label.classList.add('name-hidden');
      const discRect = disc.getBoundingClientRect();
      if (!hit(discRect, bounds, 0)) return;
      const anchor = el.classList.contains('anchor');
      marks.push({el, rect:discRect, level:0});
      items.push({el, label, mark:discRect, order:anchor ? 1 : 3});
    });
    const freeName = (rect, item) => inside(rect) && !placed.some(other => hit(rect, other)) &&
      !marks.some(mark => mark.el !== item.el && hit(rect, mark.rect, 1));
    items.sort((a, b) => a.order - b.order).forEach(item => {
      const size = item.label.getBoundingClientRect();
      const m = item.mark, cx = (m.left + m.right) / 2, cy = (m.top + m.bottom) / 2, w = size.width, h = size.height;
      const gap = 5;
      const choice = [box(cx - w / 2, m.top - gap - h, w, h), box(m.right + gap, cy - h / 2, w, h), box(cx - w / 2, m.bottom + gap, w, h), box(m.left - gap - w, cy - h / 2, w, h),
        box(m.right - 4, m.top - h - 2, w, h), box(m.left - w + 4, m.top - h - 2, w, h), box(m.right - 4, m.bottom + 2, w, h), box(m.left - w + 4, m.bottom + 2, w, h)]
        .find(rect => freeName(rect, item));
      if (!choice) return;
      const origin = namePane.getBoundingClientRect();
      Object.assign(item.label.style, {left:`${choice.left - origin.left}px`, top:`${choice.top - origin.top}px`});
      item.label.classList.remove('name-hidden');
      placed.push(choice);
    });
  }
  function scheduleLayout() {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => {
      layoutQueued = false;
      canvas.classList.add('is-measuring');
      try { layoutLabels(); } finally { requestAnimationFrame(() => canvas.classList.remove('is-measuring')); }
    });
  }
  function createMap() {
    map = window.L.map(canvas, {scrollWheelZoom:true, touchZoom:true, dragging:true, minZoom:1, maxZoom:19}).setView(clubCenter, 10);
    const tiles = window.MaplibreGLLeaflet.maplibreGL({
      style:'https://tiles.openfreemap.org/styles/positron',
      attributionControl:{customAttribution:'<a href="https://openfreemap.org/">OpenFreeMap</a> · &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> katkıda bulunanlar'}
    }).addTo(map);
    const gl = tiles.getMaplibreMap();
    let mapLoaded = false;
    mapLoadTimer = setTimeout(() => {
      if (!mapLoaded) showMapFailure('Harita yüklenemedi.');
    }, 18000);
    gl.on('load', () => { mapLoaded = true; clearTimeout(mapLoadTimer); });
    gl.on('error', () => showMapFailure('Harita yüklenemedi.'));
    markerLayer = window.L.layerGroup().addTo(map);
    clubMarkers = new Map(); clubNames = new Map();
    namePane = map.createPane('clubNames');
    clubs.forEach((club, index) => {
      const lat = Number(club.lat), lon = Number(club.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const content = document.createElement('div');
      const heading = document.createElement('strong'); heading.textContent = club.name; content.append(heading);
      if (club.address) { const p = document.createElement('p'); p.textContent = club.address; content.append(p); }
      const state = String(club.status || '').toLowerCase();
      const inactive = state.includes('closed') || state.includes('inactive');
      if (inactive) { const p = document.createElement('p'); p.textContent = state === 'closed_seasonal' ? 'Kış dönemi kapalı' : 'Kapalı / faal değil'; content.append(p); }
      if (club.match === 'probable' || club.match === 'unidentified') { const p = document.createElement('p'); p.textContent = club.match === 'probable' ? 'Görselle eşleşmesi olası' : 'Görselle eşleşmesi doğrulanmadı'; content.append(p); }
      if (club.note || (typeof club.source === 'string' && /^https?:\/\//i.test(club.source))) {
        const more = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Kaynak ve Not'; more.append(summary);
        if (club.note) { const p = document.createElement('p'); p.textContent = club.note; more.append(p); }
        if (typeof club.source === 'string' && /^https?:\/\//i.test(club.source)) {
          const link = document.createElement('a'); link.href = club.source; link.textContent = 'Kulüp Kaynağı ↗'; link.target = '_blank'; link.rel = 'noopener noreferrer'; more.append(link);
        }
        content.append(more);
      }
      const anchor = anchorClub(club.name);
      const marker = window.L.marker([lat,lon], {icon:clubIcon(club.name, `club-pin${anchor ? ' anchor' : ''}${inactive ? ' closed' : ''}`), title:`${club.name} · kulüp${inactive ? ' · kapalı' : ''}`, keyboard:true, zIndexOffset:anchor ? -300 : -400}).bindPopup(content);
      marker.on('add', () => {
        const element = marker.getElement();
        if (!element) return;
        element.setAttribute('role','button'); element.setAttribute('aria-label', `${club.name} · kulüp bilgisi${inactive ? ' · kapalı' : ''}`);
        element.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); marker.openPopup(); }
        });
      });
      marker.addTo(map); clubMarkers.set(String(index), marker);
      const name = document.createElement('span');
      name.className = `club-name name-hidden${anchor ? ' anchor' : ''}${inactive ? ' closed' : ''}`;
      name.textContent = club.name; name.setAttribute('aria-hidden', 'true');
      name.addEventListener('click', event => { event.stopPropagation(); marker.openPopup(); });
      namePane.append(name); clubNames.set(String(index), name);
    });
    const FullControl = window.L.Control.extend({options:{position:'topleft'}, onAdd() {
      const wrap = window.L.DomUtil.create('div', 'leaflet-bar map-full-control');
      wrap.append(fullButton);
      window.L.DomEvent.disableClickPropagation(wrap);
      return wrap;
    }});
    map.addControl(new FullControl());
    map.on('moveend zoomend resize', scheduleLayout);
    scheduleLayout();
    map.on('click', clearSelection);
    draw(true);
    if (fitButton) fitButton.disabled = false;
    if (fitClubsButton) fitClubsButton.disabled = false;
    clubChooser.disabled = false;
  }
  function fitPoints(clubsOnly = false) {
    if (!map) return;
    const coordinates = clubsOnly ? [] : [...new Set(markers.values())].map(marker => marker.getLatLng());
    if (favoritesOnly && coordinates.length) {
      const padding = window.matchMedia('(max-width:639px)').matches ? [70,50] : [60,60];
      map.fitBounds(window.L.latLngBounds(coordinates), {padding, maxZoom:14}); return;
    }
    clubs.forEach(club => {
      const lat = Number(club.lat), lon = Number(club.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) coordinates.push([lat,lon]);
    });
    const padding = window.matchMedia('(max-width:639px)').matches ? [80,60] : [50,50];
    if (coordinates.length) map.fitBounds(window.L.latLngBounds(coordinates), {padding,maxZoom:clubsOnly ? 13 : 12});
  }
  function openMapPanel() {
    const modal = window.matchMedia('(max-width:639px)').matches && typeof panel.showModal === 'function';
    panel.hidden = false;
    if (panel.open && modal !== mapIsModal) panel.close();
    if (!panel.open) { if (modal) panel.showModal(); else panel.setAttribute('open',''); }
    mapIsModal = modal;
  }
  function hideMap() {
    setFull(false);
    clearSelection();
    if (panel.open) panel.close();
    panel.hidden = true; mapIsModal = false;
    listButton.setAttribute('aria-pressed','true'); mapButton.setAttribute('aria-pressed','false');
    if (mapOpener && mapOpener.isConnected) mapOpener.focus({preventScroll:true});
  }
  async function showMap(shouldScroll) {
    openMapPanel(); listButton.setAttribute('aria-pressed','false'); mapButton.setAttribute('aria-pressed','true');
    if (shouldScroll && !mapIsModal) panel.scrollIntoView({behavior:'instant',block:'start'});
    if (mapFailure) {
      if (map) {
        try { map.remove(); } catch (_) { return false; }
        map = undefined; markerLayer = undefined;
      }
      mapFailure = ''; canvas.hidden = false;
    }
    markStatus('Harita yükleniyor.');
    try {
      await library();
      const newMap = !map;
      if (newMap) {
        const probe = document.createElement('canvas');
        const graphics = probe.getContext('webgl2') || probe.getContext('webgl');
        if (!graphics) throw new Error('WebGL unavailable');
        graphics.getExtension('WEBGL_lose_context')?.loseContext();
        createMap();
      }
      draw(true);
      requestAnimationFrame(() => { map.invalidateSize(); scheduleLayout(); });
      return true;
    } catch (_) {
      showMapFailure('Harita bu cihazda yüklenemedi.');
      return false;
    }
  }
  mapButton.addEventListener('click', async () => { mapOpener = mapButton; setMapGroup(currentPageGroup()); if (await showMap(false)) requestAnimationFrame(() => fitPoints()); });
  listButton.addEventListener('click', hideMap);
  if (mapClose) mapClose.addEventListener('click', hideMap);
  panel.addEventListener('cancel', event => { event.preventDefault(); if (panel.classList.contains('is-full')) setFull(false); else hideMap(); });
  window.addEventListener('resize', () => { if (!panel.hidden) { openMapPanel(); if (map) requestAnimationFrame(() => map.invalidateSize()); } });
  group.addEventListener('change', () => { updatePlanLabel(); clearSelection(); draw(true); fitPoints(); });
  if (resetBest) resetBest.addEventListener('click', () => { setMapGroup('hepsi'); draw(true); fitPoints(); });
  favoriteToggle.addEventListener('click', () => {
    favoritesOnly = !favoritesOnly; clearSelection(); draw(true); fitPoints(!favoritesOnly);
  });
  document.addEventListener('berlin-favorites-state', () => { if (map) draw(); else updateFavoriteToggle(); });
  if (fitButton) fitButton.addEventListener('click', () => fitPoints());
  if (fitClubsButton) fitClubsButton.addEventListener('click', () => fitPoints(true));
  clubChooser.addEventListener('change', () => {
    const marker = clubMarkers.get(clubChooser.value);
    if (!map || !marker) return;
    map.setView(marker.getLatLng(), 17, {animate:!window.matchMedia('(prefers-reduced-motion: reduce)').matches});
    marker.openPopup();
  });
  document.addEventListener('cards-filtered', () => draw());
  document.addEventListener('group-current-changed', event => {
    if (group.value === 'hepsi' && !panel.hidden && !String(event.detail?.id || '').startsWith('best-')) return;
    setMapGroup(event.detail?.id); draw(true); if (!panel.hidden) fitPoints();
  });
  document.addEventListener('click', async event => {
    const relatedButton = event.target.closest('.related-offer-open');
    if (relatedButton) {
      const related = Array.from(document.querySelectorAll('.groups .stay-card')).find(card =>
        card.dataset.id === relatedButton.dataset.offerId && card.dataset.checkIn === relatedButton.dataset.checkIn && card.dataset.checkOut === relatedButton.dataset.checkOut);
      if (related) showCard(related, {getElement: () => relatedButton});
      return;
    }
    const detailButton = event.target.closest('.card-open');
    if (detailButton) {
      const card = detailButton.closest('.stay-card');
      if (card && dialog && dialog.contains(card)) {
        if (window.BerlinCardTabs) window.BerlinCardTabs.activate(card, detailButton.dataset.tab, true);
        return;
      }
      if (card) showCard(card, {getElement: () => detailButton}, detailButton.dataset.tab || 'overview');
      return;
    }
    const button = event.target.closest('.map-show');
    if (!button) return;
    let card = button.closest('.stay-card');
    if(card && !card.closest('.group')) { const source=Array.from(document.querySelectorAll('.groups .stay-card')).find(x=>x.dataset.id===card.dataset.id&&x.dataset.checkIn===card.dataset.checkIn&&x.dataset.checkOut===card.dataset.checkOut); if(source){card=source;if(dialog.open)dialog.close();} }
    const parent = card && card.closest('.group');
    if (!parent || !card.dataset.lat || !card.dataset.lon) return;
    mapOpener = button;
    setMapGroup(view?.dataset.activeBest && bestMatch(card) ? view.dataset.activeBest : parent.classList.contains('group-favorites')?'hepsi':parent.id);
    if (favoritesOnly && !isFavorite(card)) { favoritesOnly = false; }
    if (!(await showMap(true))) return;
    draw(true);
    const marker = markers.get(card);
    if (marker) {
      requestAnimationFrame(()=>{
        map.invalidateSize();map.stop();map.setView(marker.getLatLng(),15,{animate:false});
        const samePoint = [...markers].filter(([, m]) => m === marker).map(([item]) => item);
        selectPoint(samePoint, marker, card);
        const element=marker.getElement();element?.classList.add('pin-pulse');element?.focus({preventScroll:true});
        selectionTimer=setTimeout(()=>element?.classList.remove('pin-pulse'),4000);
      });
    }
  });
  if (dialog) {
    dialog.querySelector('#card-dialog-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => { if (opener && opener.isConnected) opener.focus({preventScroll:true}); });
  }
})();
