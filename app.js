// TradeVerse PRD — client behavior
// Phase 1.3: mobile nav toggle.
// Phase 3.1: auto-built TOC + scroll-spy.

/* -------------------------------------------------------------------------- */
/* Mobile nav toggle (Phase 1.3)                                              */
/* -------------------------------------------------------------------------- */
(function initNavToggle() {
  const toggle = document.querySelector('[data-nav-toggle]');
  const rail = document.getElementById('nav-rail');
  const scrim = document.querySelector('[data-nav-scrim]');
  if (!toggle || !rail || !scrim) return;

  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    rail.dataset.open = String(open);
    scrim.dataset.open = String(open);
    document.body.style.overflow = open ? 'hidden' : '';
  };

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    setOpen(open);
  });

  scrim.addEventListener('click', () => setOpen(false));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      toggle.focus();
    }
  });

  // Reset state if the viewport grows past the mobile breakpoint.
  const mq = window.matchMedia('(min-width: 961px)');
  const onChange = () => { if (mq.matches) setOpen(false); };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else mq.addListener(onChange);

  // Expose so other modules (TOC link click) can close the drawer on mobile.
  window.__tvNav = { close: () => setOpen(false), isMobile: () => !mq.matches };
})();

/* -------------------------------------------------------------------------- */
/* Heading anchors + copy link (Phase 3.2)                                    */
/* -------------------------------------------------------------------------- */
(function initHeadingAnchors() {
  const main = document.getElementById('main');
  if (!main) return;

  const headings = main.querySelectorAll('h2[id], h3[id], h4[id]');
  for (const h of headings) {
    if (h.querySelector('.anchor-link')) continue;
    const a = document.createElement('a');
    a.className = 'anchor-link';
    a.href = '#' + h.id;
    a.setAttribute('aria-label', 'Copy link to ' + (h.textContent || '').trim());
    a.textContent = '#';
    h.appendChild(a);
  }

  main.addEventListener('click', async (e) => {
    const a = e.target.closest('.anchor-link');
    if (!a) return;
    e.preventDefault();
    const id = a.getAttribute('href').slice(1);
    const target = document.getElementById(id);
    if (!target) return;

    // Update URL hash without jumping (smooth scroll handles motion).
    history.replaceState(null, '', '#' + id);
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Copy a full deep-link if the Clipboard API is available.
    const url = location.origin + location.pathname + '#' + id;
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch { /* clipboard blocked — silent fail, hash still updates */ }

    if (copied) {
      a.dataset.copied = 'true';
      const original = a.textContent;
      a.textContent = '✓';
      setTimeout(() => {
        a.textContent = original;
        delete a.dataset.copied;
      }, 1200);
    }
  });

  // If we arrived with a hash, ensure the section is properly focused for AT.
  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) {
      // Wait for layout, then re-trigger :target highlight reliably.
      requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: 'auto', block: 'start' });
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      });
    }
  }
})();

/* -------------------------------------------------------------------------- */
/* TOC builder + scroll-spy (Phase 3.1)                                       */
/* -------------------------------------------------------------------------- */
(function initTOC() {
  const list = document.querySelector('[data-toc-list]');
  const main = document.getElementById('main');
  if (!list || !main) return;

  // Pull every top-level <section> with an id, and use its first H2 as label.
  const sections = Array.from(main.querySelectorAll('section[id]')).filter((s) => {
    return s.querySelector(':scope > h2');
  });
  if (!sections.length) return;

  // Build TOC items.
  const linkBySectionId = new Map();
  const numRe = /^\s*(\d+(?:\.\d+)*)[.\s]+(.*)$/;

  for (const sec of sections) {
    const h2 = sec.querySelector(':scope > h2');
    const raw = (h2.textContent || '').trim().replace(/\s+/g, ' ');
    const match = raw.match(numRe);
    const num = match ? match[1] : '';
    const text = match ? match[2] : raw;

    const li = document.createElement('li');
    li.className = 'toc__item';

    const a = document.createElement('a');
    a.className = 'toc__link';
    a.href = '#' + sec.id;
    a.dataset.tocLink = sec.id;

    const numEl = document.createElement('span');
    numEl.className = 'toc__num';
    numEl.textContent = num;
    numEl.setAttribute('aria-hidden', 'true');

    const textEl = document.createElement('span');
    textEl.className = 'toc__text';
    textEl.textContent = text;

    a.append(numEl, textEl);
    li.append(a);
    list.append(li);

    linkBySectionId.set(sec.id, a);
  }

  // Close mobile drawer after picking a section.
  list.addEventListener('click', (e) => {
    const a = e.target.closest('.toc__link');
    if (!a) return;
    if (window.__tvNav && window.__tvNav.isMobile()) {
      // Defer so the browser starts smooth-scrolling first.
      setTimeout(() => window.__tvNav.close(), 60);
    }
  });

  // Scroll-spy: highlight the section whose top is nearest the toolbar.
  const setActive = (id) => {
    for (const [sectionId, link] of linkBySectionId) {
      const isActive = sectionId === id;
      link.toggleAttribute('data-active', isActive);
      if (isActive) {
        link.setAttribute('aria-current', 'true');
        // Keep the active link visible inside the rail.
        link.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else {
        link.removeAttribute('aria-current');
      }
    }
  };

  // Track which sections currently intersect the viewport;
  // pick the one whose top is closest to the toolbar.
  const intersecting = new Set();
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) intersecting.add(entry.target);
      else intersecting.delete(entry.target);
    }
    pickActive();
  }, {
    // Bias the "active" line near the top of the viewport.
    rootMargin: '-15% 0px -70% 0px',
    threshold: 0,
  });

  const pickActive = () => {
    if (!intersecting.size) return;
    let best = null;
    let bestTop = Infinity;
    for (const el of intersecting) {
      const top = el.getBoundingClientRect().top;
      if (top < bestTop) { bestTop = top; best = el; }
    }
    if (best) setActive(best.id);
  };

  for (const sec of sections) io.observe(sec);

  // First-paint default: activate whatever's at the top, or the first section.
  requestAnimationFrame(() => {
    if (!intersecting.size) setActive(sections[0].id);
    else pickActive();
  });
})();

