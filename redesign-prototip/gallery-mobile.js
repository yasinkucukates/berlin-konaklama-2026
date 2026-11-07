/* Load after liquid.js. It augments the existing galleries and their dialog. */
(() => {
  'use strict';
  // Cards use a single-photo carousel at every width so that each card keeps
  // a standard height; only the current and next photos are requested.
  const mobile = window.matchMedia('all');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const initialized = new WeakSet();
  const galleryStates = new WeakMap();
  const timeoutMs = 12000;

  const make = (tag, className) => {
    const element = document.createElement(tag);
    element.className = className;
    element.dataset.gmGenerated = 'true';
    return element;
  };
  const button = (className, label, glyph) => {
    const element = make('button', `gm-control ${className}`);
    element.type = 'button';
    element.setAttribute('aria-label', label);
    element.textContent = glyph;
    return element;
  };

  document.querySelectorAll('[data-berlin-view]').forEach(root => {
    const dialog = root.querySelector('dialog.lightbox');
    let openedGrid = null;
    const phone = window.matchMedia('(max-width: 639px)');
    const toolbar = root.querySelector('.toolbar');
    const bestChoices = toolbar?.querySelector('.best-choices');
    const favoriteFilter = toolbar?.querySelector('.favorite-filter');
    const controls = toolbar?.querySelector('.controls');
    const viewChoice = root.querySelector('.view-choice');
    const toolbarActions = document.createElement('div');
    toolbarActions.className = 'gm-toolbar-actions';
    const placePhoneActions = () => {
      if (!toolbar || !controls) return;
      if (phone.matches) {
        toolbar.after(toolbarActions);
        if (bestChoices) toolbarActions.appendChild(bestChoices);
        if (favoriteFilter) toolbarActions.appendChild(favoriteFilter);
        if (viewChoice) toolbarActions.appendChild(viewChoice);
        toolbar.appendChild(controls);
      } else {
        if (bestChoices) toolbar.insertBefore(bestChoices, controls);
        toolbar.appendChild(controls);
        if (favoriteFilter) toolbar.insertBefore(favoriteFilter, controls);
        toolbarActions.remove();
      }
    };
    placePhoneActions();
    if (phone.addEventListener) phone.addEventListener('change', placePhoneActions);
    else phone.addListener(placePhoneActions);
    const activeGrids = new Set();
    const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const state = galleryStates.get(entry.target);
        if (!state) return;
        state.visible = entry.isIntersecting;
        state.checkImage();
      });
    }, {rootMargin:'0px'}) : null;

    function setup(grid) {
      if (initialized.has(grid)) {
        if (!activeGrids.has(grid)) {
          activeGrids.add(grid);
          galleryStates.get(grid)?.refreshMode();
          if (io) io.observe(grid);
        }
        return;
      }
      const media = grid.closest('.card-media');
      const card = grid.closest('.stay-card');
      const links = Array.from(grid.querySelectorAll('a[data-photo-url]'));
      if (!media || !card || !links.length) return;
      initialized.add(grid);
      activeGrids.add(grid);
      let frame = grid.parentElement;
      if (!frame.classList.contains('gm-frame')) {
        frame = document.createElement('div');
        frame.className = 'gm-frame';
        grid.before(frame);
        frame.appendChild(grid);
      }
      // cloneNode(true) copies the source card's controls and transient state.
      frame.querySelectorAll('[data-gm-generated]').forEach(el => el.remove());
      const title = card.querySelector('.card-title h3, .card-title h4')?.textContent?.trim() || 'Konaklama';
      const open = frame.querySelector('.gallery-open') || media.querySelector('.gallery-open');
      if (open) {
        frame.appendChild(open);
        open.textContent = 'Fotoğraflar';
        open.setAttribute('aria-label', `${title}: ${links.length} fotoğrafı aç`);
        if (!dialog || typeof dialog.showModal !== 'function') open.hidden = true;
      }
      grid.setAttribute('role', 'group');
      grid.setAttribute('aria-label', `${title} fotoğrafları`);
      grid.setAttribute('aria-roledescription', 'fotoğraf galerisi');

      const controls = make('div', 'gm-controls');
      const previous = button('gm-prev', 'Önceki fotoğraf', '‹');
      const next = button('gm-next', 'Sonraki fotoğraf', '›');
      controls.append(previous, next);
      const counter = make('span', 'gm-counter');
      counter.setAttribute('aria-hidden', 'true');
      const announcement = make('span', 'gm-sr-only');
      announcement.setAttribute('aria-live', 'polite');
      announcement.setAttribute('aria-atomic', 'true');
      const imageStatus = make('span', 'gm-image-status');
      imageStatus.setAttribute('role', 'status');
      imageStatus.hidden = true;
      imageStatus.textContent = 'Fotoğraf gecikti. İlanda açabilirsiniz.';
      frame.append(controls, counter, announcement, imageStatus);

      let index = 0, imageTimer = 0, liveTimer = 0, raf = 0;
      let programTarget = null, programTimer = 0;
      const state = {visible:!io, checkImage, go, refreshMode, deactivate};
      galleryStates.set(grid, state);
      const ensure = i => {
        const img = links[i]?.querySelector('img');
        if (img && !img.hasAttribute('src') && img.dataset.gmSrc) img.src = img.dataset.gmSrc;
      };
      function checkImage() {
        clearTimeout(imageTimer);
        imageStatus.hidden = true;
        if (!mobile.matches || !state.visible) return;
        const img = links[index]?.querySelector('img');
        if (!img || links[index].classList.contains('photo-failed') || (img.complete && img.naturalWidth > 0)) return;
        const expected = index;
        imageTimer = setTimeout(() => {
          if (state.visible && mobile.matches && index === expected && !links[index].classList.contains('photo-failed') && !(img.complete && img.naturalWidth > 0)) imageStatus.hidden = false;
        }, timeoutMs);
      }
      function update() {
        const width = grid.clientWidth;
        const nextIndex = mobile.matches && width ? Math.max(0, Math.min(links.length - 1, Math.round(grid.scrollLeft / width))) : 0;
        const changed = nextIndex !== index;
        index = nextIndex;
        counter.textContent = `${index + 1} / ${links.length}`;
        previous.disabled = index <= 0;
        next.disabled = index >= links.length - 1;
        controls.hidden = links.length < 2;
        links.forEach((link, i) => {
          if (mobile.matches) link.tabIndex = i === index ? 0 : -1;
          else link.removeAttribute('tabindex');
        });
        if (mobile.matches) { ensure(index); ensure(index + 1); }
        if (changed) {
          clearTimeout(liveTimer);
          liveTimer = setTimeout(() => { announcement.textContent = `Fotoğraf ${index + 1} / ${links.length}`; }, 180);
        }
        checkImage();
      }
      function go(target, smooth = true) {
        const destination = Math.max(0, Math.min(links.length - 1, target));
        ensure(destination);
        ensure(destination + 1);
        clearTimeout(programTimer);
        programTarget = smooth && !reduced.matches ? destination : null;
        if (programTarget !== null) programTimer = setTimeout(() => { programTarget = null; }, 900);
        grid.scrollTo({left:destination * grid.clientWidth, behavior:smooth && !reduced.matches ? 'smooth' : 'auto'});
        if (!smooth || reduced.matches) update();
      }
      function refreshMode() {
        links.forEach((link, i) => {
          const img = link.querySelector('img');
          if (!img) return;
          if (!img.dataset.gmSrc && img.getAttribute('src')) img.dataset.gmSrc = img.getAttribute('src');
          // On mobile the first and next image may load lazily; the rest wait
          // until approached. Already loaded images are never discarded.
          if (mobile.matches && i > 1 && !(img.complete && img.naturalWidth > 0)) img.removeAttribute('src');
          if (!mobile.matches && !img.hasAttribute('src') && img.dataset.gmSrc) img.src = img.dataset.gmSrc;
        });
        update();
      }
      function deactivate() {
        state.visible = !io;
        clearTimeout(imageTimer);
        clearTimeout(liveTimer);
        clearTimeout(programTimer);
        programTarget = null;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      }
      grid.addEventListener('pointerdown', () => { programTarget = null; clearTimeout(programTimer); }, {passive:true});
      grid.addEventListener('scroll', () => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => { raf = 0; update(); });
      }, {passive:true});
      grid.addEventListener('load', event => { if (event.target instanceof HTMLImageElement) checkImage(); }, true);
      grid.addEventListener('error', event => { if (event.target instanceof HTMLImageElement) checkImage(); }, true);
      grid.addEventListener('keydown', event => {
        if (!mobile.matches || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault();
          const target = Math.max(0, Math.min(links.length - 1, (programTarget ?? index) + (event.key === 'ArrowRight' ? 1 : -1)));
          go(target);
          links[target].focus({preventScroll:true});
        }
      });
      previous.addEventListener('click', () => go((programTarget ?? index) - 1));
      next.addEventListener('click', () => go((programTarget ?? index) + 1));
      refreshMode();
      if (io) io.observe(grid);
    }

    root.querySelectorAll('.photo-grid').forEach(setup);
    root.classList.add('gm-ready');
    const refreshAll = () => activeGrids.forEach(grid => galleryStates.get(grid)?.refreshMode());
    if (mobile.addEventListener) mobile.addEventListener('change', refreshAll);
    else mobile.addListener(refreshAll);
    // Detail cards are created later with cloneNode, including copied controls.
    const eachGrid = (node, callback) => {
      if (!(node instanceof Element)) return;
      if (node.matches('.photo-grid')) callback(node);
      node.querySelectorAll('.photo-grid').forEach(callback);
    };
    new MutationObserver(records => {
      records.forEach(record => record.addedNodes.forEach(node => eachGrid(node, setup)));
      records.forEach(record => record.removedNodes.forEach(node => eachGrid(node, grid => {
        if (root.contains(grid)) return; // Reordering within the same view is not a removal.
        activeGrids.delete(grid);
        if (io) io.unobserve(grid);
        galleryStates.get(grid)?.deactivate();
      })));
    }).observe(root, {childList:true, subtree:true});

    if (!dialog) return;
    root.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target.closest('.photo-grid a[data-photo-url]');
      const open = event.target.closest('.gallery-open');
      if (link && !link.classList.contains('photo-failed')) openedGrid = link.closest('.photo-grid');
      else if (open) openedGrid = open.closest('.card-media')?.querySelector('.photo-grid') || null;
    }, true);
    const stage = dialog.querySelector('.lightbox-stage');
    const large = stage?.querySelector('img');
    const error = stage?.querySelector('.lightbox-error');
    const source = dialog.querySelector('.lightbox-caption a');
    if (!stage || !large || !error || !source) return;
    const loading = make('span', 'gm-lightbox-loading');
    loading.setAttribute('role', 'status');
    loading.textContent = 'Fotoğraf yükleniyor…';
    loading.hidden = true;
    stage.appendChild(loading);
    large.draggable = false;
    let loadTimer = 0, gesture = null;
    const settle = () => { clearTimeout(loadTimer); loading.hidden = true; };
    const startLoad = () => {
      settle();
      if (!large.getAttribute('src')) return;
      if (large.complete && large.naturalWidth > 0) { error.hidden = true; large.hidden = false; return; }
      if (large.complete && large.currentSrc && large.naturalWidth === 0) return;
      loading.hidden = false;
      const url = large.getAttribute('src');
      loadTimer = setTimeout(() => {
        if (dialog.open && large.getAttribute('src') === url && !(large.complete && large.naturalWidth > 0)) {
          loading.hidden = true; large.hidden = true; error.hidden = false;
          error.textContent = 'Fotoğraf yüklenemedi veya gecikti. Alttaki kaynak bağlantısını kullanın.';
        }
      }, timeoutMs);
    };
    new MutationObserver(startLoad).observe(large, {attributes:true, attributeFilter:['src']});
    large.addEventListener('load', () => { settle(); if (large.naturalWidth > 0) { large.hidden = false; error.hidden = true; } });
    large.addEventListener('error', settle);
    stage.addEventListener('pointerdown', event => {
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) { gesture = null; return; }
      gesture = {id:event.pointerId, x:event.clientX, y:event.clientY};
      try { stage.setPointerCapture(event.pointerId); } catch (_) { /* Touch may already have ended. */ }
    });
    stage.addEventListener('pointercancel', () => { gesture = null; });
    stage.addEventListener('pointerup', event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
      gesture = null;
      if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      dialog.querySelector(`[data-step="${dx < 0 ? 1 : -1}"]`)?.click();
    });
    dialog.addEventListener('close', () => {
      settle(); gesture = null;
      if (!mobile.matches || !openedGrid?.isConnected) { openedGrid = null; return; }
      const links = Array.from(openedGrid.querySelectorAll('a[data-photo-url]'));
      const selected = links.findIndex(link => link.dataset.photoUrl === source.href);
      const state = galleryStates.get(openedGrid);
      if (selected >= 0 && state) {
        state.go(selected, false);
        links[selected].focus({preventScroll:true});
      }
      openedGrid = null;
    });
  });
})();
