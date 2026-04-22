// TradeVerse PRD — client behavior
// Phase 1.3: mobile nav toggle. Editor, persistence, export arrive in 4–6.

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
})();
