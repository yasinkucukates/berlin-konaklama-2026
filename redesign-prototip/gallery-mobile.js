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
  // iPhone (WebKit, 13 Nov 2026) closed the tab half a second after opening
  // when the page removed src from hundreds of images; swapping in a blank
  // pixel releases the photo the same way without that crash.
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const isBlank = img => !img.getAttribute('src') || img.getAttribute('src') === BLANK;
  window.BerlinBlankPhoto = BLANK;

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
    const phone = window.matchMedia('(max-width: 639px)');
    const toolbar = root.querySelector('.toolbar');
    const bestChoices = toolbar?.querySelector('.best-choices');
    const favoriteFilter = toolbar?.querySelector('.favorite-filter');
    const controls = toolbar?.querySelector('.controls');
    const viewChoice = root.querySelector('.view-choice');
    const toolbarActions = document.createElement('div');
    toolbarActions.className = 'gm-toolbar-actions';
    // On a phone the quick filters form one scrolling row of chips under the
    // plan switch: Filters, Sort, Favorites, New, Best. Each element returns
    // to its marker when the screen is wide again.
    const filterToggle = root.querySelector('.mobile-filter-toggle');
    const sortLabel = controls?.querySelector('.sort');
    const sortSelect = sortLabel?.querySelector('select');
    const newRow = root.querySelector('.new-filter-row');
    const lent = [filterToggle, sortLabel, newRow].filter(Boolean).map(element => {
      const marker = document.createComment('gm-home'); element.before(marker); return {element, marker};
    });
    let sortValue = null;
    if (sortLabel && sortSelect) {
      sortValue = make('span', 'gm-sort-value'); sortValue.setAttribute('aria-hidden', 'true');
      sortLabel.appendChild(sortValue);
      const syncSort = () => { sortValue.textContent = sortSelect.selectedOptions[0]?.textContent || ''; };
      sortSelect.addEventListener('change', syncSort);
      root.addEventListener('click', () => setTimeout(syncSort, 0));
      syncSort();
    }
    const placePhoneActions = () => {
      if (!toolbar || !controls) return;
      if (phone.matches) {
        toolbar.after(toolbarActions);
        if (filterToggle) toolbarActions.appendChild(filterToggle);
        if (sortLabel) toolbarActions.appendChild(sortLabel);
        if (favoriteFilter) toolbarActions.appendChild(favoriteFilter);
        if (newRow) toolbarActions.appendChild(newRow);
        if (bestChoices) toolbarActions.appendChild(bestChoices);
        if (viewChoice) toolbarActions.appendChild(viewChoice);
        toolbar.appendChild(controls);
      } else {
        lent.forEach(({element, marker}) => marker.after(element));
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
    // Phones close the tab when decoded photos pile up: one pass down the page
    // kept ~270 photos (≈860 MB of bitmaps) alive. Only galleries near the
    // screen keep their photos; far ones drop src and reload on return.
    const nearIo = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      entries.forEach(entry => galleryStates.get(entry.target)?.setNear(entry.isIntersecting));
    }, {rootMargin:'1500px 0px'}) : null;

    function setup(grid) {
      if (initialized.has(grid)) {
        if (!activeGrids.has(grid)) {
          activeGrids.add(grid);
          galleryStates.get(grid)?.refreshMode();
          if (io) io.observe(grid);
          if (nearIo) nearIo.observe(grid);
        }
        return;
      }
      const media = grid.closest('.card-media');
      const card = grid.closest('.stay-card');
      let links = Array.from(grid.querySelectorAll('a[data-photo-url]'));
      const total = () => grid.dataset.more ? Math.max(links.length, Number(grid.dataset.total) || links.length) : links.length;
      // The rest of the photos become links when the carousel nears them.
      // Another script (the large gallery) may have added the links already.
      const syncLinks = () => { if (grid.childElementCount !== links.length) links = Array.from(grid.querySelectorAll('a[data-photo-url]')); };
      const expandNear = i => {
        if (!grid.dataset.more || i < links.length - 2 || !window.BerlinExpandPhotos) return;
        window.BerlinExpandPhotos(grid);
        links = Array.from(grid.querySelectorAll('a[data-photo-url]'));
      };
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
        open.setAttribute('aria-label', `${title}: ${total()} fotoğrafı aç`);
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
      const state = {visible:!io, near:null, seen:false, checkImage, go, refreshMode, deactivate, setNear};
      galleryStates.set(grid, state);
      const ensure = i => {
        const img = links[i]?.querySelector('img');
        if (img && isBlank(img) && img.dataset.gmSrc) img.src = img.dataset.gmSrc;
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
        syncLinks();
        const width = grid.clientWidth;
        const nextIndex = mobile.matches && width ? Math.max(0, Math.min(links.length - 1, Math.round(grid.scrollLeft / width))) : 0;
        const changed = nextIndex !== index;
        index = nextIndex;
        expandNear(index);
        counter.textContent = `${index + 1} / ${total()}`;
        previous.disabled = index <= 0;
        next.disabled = index >= total() - 1;
        controls.hidden = total() < 2;
        links.forEach((link, i) => {
          if (mobile.matches) link.tabIndex = i === index ? 0 : -1;
          else link.removeAttribute('tabindex');
        });
        if (mobile.matches && state.near !== false) { ensure(index); ensure(index + 1); }
        if (changed) {
          clearTimeout(liveTimer);
          liveTimer = setTimeout(() => { announcement.textContent = `Fotoğraf ${index + 1} / ${total()}`; }, 180);
        }
        checkImage();
      }
      function go(target, smooth = true) {
        expandNear(target);
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
        syncLinks();
        links.forEach((link, i) => {
          const img = link.querySelector('img');
          if (!img) return;
          if (!img.dataset.gmSrc && !isBlank(img)) img.dataset.gmSrc = img.getAttribute('src');
          // On mobile the first and next image may load lazily; the rest wait
          // until approached. Already loaded images are never discarded.
          if (mobile.matches && i > 1 && !isBlank(img) && !(img.complete && img.naturalWidth > 0)) img.src = BLANK;
          if (!mobile.matches && isBlank(img) && img.dataset.gmSrc) img.src = img.dataset.gmSrc;
        });
        update();
      }
      function setNear(near) {
        if (state.near === near) return;
        state.near = near;
        if (near) { state.seen = true; grid.classList.remove('gm-far'); update(); return; }
        // iPhone (13 Nov 2026 tests) closed the page when hundreds of
        // images or strips changed at once right after opening. A strip that
        // has never been on screen is left exactly as it is; only strips the
        // visitor has passed are released, a few at a time while scrolling.
        if (!state.seen) return;
        grid.classList.add('gm-far');
        syncLinks();
        links.forEach(link => {
          const img = link.querySelector('img');
          if (!img || link.classList.contains('photo-failed') || isBlank(img)) return;
          if (!(img.complete && img.naturalWidth > 1)) return; // nothing decoded yet
          // Keep the address that last worked (the original after a failed copy).
          img.dataset.gmSrc = img.getAttribute('src');
          img.src = BLANK;
        });
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
      // Quick repeated taps step through photos. iOS would read two taps as
      // "zoom the page", and a tap that lands on the photo right after an
      // arrow tap would open the large view; neither is wanted here.
      let stepAt = 0, tapAt = 0;
      const step = amount => { stepAt = Date.now(); go((programTarget ?? index) + amount); };
      previous.addEventListener('click', () => step(-1));
      next.addEventListener('click', () => step(1));
      frame.addEventListener('touchend', event => {
        const now = Date.now(), quick = now - tapAt < 450;
        tapAt = now;
        if (!quick || !event.cancelable || event.touches.length) return;
        event.preventDefault();
        const control = event.target.closest && event.target.closest('.gm-control');
        if (control && !control.disabled) control.click();
      }, {passive: false});
      frame.addEventListener('click', event => {
        if (Date.now() - stepAt < 700 && event.target.closest('.photo-grid a')) { event.preventDefault(); event.stopPropagation(); }
      }, true);
      // Every strip starts closed (no scrolling layer); the near observer
      // opens the ones around the screen. 153 live strips at once closed the
      // tab on iPhone Chrome right after the page opened (13 Nov 2026 tests).
      if (nearIo) grid.classList.add('gm-far');
      refreshMode();
      if (io) io.observe(grid);
      if (nearIo) nearIo.observe(grid);
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
        if (nearIo) nearIo.unobserve(grid);
        galleryStates.get(grid)?.deactivate();
      })));
    }).observe(root, {childList:true, subtree:true});

    if (!dialog) return;
    // The viewer (liquid.js) reports where it was closed; leave the card's
    // strip on that photo so closing does not lose the place.
    dialog.addEventListener('viewer-close', event => {
      const grid = event.detail?.grid, index = event.detail?.index;
      if (!mobile.matches || !grid?.isConnected) return;
      window.BerlinExpandPhotos?.(grid);
      const state = galleryStates.get(grid);
      state?.refreshMode();
      if (state && index >= 0) state.go(index, false);
    });
  });
})();