/* -------------------------------------------------------------------------- */
/* TOC search/filter (Phase 3.3)                                              */
/* -------------------------------------------------------------------------- */
(function initTOCSearch() {
  const input = document.querySelector('[data-toc-search]');
  const clear = document.querySelector('[data-toc-search-clear]');
  const empty = document.querySelector('[data-toc-empty]');
  const list = document.querySelector('[data-toc-list]');
  if (!input || !clear || !empty || !list) return;

  // Wait until the TOC has been built before snapshotting the original labels.
  const snapshot = () => {
    return Array.from(list.querySelectorAll('.toc__item')).map((li) => {
      const textEl = li.querySelector('.toc__text');
      return {
        item: li,
        textEl,
        original: (textEl && textEl.textContent) || '',
      };
    });
  };

  let entries = [];
  // Defer to next frame so initTOC's append loop has run.
  requestAnimationFrame(() => { entries = snapshot(); });

  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const apply = (raw) => {
    if (!entries.length) entries = snapshot();
    const q = raw.trim().toLowerCase();
    let visible = 0;

    if (!q) {
      for (const e of entries) {
        e.item.hidden = false;
        if (e.textEl) e.textEl.textContent = e.original;
      }
      empty.hidden = true;
      clear.hidden = true;
      return;
    }

    const re = new RegExp(escapeRe(q), 'ig');
    for (const e of entries) {
      const match = e.original.toLowerCase().includes(q);
      e.item.hidden = !match;
      if (!e.textEl) continue;
      if (match) {
        e.textEl.innerHTML = escapeHtml(e.original).replace(re, (m) =>
          '<mark class="toc__match">' + escapeHtml(m) + '</mark>'
        );
        visible++;
      } else {
        e.textEl.textContent = e.original;
      }
    }
    empty.hidden = visible > 0;
    clear.hidden = false;
  };

  input.addEventListener('input', (e) => apply(e.target.value));

  clear.addEventListener('click', () => {
    input.value = '';
    apply('');
    input.focus();
  });

  // Keyboard: '/' focuses the filter (unless already typing in another input).
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    const tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    e.preventDefault();
    input.focus();
    input.select();
  });

  // ESC clears (when input is focused) or blurs.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (input.value) {
        input.value = '';
        apply('');
      } else {
        input.blur();
      }
    }
  });
})();

/* -------------------------------------------------------------------------- */
/* Reading progress bar + back-to-top (Phase 3.4)                             */
/* -------------------------------------------------------------------------- */
(function initReadingProgress() {
  const wrap = document.querySelector('[data-reading-progress]');
  const bar = document.querySelector('[data-reading-progress-bar]');
  const btt = document.querySelector('[data-back-to-top]');
  if (!wrap || !bar || !btt) return;

  const SHOW_AFTER = 600; // px scrolled before back-to-top appears

  let ticking = false;

  const update = () => {
    ticking = false;

    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop || 0;
    const max = (doc.scrollHeight - window.innerHeight) || 1;
    const pct = Math.max(0, Math.min(100, (scrollTop / max) * 100));

    bar.style.width = pct.toFixed(2) + '%';
    wrap.setAttribute('aria-valuenow', String(Math.round(pct)));

    const shouldShow = scrollTop > SHOW_AFTER;
    if (shouldShow) {
      btt.hidden = false;
      // Force reflow so the visibility transition fires the first time.
      btt.offsetHeight; // eslint-disable-line no-unused-expressions
      btt.dataset.visible = 'true';
    } else {
      btt.dataset.visible = 'false';
      // Hide from AT once the fade-out finishes.
      setTimeout(() => {
        if (btt.dataset.visible !== 'true') btt.hidden = true;
      }, 220);
    }
  };

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  btt.addEventListener('click', () => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    // Move focus back to the document start for AT users.
    const main = document.getElementById('main');
    if (main) {
      main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
    }
  });

  update();
})();
