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
