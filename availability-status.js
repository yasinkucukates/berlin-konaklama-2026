/* Dated, person-specific source observations. This layer never writes votes. */
(function () {
  'use strict';

  function sourceName(raw) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:') return '';
      const host = url.hostname.toLowerCase();
      if (/(^|\.)airbnb\.[a-z.]+$/.test(host)) return 'Airbnb';
      if (/(^|\.)booking\.com$/.test(host)) return 'Booking';
      if (/(^|\.)vrbo\.com$/.test(host)) return 'Vrbo';
      if (/(^|\.)travanto\.de$/.test(host)) return 'Travanto';
      if (/(^|\.)fewo-direkt\.de$/.test(host)) return 'FeWo-direkt';
      if (/(^|\.)holidu\.[a-z.]+$/.test(host)) return 'Holidu';
      return '';
    } catch (_) { return ''; }
  }

  function formatDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('tr-TR', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul'}).format(date);
  }

  function valid(record) {
    return record && ['card', 'offer'].includes(record.scope) && typeof record.id === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(record.checkIn) && /^\d{4}-\d{2}-\d{2}$/.test(record.checkOut) &&
      [6, 7].includes(record.adults) && ['available', 'unavailable'].includes(record.status) &&
      !!formatDate(record.checkedAt) && !!sourceName(record.sourceUrl);
  }

  function offerId(link) {
    if (!link) return '';
    try {
      const url = new URL(link.href);
      const host = url.hostname.toLowerCase();
      const travanto = url.pathname.match(/\/(\d{5,})\//);
      const vrbo = url.pathname.match(/\/p(\d+)\/?$/);
      if (/(^|\.)travanto\.de$/.test(host) && travanto) return `travanto-${travanto[1]}`;
      if (/(^|\.)vrbo\.com$/.test(host) && vrbo) return `vrbo-${vrbo[1]}`;
    } catch (_) {}
    return '';
  }

  function updateOfferRows(card, records, party) {
    card.querySelectorAll('.ruebezahl-table tbody tr').forEach(row => {
      const id = offerId(row.querySelector('a[href]'));
      const match = records.find(r => r.scope === 'offer' && r.id === id && r.adults === party);
      if (!match) return;
      const cell = row.lastElementChild;
      if (!cell) return;
      const label = document.createElement('span');
      label.className = 'live-availability-offer';
      label.textContent = `${party} kişi · ${match.status === 'unavailable' ? 'Bu tarihlerde müsait değil' : 'Müsait görüldü'} · ${formatDate(match.checkedAt)}`;
      if (match.lastAttempt?.result === 'unknown') label.textContent += ' · Son kontrol doğrulanamadı';
      cell.append(label);
      if (match.status === 'unavailable') row.classList.add('live-availability-offer-unavailable');
    });
  }

  function providerSet(card) {
    const names = new Set();
    card.querySelectorAll('a[href]').forEach(link => {
      const name = sourceName(link.href);
      if (name) names.add(name);
    });
    return names;
  }

  function render(records) {
    const latest = new Map();
    records.filter(valid).forEach(record => {
      const key = JSON.stringify([record.scope, record.id, record.checkIn, record.checkOut, record.adults]);
      if (!latest.has(key) || Date.parse(latest.get(key).checkedAt) < Date.parse(record.checkedAt)) latest.set(key, record);
    });
    const observations = Array.from(latest.values());
    document.querySelectorAll('.stay-card[data-id][data-check-in][data-check-out]').forEach(card => {
      const dateMatches = observations.filter(r => r.checkIn === card.dataset.checkIn && r.checkOut === card.dataset.checkOut);
      const primary = card.querySelector('a.listing[href]');
      const source = sourceName(primary?.href || '');
      const matches = dateMatches.filter(r => r.scope === 'card' && r.id === card.dataset.id && sourceName(r.sourceUrl) === source).sort((a, b) => a.adults - b.adults);
      const party = card.querySelector('.offer-party-7') && !card.querySelector('.offer-party-6') ? 7 : 6;
      updateOfferRows(card, dateMatches, party);
      if (!matches.length) return;
      const title = card.querySelector('.card-title');
      if (!title) return;
      const container = document.createElement('div');
      container.className = 'live-availability';
      container.setAttribute('aria-label', 'Kaynakta son görülen müsaitlik');
      matches.forEach(record => {
        const item = document.createElement('span');
        item.className = `live-availability__item${record.status === 'unavailable' ? ' live-availability__item--unavailable' : ''}`;
        const date = formatDate(record.checkedAt);
        item.append(document.createTextNode(`${record.adults} kişi · ${record.status === 'unavailable' ? 'Bu tarihlerde müsait değil' : 'Müsait görüldü'} · ${date} · `));
        const link = document.createElement('a');
        link.href = record.sourceUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = sourceName(record.sourceUrl);
        item.append(link);
        if (record.status === 'available' && typeof record.displayPrice === 'string' && record.displayPrice.trim()) {
          const price = document.createElement('span');
          price.className = 'live-availability__price';
          price.textContent = `Son görülen: ${record.displayPrice}`;
          item.append(price);
        }
        if (record.lastAttempt?.result === 'unknown') {
          const uncertain = document.createElement('span');
          uncertain.className = 'live-availability__uncertain';
          uncertain.textContent = 'Son kontrol doğrulanamadı; önceki sonuç gösteriliyor.';
          item.append(uncertain);
        }
        container.append(item);
      });
      const area = title.querySelector('.area');
      if (area) area.insertAdjacentElement('afterend', container); else title.append(container);
      const current = matches.find(r => r.adults === party);
      if (current?.status === 'available' && current.displayPrice) {
        const price = card.querySelector('.amount > strong');
        if (price) {
          const hint = document.createElement('span');
          hint.className = 'live-availability-price-hint';
          hint.textContent = 'Önceki fiyat';
          price.insertAdjacentElement('afterend', hint);
        }
      }
      // A single failed offer never greys a property with other known providers.
      const anotherPartyAvailable = matches.some(r => r.adults !== party && r.status === 'available');
      if (current?.status === 'unavailable' && !anotherPartyAvailable && providerSet(card).size === 1 && !card.querySelector('.ruebezahl-table')) {
        card.classList.add('live-availability-unavailable');
      }
    });
  }

  const url = new URL('availability-status.json', location.href);
  url.searchParams.set('v', String(Math.floor(Date.now() / 60000)));
  fetch(url.href, {cache: 'no-store'}).then(response => {
    if (!response.ok) throw new Error('Status unavailable');
    return response.json();
  }).then(data => {
    if (data?.version === 1 && Array.isArray(data.records)) render(data.records);
  }).catch(() => { /* An inaccessible status file is never proof of unavailability. */ });
})();
