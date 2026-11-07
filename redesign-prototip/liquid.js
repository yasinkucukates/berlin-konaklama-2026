(() => {
  'use strict';

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
  const favorites = {state:'disconnected', entries:new Set(), busy:false, uncertain:false, pending:new Map(), errors:new Set(), revision:0, metadata:new Map(), mine:new Set()};
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
  const timed = async promise => {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Favorite service timed out')), 12000);
      })]);
    } finally { clearTimeout(timer); }
  };
  const applyVoteRows = items => { favorites.metadata=new Map(items.map(x=>[offerKey(x),x])); favorites.mine=new Set(items.filter(x=>x.mine).map(offerKey)); return new Set(items.map(offerKey)); };
  const readFavoriteEntries = async api => {
    const items = await timed(Promise.resolve().then(() => api.list()));
    if (!Array.isArray(items) || !items.every(validOffer)) throw new Error('Invalid favorites response');
    return items;
  };
  let writeQueue = Promise.resolve();
  async function refreshFavorites() {
    if (favorites.busy || favorites.pending.size) return;
    const api = adapter();
    if (!api) { favorites.state = 'disconnected'; favorites.entries.clear(); notifyFavorites(); return; }
    const revision = favorites.revision;
    favorites.busy = true;
    if (favorites.state !== 'ready') favorites.state = 'loading';
    notifyFavorites();
    try {
      const entries = await readFavoriteEntries(api);
      // A read started before a click must not overwrite that click.
      if (revision === favorites.revision && !favorites.pending.size) {
        favorites.entries = applyVoteRows(entries);
        favorites.state = 'ready'; favorites.uncertain = false; favorites.errors.clear();
      }
    } catch (_) {
      if (revision === favorites.revision) {
        if (favorites.state !== 'ready') favorites.state = 'error';
        favorites.uncertain = true;
      }
    } finally { favorites.busy = false; notifyFavorites(); }
  }
  function toggleFavorite(offer) {
    const api = adapter();
    if (!api || favorites.state !== 'ready' || !validOffer(offer)) return;
    const key = offerKey(offer);
    if (favorites.pending.has(key)) return;
    const before = favorites.mine.has(key);
    const beforeMeta=favorites.metadata.get(key)||{count:0,mine:false,legacy:false};
    favorites.revision++;
    favorites.errors.delete(key);
    favorites.pending.set(key, {before, beforeMeta, selected:!before});
    const changed={...beforeMeta,count:Math.max(0,beforeMeta.count+(before?-1:1)),mine:!before}; favorites.metadata.set(key,changed); before?favorites.mine.delete(key):favorites.mine.add(key);
    if(changed.count||changed.legacy)favorites.entries.add(key);else favorites.entries.delete(key);
    notifyFavorites(); // Immediate feedback, explicitly marked as pending.
    const operation = async () => {
      try {
        const result = await timed(Promise.resolve().then(() => before ? api.remove(offer) : api.add(offer)));
        // The transport already verifies the write. Reuse its confirmed list
        // instead of making a redundant second network read.
        const entries = Array.isArray(result) && result.every(validOffer)
          ? result : await readFavoriteEntries(api);
        favorites.pending.delete(key);
        favorites.entries = applyVoteRows(entries);
        for (const [pendingKey, value] of favorites.pending) {
          const meta=favorites.metadata.get(pendingKey)||{count:0,mine:false,legacy:false};
          const changed={...meta,count:Math.max(0,meta.count+(value.selected?1:-1)),mine:value.selected};favorites.metadata.set(pendingKey,changed);
          value.selected?favorites.mine.add(pendingKey):favorites.mine.delete(pendingKey);
          if(changed.count||changed.legacy)favorites.entries.add(pendingKey);else favorites.entries.delete(pendingKey);
        }
        favorites.uncertain = favorites.errors.size > 0;
      } catch (_) {
        favorites.pending.delete(key);
        favorites.metadata.set(key,beforeMeta);before?favorites.mine.add(key):favorites.mine.delete(key);if(beforeMeta.count||beforeMeta.legacy)favorites.entries.add(key);else favorites.entries.delete(key);
        favorites.errors.add(key); favorites.uncertain = true;
      } finally {
        favorites.revision++;
        notifyFavorites();
      }
    };
    // Distinct cards can be clicked while a write is pending; server writes
    // remain ordered so old responses cannot undo newer choices.
    writeQueue = writeQueue.then(operation, operation);
    return writeQueue;
  }

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
  const filterPanel = root.querySelector('.filter-panel');
  const mobileFilterButton = root.querySelector('.mobile-filter-toggle');
  const filterResults = root.querySelector('.filter-results');
  const filterValues = [capacityFilter, priceFilter, travelFilter, bedsFilter, roomsFilter].filter(Boolean);
  const knownNumber = value => value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  let availabilityRecords = [];
  try { availabilityRecords = JSON.parse(document.getElementById('availability-data')?.textContent || '{}').records || []; } catch (_) {}
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
  });
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
      card.dataset.generalMatch = String(generalMatch);
      const bestMatch = ((card.dataset.bestEligible === 'true' || card.dataset.bestCandidate === 'true') && (party === 6 || (beds !== null && beds >= party))) ||
        (activeBest === 'best-apartment' && card.dataset.planGroup === 'full-daire' && card.dataset.bestAlternative === 'true') ||
        (showHouseAlternatives && card.dataset.planGroup === 'full-villa' && card.dataset.bestAlternative === 'true');
      card.hidden = !generalMatch || (activeBest !== '' && !bestMatch);
      const matchingStatus = count => availabilityRecords.find(entry => entry.scope === 'card' && entry.id === card.dataset.id && entry.checkIn === card.dataset.checkIn && entry.checkOut === card.dataset.checkOut && entry.adults === count);
      // Never use a six-person availability result as the seven-person result.
      const status = matchingStatus(party);
      const offerRows = Array.from(card.querySelectorAll('.ruebezahl-table tr[data-source-id]'));
      const allOffersUnavailable = offerRows.length > 0 && offerRows.every(row => availabilityRecords.some(entry => entry.scope === 'offer' && entry.id === row.dataset.sourceId && entry.checkIn === card.dataset.checkIn && entry.checkOut === card.dataset.checkOut && entry.adults === party && entry.status === 'unavailable'));
      // One provider's sold-out result cannot make a multi-offer property sold out.
      const visibleStatus = status?.status === 'unavailable' && offerRows.length && !allOffersUnavailable ? null : status;
      const quoteNote = card.querySelector('.party-quote-note');
      if (quoteNote) {
        const selected = Number(guestFilter?.value || 6);
        const notes = [];
        if (Number(card.dataset.offerAdults) !== selected) notes.push(status?.status === 'available' && status.displayPrice ? `Karttaki fiyat ${card.dataset.offerAdults} kişi için; ${selected} kişilik son kaynak fiyatı ayrıca gösteriliyor.` : `Gösterilen fiyat ${card.dataset.offerAdults} kişi için; ${selected} kişi için fiyat ve müsaitlik ayrıca kontrol edilmeli.`);
        if (capacity !== null && capacity < selected) notes.push(`İlan kapasitesi ${capacity} kişi; ${selected}. kişi için ev sahibi onayı gerekir.`);
        quoteNote.hidden = notes.length === 0;
        quoteNote.textContent = notes.join(' ');
      }
      const statusNode = card.querySelector('.availability-status');
      card.dataset.availability = visibleStatus?.status || 'unknown';
      if (statusNode) {
        statusNode.hidden = !visibleStatus;
        // The photo chip stays short; the full dated observation is in the summary tab.
        const overview = card.querySelector('.detail-panel[data-panel="overview"]');
        let full = overview?.querySelector('.availability-full');
        if (visibleStatus) {
          const day = new Intl.DateTimeFormat('tr-TR', {day:'numeric', month:'long'}).format(new Date(visibleStatus.checkedAt));
          let text = `${visibleStatus.status === 'unavailable' ? 'Bu Tarihlerde Müsait Değil' : 'Kaynakta Müsait Göründü'} · ${visibleStatus.adults} Kişi · ${day}`;
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
      card.querySelectorAll('.ruebezahl-table tr[data-source-id]').forEach(row => {
        const offer = availabilityRecords.find(entry => entry.scope === 'offer' && entry.id === row.dataset.sourceId && entry.checkIn === card.dataset.checkIn && entry.checkOut === card.dataset.checkOut && entry.adults === party);
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
    if (filterResults) {
      const visibleCount = cards.filter(card => !card.hidden && (favoritesOnly || !card.closest('.group')?.hidden)).length;
      filterResults.textContent = hasExtraFilters ? `${visibleCount} seçenek gösteriliyor` : '';
    }
    const filterCount = filterValues.filter(control => control.value !== 'all').length;
    const mobileCount = mobileFilterButton?.querySelector('.active-filter-count');
    if (mobileCount) mobileCount.textContent = filterCount ? `(${filterCount})` : '';
    root.dispatchEvent(new Event('cards-filtered', {bubbles:true}));
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
        ? (window.BerlinPrototype ? 'Önizleme: Beğeniler yalnızca bu denemede tutulur, ortak listeye yazılmaz.' : favorites.uncertain ? 'Bir işlemin sonucu doğrulanamadı. Ortak listeyi Güncelle ile kontrol edin.' : 'İsimsiz beğeniler siteyi açan herkese görünür. Her tarayıcı bir kez beğenebilir; favoriler en çok beğenilene göre sıralanır.')
        : favorites.state === 'loading' ? 'Ortak favoriler yükleniyor.'
        : favorites.state === 'error' && favorites.uncertain
          ? 'İşlemin sonucu doğrulanamadı. Ortak listeyi yeniden yükleyin.'
          : favorites.state === 'error' ? 'Ortak favoriler yüklenemedi. Yeniden deneyin.'
          : window.BerlinFavoritesEndpointConfigured ? 'Ortak favoriler henüz bağlanamadı.'
          : 'Ortak favoriler bağlanmadı.';
    }
    if (favoriteRetry) {
      favoriteRetry.hidden = !adapter();
      favoriteRetry.disabled = favorites.busy || favorites.pending.size > 0;
      favoriteRetry.textContent = ready ? 'Güncelle' : 'Yeniden Dene';
    }
    // A map dialog contains a live clone, so refresh original and copied buttons.
    root.querySelectorAll('.favorite-button').forEach(button => {
      const card = button.closest('.stay-card');
      if (!card) return;
      const key = offerKey(offerFromCard(card));
      const pending = favorites.pending.get(key);
      const failed = favorites.errors.has(key);
      const selected = ready && favorites.mine.has(key);
      const vote=favorites.metadata.get(key)||{count:0};
      card.dataset.votes=String(vote.count);
      card.classList.toggle('liked-two',vote.count===2);card.classList.toggle('liked-many',vote.count>=3);
      let badge=card.querySelector('.vote-badge');if(!badge){badge=document.createElement('span');badge.className='vote-badge';(card.querySelector('.media-flags')||card.querySelector('.card-title')).prepend(badge);}
      badge.textContent=vote.count?`${vote.count} Beğeni`:vote.legacy?'Önceki Ortak Favori':'';badge.hidden=!badge.textContent;
      const name = card.querySelector('.card-title h3, .card-title h4')?.textContent || 'Konaklama';
      const dates = card.querySelector('.card-kicker')?.textContent || '';
      button.disabled = !ready || Boolean(pending);
      button.setAttribute('aria-busy', String(Boolean(pending)));
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute('aria-label', ready ? `${name}, ${dates}: ${selected ? 'favorilerden kaldır' : 'favorilere ekle'}` : 'Ortak favoriler şu anda kullanılamıyor');
      button.querySelector('.favorite-heart').textContent = selected ? '♥' : '♡';
      button.querySelector('.favorite-label').textContent = pending ? (pending.selected ? 'Kaydediliyor…' : 'Kaldırılıyor…') : selected ? 'Beğendin' : 'Beğen';
      const unavailable = button.closest('.favorite-control')?.querySelector('.favorite-unavailable');
      if (unavailable) {
        unavailable.hidden = ready && !failed;
        unavailable.textContent = failed ? 'Sonuç doğrulanamadı; yeniden deneyin' : ready && pending ? 'Kaydediliyor' : favorites.state === 'loading' ? 'Yükleniyor' : favorites.state === 'error'
          ? 'Durum doğrulanamadı' : window.BerlinFavoritesEndpointConfigured
            ? 'Ortak liste bağlanamadı' : 'Ortak liste bağlı değil';
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
    if (event.target instanceof HTMLImageElement && event.target.matches('.photo-grid img')) markImageFailure(event.target);
  }, true);
  root.querySelectorAll('.photo-grid img').forEach(img => {
    if (img.complete && img.currentSrc && img.naturalWidth === 0) markImageFailure(img);
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
  if (adapter()) refreshFavorites();
  window.addEventListener('berlin-favorites-transport-ready', refreshFavorites);
  window.addEventListener('focus', () => { if (adapter()) refreshFavorites(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && adapter()) refreshFavorites(); });
  window.setInterval(() => { if (!document.hidden && adapter()) refreshFavorites(); }, 30000);
})();
