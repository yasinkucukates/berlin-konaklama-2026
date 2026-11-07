(() => {
  'use strict';
  const panel = document.querySelector('#map-panel');
  const canvas = document.querySelector('#map-canvas');
  const status = document.querySelector('#map-status');
  const group = document.querySelector('#map-group');
  const includeConditional = document.querySelector('#map-conditional');
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
  let clubMarkers = new Map();
  let clubOverlay, clubLayoutQueued = false;
  let selectedMarker = null, selectedLabel = null, selectedText = '', selectionTimer = null;
  const scrollBehavior = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const clubCenter = [52.52, 13.405];
  const markStatus = (message) => { status.textContent = message; };
  function clearSelection() {
    clearTimeout(selectionTimer); selectionTimer = null;
    selectedMarker?.getElement()?.classList.remove('selected', 'pin-pulse');
    selectedMarker = null; selectedText = '';
    selectedLabel?.remove(); selectedLabel = null;
  }
  function placeSelectedLabel(avoidClubNames = false) {
    const markerElement = selectedMarker?.getElement();
    const shape = markerElement?.querySelector('.pin-shape');
    const original = markerElement?.querySelector('.pin-label');
    if (!shape || !original || canvas.hidden || panel.hidden) return;
    if (!selectedLabel || !selectedLabel.isConnected) {
      selectedLabel = document.createElement('span');
      selectedLabel.className = 'selected-stay-label';
      selectedLabel.setAttribute('aria-hidden', 'true');
      canvas.append(selectedLabel);
    }
    selectedLabel.textContent = selectedText || original.textContent;
    const bounds = canvas.getBoundingClientRect(), pin = shape.getBoundingClientRect();
    const label = selectedLabel.getBoundingClientRect();
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const centre = pin.left + pin.width / 2 - bounds.left - label.width / 2;
    const obstacles = avoidClubNames ? Array.from(canvas.querySelectorAll('.club-group-label, .club-pin .pin-label, .club-pin .pin-shape, .map-pin:not(.selected) .pin-shape, .leaflet-control'))
      .filter(el => getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none')
      .map(el => ({rect:el.getBoundingClientRect(), weight:el.matches('.club-group-label, .club-pin .pin-label, .leaflet-control') ? 1000 : 100})) : [];
    const overlaps = (a,b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const options = [];
    for (const gap of [8,18,28,40,60,80,100,120]) for (const shift of [0,-40,40,-80,80]) for (const below of [false,true]) {
      const left = clamp(centre + shift, 8, bounds.width - label.width - 8);
      const rawTop = below ? pin.bottom - bounds.top + gap : pin.top - bounds.top - label.height - gap;
      if (rawTop < 8 || rawTop + label.height > bounds.height - 8) continue;
      const rect = {left:bounds.left+left,right:bounds.left+left+label.width,top:bounds.top+rawTop,bottom:bounds.top+rawTop+label.height};
      const score = obstacles.reduce((total, obstacle) => total + (overlaps(rect, obstacle.rect) ? obstacle.weight : 0), 0)
        + Math.abs(shift) / 1000 + gap / 1000 + (below ? 0.001 : 0);
      options.push({left, top:rawTop, score});
    }
    options.sort((a,b) => a.score - b.score);
    const chosen = options[0] || {left:clamp(centre,8,bounds.width-label.width-8), top:8};
    selectedLabel.style.left = `${chosen.left}px`; selectedLabel.style.top = `${chosen.top}px`;
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
  const usableCard = card => card.dataset.generalMatch !== 'false' && (!hasNotes(card) || includeConditional.checked);
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
        markStatus(`${selected.length} teklif · ${points} harita işareti · ${missing} konum doğrulanmadı. Aynı yaklaşık konumdaki teklifler tek işarette gösterilir.${alternatives}`);
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
  const categoryInfo = {
    apartment: {kind:'apartment', label:'Daire'},
    private_house: {kind:'house', label:'Ev'},
    villa: {kind:'villa', label:'Villa'},
    multiunit: {kind:'multiunit', label:'Birden çok birim'}
  };
  function symbol(kind) {
    if (kind === 'club') {
      const rainbow = document.createElement('span');
      rainbow.className = 'pin-symbol rainbow-symbol';
      rainbow.setAttribute('aria-hidden', 'true');
      rainbow.textContent = '🌈';
      return rainbow;
    }
    const paths = {
      // White silhouettes stay distinct even when the marker is orange for a note.
      apartment:'M3 1h10v14H3z M5 3h2v2H5z M9 3h2v2H9z M5 6h2v2H5z M9 6h2v2H9z M7 10h2v5H7z',
      house:'M8 1.4 1 7.3h2v7.3h4V10h2v4.6h4V7.3h2Z',
      villa:'M8 1 1 5.2v1.6h1v7.5h12V6.8h1V5.2L8 1ZM4 7h2v2H4zm6 0h2v2h-2zM7 10h2v4H7z',
      multiunit:'M1 4h6v10H1z M9 1h6v13H9z M3 6h2v2H3z M3 10h2v2H3z M11 3h2v2h-2z M11 7h2v2h-2z M11 11h2v2h-2z',
      notice:'M6.8 2h2.4l-.5 7.5H7.3L6.8 2ZM8 11a1.4 1.4 0 1 1 0 2.8A1.4 1.4 0 0 1 8 11Z',
      stay:'M8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3Z'
    };
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'pin-symbol');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', paths[kind] || paths.stay);
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('fill-rule', 'evenodd');
    svg.append(path);
    return svg;
  }
  const legend = document.createElement('div');
  legend.className = 'map-legend';
  legend.setAttribute('role', 'group');
  legend.setAttribute('aria-label', 'Harita işaretleri açıklaması');
  const legendItems = [
    ['apartment', 'Daire', 'apartment'], ['house', 'Ev', 'house'],
    ['villa', 'Villa', 'villa'], ['multiunit', 'Birden çok birim', 'multiunit'],
    ['club', 'Kulüp', 'club'], ['note', 'Turuncu çerçeve: notlu ilan', 'notice'],
    ['closed', 'Kapalı kulüp', 'club']
  ];
  if (Array.from(document.querySelectorAll('.groups .stay-card')).some(card => !categoryInfo[card.dataset.category])) {
    legendItems.splice(4, 0, ['stay', 'Türü belirsiz', 'stay']);
  }
  legendItems.forEach(([kind, label, symbolKind]) => {
    const item = document.createElement('span'); item.className = 'map-legend-item';
    const mark = document.createElement('span'); mark.className = `legend-icon ${kind}`;
    mark.setAttribute('aria-hidden', 'true'); mark.append(symbol(symbolKind));
    item.append(mark, document.createTextNode(label)); legend.append(item);
  });
  canvas.before(legend);
  function icon(label, className, horizontalOffset = 0, kind = '', offerCount = 0) {
    const wrap = document.createElement('span');
    const title = document.createElement('span'); title.className = 'pin-label'; title.textContent = label; title.style.pointerEvents = 'none';
    const pin = document.createElement('span'); pin.className = 'pin-shape';
    pin.append(symbol(kind || (className.startsWith('club-pin') ? 'club' : 'stay')));
    wrap.append(title, pin);
    if (offerCount > 1) {
      const count = document.createElement('span'); count.className = 'pin-count';
      count.textContent = String(offerCount); count.setAttribute('aria-hidden', 'true'); wrap.append(count);
    }
    return window.L.divIcon({className, html:wrap.innerHTML, iconSize:[44,44], iconAnchor:[22-horizontalOffset,44], popupAnchor:[-horizontalOffset,-38]});
  }
  function showCard(card, marker, returnOffers = null) {
    if (!dialog || typeof dialog.showModal !== 'function') {
      const enclosing = card.closest('details');
      if (enclosing) enclosing.open = true;
      const nativeDetails = card.querySelector('.detail');
      if (nativeDetails) nativeDetails.open = true;
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
    clone.querySelectorAll('.card-open').forEach(el => el.remove());
    const notes = hasNotes(card) ? clone.querySelector('.note-block') : null;
    if (notes) notes.remove();
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
    if (notes) { notes.classList.add('dialog-notes'); content.replaceChildren(notes, clone); }
    else content.replaceChildren(clone);
    if (returnOffers) {
      const back = document.createElement('button'); back.type = 'button'; back.className = 'map-offers-back';
      back.textContent = '← Aynı Konumdaki Teklifler';
      back.addEventListener('click', () => showOfferPicker(returnOffers, marker)); content.prepend(back);
    }
    if (!dialog.open) dialog.showModal();
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
  function showOfferPicker(cards, marker) {
    const panelContent = document.createElement('div'); panelContent.className = 'map-offer-picker';
    const intro = document.createElement('p');
    intro.textContent = 'Bu teklifler aynı yaklaşık harita noktasını kullanıyor. Gerçek ev kapıları ayrı ayrı doğrulanmadı.';
    panelContent.append(intro);
    groupedOffers(cards).forEach(offers => {
      const section = document.createElement('section'); section.className = 'map-offer-property';
      const heading = document.createElement('strong'); heading.textContent = titleFor(offers.find(c => c.querySelector('.offer-party-6')) || offers[0]);
      section.append(heading);
      offers.slice().sort((a,b) => a.dataset.checkIn.localeCompare(b.dataset.checkIn) ||
        Number(Boolean(b.querySelector('.offer-party-6'))) - Number(Boolean(a.querySelector('.offer-party-6')))).forEach(card => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'map-offer-option';
        const date = document.createElement('span'); date.textContent = card.querySelector('.card-kicker')?.textContent || `${card.dataset.checkIn} → ${card.dataset.checkOut}`;
        const amount = document.createElement('strong'); amount.textContent = card.querySelector('.amount strong')?.textContent || 'Fiyat teyitsiz';
        const party = document.createElement('small'); party.textContent = card.querySelector('.offer-party-6') ? '6 kişilik kaynak teklifi' : 'Farklı kişi sayısı için eski teklif';
        button.append(date, amount, party);
        button.addEventListener('click', () => { if (marker.closePopup) marker.closePopup(); showCard(card, marker, cards); });
        section.append(button);
      });
      panelContent.append(section);
    });
    if (!dialog || typeof dialog.showModal !== 'function') {
      marker.bindPopup(panelContent, {maxHeight:300}).openPopup(); return;
    }
    opener = marker.getElement();
    dialog.querySelector('#card-dialog-title').textContent = `${groupedOffers(cards).size} İlan · ${cards.length} Teklif`;
    dialog.querySelector('#card-dialog-content').replaceChildren(panelContent);
    if (!dialog.open) dialog.showModal();
  }
  function draw() {
    if (!map || !markerLayer) return;
    clearSelection();
    markerLayer.clearLayers(); markers = new Map();
    const cards = selectedCards().filter(card => card.dataset.lat && card.dataset.lon &&
      Number.isFinite(Number(card.dataset.lat)) && Number.isFinite(Number(card.dataset.lon)));
    // Equal coordinates may represent several dates, prices or neighboring
    // properties. Keep one pin at the supplied point and let users choose.
    const atPoint = new Map();
    cards.forEach(card => {
      const point = `${Number(card.dataset.lat)},${Number(card.dataset.lon)}`;
      if (!atPoint.has(point)) atPoint.set(point, []);
      atPoint.get(point).push(card);
    });
    atPoint.forEach(samePoint => {
      const card = samePoint[0];
      const lat = Number(card.dataset.lat), lon = Number(card.dataset.lon);
      const name = titleFor(card);
      const bestPlan = group.value === 'best-apartment' || group.value === 'best-house';
      const price = bestPlan && card.dataset.bestBasis === 'booking' && card.dataset.bestPriceLabel
        ? card.dataset.bestPriceLabel : card.querySelector('.amount strong').textContent;
      const accuracy = card.dataset.mapAccuracy === 'area' ? 'yaklaşık bölge, bina teyitsiz' : 'yaklaşık konum';
      const notePresent = samePoint.some(hasNotes);
      const taxWarning = card.dataset.bestCandidate === 'true' ? ' · Vergili toplamı kontrol edin' : '';
      const category = categoryInfo[card.dataset.category] || {kind:'stay', label:'Türü belirsiz konaklama'};
      const groupTitle = `${groupedOffers(samePoint).size} ilan · ${samePoint.length} teklif · yaklaşık konum`;
      const accessibleName = samePoint.length > 1 ? `${groupTitle} · teklifleri göster` : `${name} · ${category.label} · ${price} · ${accuracy}${notePresent ? ' · notu olan seçenek' : ''}${taxWarning}`;
      const markerClass = `map-pin ${category.kind}${notePresent ? ' conditional' : ''}`;
      // Keep a candidate clickable when a nearby club marker overlaps it at
      // the initial map zoom. Club navigation remains available in the chooser.
      const marker = window.L.marker([lat,lon], {icon:icon(samePoint.length > 1 ? groupTitle : name+' · '+price+taxWarning, markerClass, 0, category.kind, samePoint.length), title:accessibleName, keyboard:true, zIndexOffset:samePoint.some(c => c.dataset.bestCandidate === 'true') ? 1000 : 0});
      const open = () => samePoint.length > 1 ? showOfferPicker(samePoint, marker) : showCard(card, marker);
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
    });
    updateStatus();
  }
  function placeClubNames(){
    if (!map || !clubMarkers.size || canvas.hidden) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    if (!clubOverlay || !clubOverlay.isConnected) {
      clubOverlay = document.createElement('div');
      clubOverlay.className = 'club-groups-overlay';
      canvas.append(clubOverlay);
    }
    const intersects = (a,b,pad=0) => a.left < b.right+pad && a.right+pad > b.left && a.top < b.bottom+pad && a.bottom+pad > b.top;
    const center = rect => ({x:(rect.left+rect.right)/2,y:(rect.top+rect.bottom)/2});
    const union = rects => ({left:Math.min(...rects.map(r=>r.left)),right:Math.max(...rects.map(r=>r.right)),top:Math.min(...rects.map(r=>r.top)),bottom:Math.max(...rects.map(r=>r.bottom))});
    const items = [];
    clubMarkers.forEach((marker,index) => {
      const el = marker.getElement(), label = el?.querySelector('.pin-label'), shape = el?.querySelector('.pin-shape');
      if (!el || !label || !shape) return;
      label.style.visibility = 'visible';
      const pin = shape.getBoundingClientRect();
      if (!intersects(pin,bounds)) return;
      items.push({marker,index,label,el,pin,name:clubs[Number(index)]?.name || label.textContent});
    });
    if (!items.length) { clubOverlay.replaceChildren(); return; }
    const allPins = Array.from(canvas.querySelectorAll('.club-pin .pin-shape'))
      .map(el => el.getBoundingClientRect()).filter(rect => intersects(rect,bounds));
    const stayPins = Array.from(canvas.querySelectorAll('.map-pin .pin-shape, .selected-stay-label'))
      .map(el => el.getBoundingClientRect()).filter(rect => intersects(rect,bounds));
    const mapControlsInCanvas = Array.from(canvas.querySelectorAll('.leaflet-control'))
      .map(el => el.getBoundingClientRect()).filter(rect => intersects(rect,bounds));
    // Pins within this distance are genuinely adjacent on the current map.
    // Their names share one compact label; each name opens its own club.
    let units = [];
    items.forEach(item => {
      const p = center(item.pin), touching = [];
      units.forEach((unit,i) => {
        if (unit.some(other => {const q=center(other.pin);return Math.hypot(p.x-q.x,p.y-q.y)<40;})) touching.push(i);
      });
      if (!touching.length) units.push([item]);
      else {
        const merged = [item];
        touching.reverse().forEach(i => merged.push(...units.splice(i,1)[0]));
        units.push(merged);
      }
    });
    let placements = null, prepared = [];
    for (let pass=0; pass<items.length; pass++) {
      clubOverlay.replaceChildren();
      prepared = units.map(members => {
        const pinBox = union(members.map(x=>x.pin));
        let node;
        if (members.length === 1) node = members[0].label;
        else {
          node = document.createElement('div'); node.className = 'club-group-label';
          node.setAttribute('role','group'); node.setAttribute('aria-label','Yakın kulüpler');
          ['pointerdown','mousedown','touchstart','dblclick'].forEach(type=>node.addEventListener(type,event=>event.stopPropagation()));
          members.slice().sort((a,b)=>a.name.localeCompare(b.name,'tr')).forEach(item => {
            const button = document.createElement('button'); button.type = 'button'; button.textContent = item.name;
            button.setAttribute('aria-label',`${item.name} konumuna yaklaş ve bilgisini aç`);
            if (item.el.classList.contains('closed')) button.classList.add('closed');
            button.addEventListener('click',event => {
              event.stopPropagation();
              map.setView(item.marker.getLatLng(),17,{animate:!window.matchMedia('(prefers-reduced-motion: reduce)').matches});
              item.marker.openPopup();
            });
            node.append(button);
          });
          if (members.length > 6) node.classList.add('two-columns');
          clubOverlay.append(node);
        }
        node.style.visibility = 'hidden';
        const c = center(pinBox), candidates=[];
        for (const horizontal of (members.length===2 ? [false,true] : [false])) {
          if (members.length>1) node.classList.toggle('horizontal',horizontal);
          const size=node.getBoundingClientRect();
          candidates.push(...[4,12,20,28].flatMap(gap=>[
            ...[c.x-size.width/2,c.x-size.width/2-8,c.x-size.width/2+8,c.x-size.width/2-16,c.x-size.width/2+16,pinBox.left,pinBox.right-size.width,pinBox.left-size.width+8,pinBox.right-8].map(left=>({left,top:pinBox.top-size.height-gap})),
            ...[c.y-size.height/2,c.y-size.height/2-8,c.y-size.height/2+8,pinBox.top,pinBox.bottom-size.height,pinBox.top-size.height+8,pinBox.bottom-8].map(top=>({left:pinBox.right+gap,top})),
            ...[c.x-size.width/2,c.x-size.width/2-8,c.x-size.width/2+8,c.x-size.width/2-16,c.x-size.width/2+16,pinBox.left,pinBox.right-size.width,pinBox.left-size.width+8,pinBox.right-8].map(left=>({left,top:pinBox.bottom+gap})),
            ...[c.y-size.height/2,c.y-size.height/2-8,c.y-size.height/2+8,pinBox.top,pinBox.bottom-size.height,pinBox.top-size.height+8,pinBox.bottom-8].map(top=>({left:pinBox.left-size.width-gap,top}))
          ]).map(p=>({...p,right:p.left+size.width,bottom:p.top+size.height,horizontal}))
           .filter(p=>p.left>=bounds.left+3&&p.right<=bounds.right-3&&p.top>=bounds.top+3&&p.bottom<=bounds.bottom-3)
           .filter(p=>!allPins.some(pin=>intersects(p,pin,2)) && !mapControlsInCanvas.some(control=>intersects(p,control,3)))
           .map(p=>({...p,stayPenalty:stayPins.reduce((sum,pin)=>sum+(intersects(p,pin)?1:0),0)})));
        }
        if (members.length>1) node.classList.remove('horizontal');
        candidates.sort((a,b)=>a.stayPenalty-b.stayPenalty);
        return {members,node,pinBox,candidates};
      }).sort((a,b)=>a.candidates.length-b.candidates.length || b.members.length-a.members.length);
      const chosen=[];
      let attempts=0, bestPenalty=Infinity, bestChoices=null;
      function solve(i,penalty){
        if (i===prepared.length) {
          if (penalty<bestPenalty){bestPenalty=penalty;bestChoices=chosen.slice();}
          return bestPenalty===0;
        }
        if (++attempts>30000) return false;
        for (const rect of prepared[i].candidates) {
          const nextPenalty=penalty+rect.stayPenalty;
          if (nextPenalty>=bestPenalty || chosen.some(other=>intersects(rect,other,3))) continue;
          chosen.push(rect); if (solve(i+1,nextPenalty)) return true; chosen.pop();
        }
        return false;
      }
      solve(0,0);
      if (bestChoices) { placements=bestChoices; break; }
      // Merge only nearby pin groups if four immediate sides are insufficient.
      let nearest=Infinity, pair=null;
      for(let i=0;i<units.length;i++) for(let j=i+1;j<units.length;j++){
        const a=center(union(units[i].map(x=>x.pin))),b=center(union(units[j].map(x=>x.pin)));
        const distance=Math.hypot(a.x-b.x,a.y-b.y);
        if(distance<nearest){nearest=distance;pair=[i,j];}
      }
      if(!pair || nearest>100) break;
      units[pair[0]].push(...units[pair[1]]); units.splice(pair[1],1);
    }
    // A very small viewport can still be constrained. Keep each name next to
    // its own pin instead of moving it away or adding connecting lines.
    clubOverlay.dataset.layout = placements ? 'solved' : 'fallback';
    if (!placements) placements=prepared.map(unit=>unit.candidates[0] || {left:unit.pinBox.right+4,top:unit.pinBox.top});
    prepared.forEach((unit,i) => {
      const rect=placements[i];
      if(unit.members.length===1){
        const item=unit.members[0],icon=item.el.getBoundingClientRect();
        unit.node.style.left=`${rect.left-icon.left}px`;unit.node.style.top=`${rect.top-icon.top}px`;
        unit.node.style.bottom='auto';unit.node.style.transform='none';
      }else{
        unit.members.forEach(item=>{item.label.style.visibility='hidden';});
        unit.node.classList.toggle('horizontal',Boolean(rect.horizontal));
        unit.node.style.left=`${rect.left-bounds.left}px`;unit.node.style.top=`${rect.top-bounds.top}px`;
      }
      unit.node.style.visibility='visible';
    });
  }
  function scheduleClubNames(){
    if (clubLayoutQueued) return;
    clubLayoutQueued = true;
    requestAnimationFrame(()=>{clubLayoutQueued=false;placeSelectedLabel();placeClubNames();placeSelectedLabel(true);});
  }
  function createMap() {
    map = window.L.map(canvas, {scrollWheelZoom:true, touchZoom:true, dragging:true, minZoom:1, maxZoom:19}).setView(clubCenter, 10);
    const tiles = window.MaplibreGLLeaflet.maplibreGL({
      style:'https://tiles.openfreemap.org/styles/liberty',
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
    clubMarkers = new Map();
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
      const marker = window.L.marker([lat,lon], {icon:icon(club.name, inactive ? 'club-pin closed' : 'club-pin'), title:`${club.name} · kulüp${inactive ? ' · kapalı' : ''}`, keyboard:true}).bindPopup(content);
      marker.on('add', () => {
        const element = marker.getElement();
        if (!element) return;
        element.setAttribute('role','button'); element.setAttribute('aria-label', `${club.name} · kulüp bilgisi${inactive ? ' · kapalı' : ''}`);
        element.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); marker.openPopup(); }
        });
      });
      marker.addTo(map); clubMarkers.set(String(index), marker);
    });
    map.on('move zoom resize',scheduleClubNames);
    scheduleClubNames();
    draw();
    if (fitButton) fitButton.disabled = false;
    if (fitClubsButton) fitClubsButton.disabled = false;
    clubChooser.disabled = false;
  }
  function fitPoints(clubsOnly = false) {
    if (!map) return;
    const coordinates = clubsOnly ? [] : [...markers.values()].map(marker => marker.getLatLng());
    clubs.forEach(club => {
      const lat = Number(club.lat), lon = Number(club.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) coordinates.push([lat,lon]);
    });
    const padding = window.matchMedia('(max-width:639px)').matches ? [80,60] : [36,36];
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
      draw();
      requestAnimationFrame(() => { map.invalidateSize(); if (newMap && !shouldScroll) fitPoints(true); });
      return true;
    } catch (_) {
      showMapFailure('Harita bu cihazda yüklenemedi.');
      return false;
    }
  }
  mapButton.addEventListener('click', async () => { mapOpener = mapButton; setMapGroup(currentPageGroup()); if (await showMap(false)) requestAnimationFrame(() => fitPoints(true)); });
  listButton.addEventListener('click', hideMap);
  if (mapClose) mapClose.addEventListener('click', hideMap);
  panel.addEventListener('cancel', event => { event.preventDefault(); hideMap(); });
  window.addEventListener('resize', () => { if (!panel.hidden) { openMapPanel(); if (map) requestAnimationFrame(() => map.invalidateSize()); } });
  group.addEventListener('change', () => { updatePlanLabel(); draw(); fitPoints(); });
  if (resetBest) resetBest.addEventListener('click', () => { setMapGroup('hepsi'); draw(); fitPoints(); });
  includeConditional.addEventListener('change', draw);
  if (fitButton) fitButton.addEventListener('click', () => fitPoints());
  if (fitClubsButton) fitClubsButton.addEventListener('click', () => fitPoints(true));
  clubChooser.addEventListener('change', () => {
    const marker = clubMarkers.get(clubChooser.value);
    if (!map || !marker) return;
    map.setView(marker.getLatLng(), 17, {animate:!window.matchMedia('(prefers-reduced-motion: reduce)').matches});
    marker.openPopup();
  });
  document.addEventListener('cards-filtered', draw);
  document.addEventListener('group-current-changed', event => {
    if (group.value === 'hepsi' && !panel.hidden && !String(event.detail?.id || '').startsWith('best-')) return;
    setMapGroup(event.detail?.id); draw(); if (!panel.hidden) fitPoints();
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
      if (card) showCard(card, {getElement: () => detailButton});
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
    if (hasNotes(card)) includeConditional.checked = true;
    if (!(await showMap(true))) return;
    draw();
    const marker = markers.get(card);
    if (marker) {
      requestAnimationFrame(()=>{
        map.invalidateSize();map.stop();map.setView(marker.getLatLng(),15,{animate:false});
        clearSelection(); selectedMarker=marker;
        selectedText = `${titleFor(card)} · ${card.querySelector('.amount strong')?.textContent || 'Fiyat teyitsiz'}`;
        const element=marker.getElement();element?.classList.add('selected','pin-pulse');element?.focus({preventScroll:true});
        placeSelectedLabel(); scheduleClubNames();
        selectionTimer=setTimeout(()=>element?.classList.remove('pin-pulse'),6000);
      });
    }
  });
  if (dialog) {
    dialog.querySelector('#card-dialog-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => { if (opener && opener.isConnected) opener.focus({preventScroll:true}); });
  }
})();
