// TradeVerse PRD — client behavior
// Phase 1.3: mobile nav toggle.
// Phase 3.1: auto-built TOC + scroll-spy.
// Phase 4.1: edit/view mode toggle.

/* -------------------------------------------------------------------------- */
/* Edit/View toggle (Phase 4.1)                                               */
/* -------------------------------------------------------------------------- */
const TVEditor = (function initEditMode() {
  const btn = document.querySelector('[data-edit-toggle]');
  const labelEl = document.querySelector('[data-edit-label]');
  const iconView = document.querySelector('[data-edit-icon-view]');
  const iconDone = document.querySelector('[data-edit-icon-done]');
  const pill = document.querySelector('[data-edit-mode-pill]');
  const listeners = new Set();

  const state = { editing: false };

  const apply = () => {
    document.body.dataset.editMode = state.editing ? 'true' : 'false';
    if (btn) {
      btn.setAttribute('aria-pressed', String(state.editing));
      btn.title = state.editing
        ? 'Exit edit mode (your changes stay on screen)'
        : 'Enter edit mode';
    }
    if (labelEl) labelEl.textContent = state.editing ? 'Done' : 'Edit';
    if (iconView) iconView.hidden = state.editing;
    if (iconDone) iconDone.hidden = !state.editing;
    if (pill) pill.hidden = !state.editing;

    for (const fn of listeners) {
      try { fn(state.editing); } catch (e) { console.error(e); }
    }
  };

  const set = (value) => {
    const next = !!value;
    if (next === state.editing) return;
    state.editing = next;
    apply();
  };

  if (btn) {
    btn.addEventListener('click', () => set(!state.editing));

    // Keyboard: Cmd/Ctrl + E toggles (avoid clashing with browser shortcuts).
    document.addEventListener('keydown', (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && !e.shiftKey && !e.altKey && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        set(!state.editing);
      }
    });
  }

  apply();

  return {
    isEditing: () => state.editing,
    set,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();

/* -------------------------------------------------------------------------- */
/* contenteditable wiring on content blocks (Phase 4.2)                       */
/* -------------------------------------------------------------------------- */
(function initContentEditable() {
  if (!TVEditor) return;
  const main = document.getElementById('main');
  if (!main) return;

  // Block-level editable selectors. Headings (h1–h4) are intentionally excluded
  // — they're handled by the heading-lock toggle in Phase 4.5. Table cells are
  // wired in Phase 4.4. The :not() filter respects per-element opt-out via
  // data-no-edit and skips anchor links inside headings.
  const SELECTOR = [
    '#main p:not([data-no-edit])',
    '#main li:not([data-no-edit])',
    '#main blockquote:not([data-no-edit])',
    '#main caption:not([data-no-edit])',
  ].join(', ');

  // Cache the editable nodes once — DOM is static after Phase 2.
  const targets = Array.from(document.querySelectorAll(SELECTOR));

  // Tag once for CSS hooks; CSS shows affordances only when in edit mode.
  for (const el of targets) el.classList.add('is-editable');

  // Avoid making list-item content of the TOC editable (defensive — TOC lives
  // outside #main, but if anyone moves it inside later, this preserves intent).
  const skip = (el) => el.closest('.toc, .toolbar, .nav-rail, .back-to-top, .reading-progress');

  const setEditable = (on) => {
    for (const el of targets) {
      if (skip(el)) continue;
      if (on) {
        el.setAttribute('contenteditable', 'plaintext-only');
        el.setAttribute('spellcheck', 'true');
      } else {
        el.removeAttribute('contenteditable');
        el.removeAttribute('spellcheck');
        // If a node was being edited, blur it so the caret doesn't linger.
        if (document.activeElement === el) el.blur();
      }
    }
  };

  // Some browsers (older Safari) ignore contenteditable="plaintext-only";
  // detect once and fall back to "true" with a paste sanitizer.
  const supportsPlaintextOnly = (() => {
    const probe = document.createElement('div');
    probe.setAttribute('contenteditable', 'plaintext-only');
    return probe.contentEditable === 'plaintext-only';
  })();

  if (!supportsPlaintextOnly) {
    // Fallback: full contenteditable + paste-as-plaintext + Enter behavior.
    const onPaste = (e) => {
      if (!TVEditor.isEditing()) return;
      const editable = e.target.closest('[contenteditable="true"], [contenteditable="plaintext-only"]');
      if (!editable || !main.contains(editable)) return;
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      // Use modern execCommand fallback; deprecated but the cleanest cross-
      // browser way to insert plain text into a contenteditable.
      document.execCommand('insertText', false, text);
    };
    document.addEventListener('paste', onPaste);

    const setEditableFallback = (on) => {
      for (const el of targets) {
        if (skip(el)) continue;
        if (on) el.setAttribute('contenteditable', 'true');
        else {
          el.removeAttribute('contenteditable');
          if (document.activeElement === el) el.blur();
        }
      }
    };
    TVEditor.onChange(setEditableFallback);
    setEditableFallback(TVEditor.isEditing());
    return;
  }

  TVEditor.onChange(setEditable);
  setEditable(TVEditor.isEditing());
})();

/* -------------------------------------------------------------------------- */
/* Editing affordances: placeholders + empty-state tracking (Phase 4.3)       */
/* -------------------------------------------------------------------------- */
(function initEditAffordances() {
  if (!TVEditor) return;
  const main = document.getElementById('main');
  if (!main) return;

  const PLACEHOLDERS = {
    P: 'Empty paragraph',
    LI: 'Empty list item',
    BLOCKQUOTE: 'Empty quote',
    CAPTION: 'Caption',
    TD: '—',
    TH: '—',
  };

  const editables = Array.from(document.querySelectorAll('#main .is-editable'));
  for (const el of editables) {
    if (!el.hasAttribute('data-placeholder')) {
      const fallback = PLACEHOLDERS[el.tagName] || 'Empty';
      el.setAttribute('data-placeholder', fallback);
    }
  }

  const isEffectivelyEmpty = (el) => {
    // Treat ' ', ' ', and stray <br> as empty.
    const txt = (el.textContent || '').replace(/ /g, ' ').trim();
    if (txt.length > 0) return false;
    // If only children are <br>s, it's empty.
    return Array.from(el.children).every((c) => c.tagName === 'BR');
  };

  const refresh = (el) => {
    if (isEffectivelyEmpty(el)) el.dataset.empty = 'true';
    else delete el.dataset.empty;
  };

  // Initial sweep.
  for (const el of editables) refresh(el);

  // Track changes only while in edit mode (events on <main> bubble up).
  const onInput = (e) => {
    if (!TVEditor.isEditing()) return;
    const el = e.target.closest('.is-editable');
    if (el) refresh(el);
  };
  const onBlur = (e) => {
    const el = e.target.closest('.is-editable');
    if (el) refresh(el);
  };

  main.addEventListener('input', onInput);
  main.addEventListener('blur', onBlur, true);

  // Re-sweep when entering edit mode (covers any DOM mutations done in view).
  TVEditor.onChange((on) => {
    if (!on) return;
    for (const el of editables) refresh(el);
  });
})();

/* -------------------------------------------------------------------------- */
/* Table cell editing + navigation (Phase 4.4)                                */
/* -------------------------------------------------------------------------- */
(function initTableCellEditing() {
  if (!TVEditor) return;
  const main = document.getElementById('main');
  if (!main) return;

  const cells = Array.from(main.querySelectorAll(
    'table th:not([data-no-edit]), table td:not([data-no-edit])'
  ));
  if (!cells.length) return;

  for (const cell of cells) cell.classList.add('is-editable');

  const supportsPlaintextOnly = (() => {
    const probe = document.createElement('div');
    probe.setAttribute('contenteditable', 'plaintext-only');
    return probe.contentEditable === 'plaintext-only';
  })();
  const editableValue = supportsPlaintextOnly ? 'plaintext-only' : 'true';

  const setEditable = (on) => {
    for (const cell of cells) {
      if (on) {
        cell.setAttribute('contenteditable', editableValue);
        cell.setAttribute('spellcheck', 'true');
      } else {
        cell.removeAttribute('contenteditable');
        cell.removeAttribute('spellcheck');
        if (document.activeElement === cell) cell.blur();
      }
    }
  };

  TVEditor.onChange(setEditable);
  setEditable(TVEditor.isEditing());

  // Keyboard navigation between cells while editing.
  const moveSelection = (cell) => {
    cell.focus();
    // Place caret at end of the cell content.
    const range = document.createRange();
    range.selectNodeContents(cell);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const cellAt = (table, rowIdx, colIdx) => {
    const rows = table.rows;
    if (rowIdx < 0 || rowIdx >= rows.length) return null;
    const row = rows[rowIdx];
    if (colIdx < 0 || colIdx >= row.cells.length) return null;
    return row.cells[colIdx];
  };

  const findEditable = (start, dir, axis) => {
    // Walk in the requested direction until we find an editable cell.
    const table = start.closest('table');
    if (!table) return null;
    let row = start.parentElement.rowIndex;
    let col = start.cellIndex;
    let safety = 0;
    while (safety++ < 1000) {
      if (axis === 'col') {
        col += dir;
        if (col < 0) {
          row -= 1;
          if (row < 0) return null;
          const r = table.rows[row];
          if (!r) return null;
          col = r.cells.length - 1;
        } else {
          const r = table.rows[row];
          if (col >= r.cells.length) {
            row += 1;
            col = 0;
            if (row >= table.rows.length) return null;
          }
        }
      } else {
        row += dir;
        if (row < 0 || row >= table.rows.length) return null;
      }
      const next = cellAt(table, row, col);
      if (next && next.matches('.is-editable')) return next;
      if (!next) return null;
    }
    return null;
  };

  main.addEventListener('keydown', (e) => {
    if (!TVEditor.isEditing()) return;
    const cell = e.target.closest('th, td');
    if (!cell || !main.contains(cell)) return;

    if (e.key === 'Tab') {
      const next = findEditable(cell, e.shiftKey ? -1 : 1, 'col');
      if (next) {
        e.preventDefault();
        moveSelection(next);
      }
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      // Move to the cell directly below (spreadsheet behavior).
      const next = findEditable(cell, 1, 'row');
      if (next) {
        e.preventDefault();
        moveSelection(next);
      } else {
        // No row below — block the newline so the cell doesn't grow taller.
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'Enter' && e.shiftKey) {
      // Shift+Enter = move up one row.
      const prev = findEditable(cell, -1, 'row');
      if (prev) {
        e.preventDefault();
        moveSelection(prev);
      } else {
        e.preventDefault();
      }
    }
  });
})();

/* -------------------------------------------------------------------------- */
/* Heading lock (Phase 4.5)                                                   */
/* -------------------------------------------------------------------------- */
(function initHeadingLock() {
  if (!TVEditor) return;
  const main = document.getElementById('main');
  const btn = document.querySelector('[data-headings-toggle]');
  const labelEl = document.querySelector('[data-headings-label]');
  const iconLocked = document.querySelector('[data-headings-icon-locked]');
  const iconUnlocked = document.querySelector('[data-headings-icon-unlocked]');
  if (!main || !btn) return;

  // Default: locked. The toolbar button only shows in edit mode.
  let unlocked = false;

  const headings = Array.from(main.querySelectorAll('h1[id], h2[id], h3[id], h4[id]'));
  for (const h of headings) {
    h.classList.add('is-editable');
    if (!h.hasAttribute('data-placeholder')) {
      h.setAttribute('data-placeholder', 'Heading');
    }
  }

  // Inject the unlock warning banner once, at the very top of <main>.
  const warning = document.createElement('div');
  warning.className = 'lock-warning';
  warning.setAttribute('role', 'status');
  warning.innerHTML =
    '<strong>⚠ Structure unlocked.</strong> ' +
    'Editing heading text changes the TOC label, but section ids stay stable so deep-links keep working. ' +
    'Click <kbd>🔓 Lock structure</kbd> in the toolbar to relock — or just leave edit mode and it relocks for you.';
  main.insertBefore(warning, main.firstElementChild);

  const supportsPlaintextOnly = (() => {
    const probe = document.createElement('div');
    probe.setAttribute('contenteditable', 'plaintext-only');
    return probe.contentEditable === 'plaintext-only';
  })();
  const editableValue = supportsPlaintextOnly ? 'plaintext-only' : 'true';

  const apply = () => {
    const editing = TVEditor.isEditing();
    const live = editing && unlocked;

    document.body.dataset.headingsUnlocked = unlocked ? 'true' : 'false';
    btn.hidden = !editing;
    btn.setAttribute('aria-pressed', String(unlocked));
    if (iconLocked) iconLocked.hidden = unlocked;
    if (iconUnlocked) iconUnlocked.hidden = !unlocked;
    if (labelEl) labelEl.textContent = unlocked ? 'Lock structure' : 'Unlock structure';
    btn.title = unlocked
      ? 'Headings are unlocked. Click to relock.'
      : 'Headings are locked. Click to unlock — note this can break the TOC label rendering until you exit edit mode (deep-links stay intact).';

    for (const h of headings) {
      if (live) {
        h.setAttribute('contenteditable', editableValue);
        h.setAttribute('spellcheck', 'true');
      } else {
        h.removeAttribute('contenteditable');
        h.removeAttribute('spellcheck');
        if (document.activeElement === h) h.blur();
      }
    }
  };

  btn.addEventListener('click', () => {
    unlocked = !unlocked;
    apply();
  });

  // When edit mode flips OFF, snap headings back to locked so the next entry
  // starts safe.
  TVEditor.onChange((on) => {
    if (!on) unlocked = false;
    apply();
  });

  apply();
})();

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
/* Persistence: auto-save to localStorage (Phase 5.1)                         */
/*   Runs after Phase 4 modules tag .is-editable, BEFORE Phase 3 TOC build    */
/*   so restored heading text appears in the TOC on first paint.              */
/* -------------------------------------------------------------------------- */
const TVPersistence = (function initPersistence() {
  if (!TVEditor) return null;
  const main = document.getElementById('main');
  if (!main) return null;

  const STORAGE_KEY = 'tradeverse-prd-edits-v1';
  const SAVE_DEBOUNCE_MS = 600;
  const SCHEMA_VERSION = 1;

  // Stable path for any element, anchored to its nearest ancestor with an id.
  // Survives reflows because we count siblings of the same tag at each step.
  const pathFor = (el) => {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.id) {
        parts.unshift('#' + cur.id);
        return parts.join('>');
      }
      const parent = cur.parentNode;
      if (!parent || parent.nodeType !== 1) break;
      const sib = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
      const idx = sib.indexOf(cur);
      parts.unshift(cur.tagName.toLowerCase() + '[' + idx + ']');
      cur = parent;
    }
    return parts.join('>');
  };

  // Snapshot every editable element. Order matters here — the Phase 4 modules
  // have already added .is-editable to all targets by the time this runs.
  const editables = Array.from(main.querySelectorAll('.is-editable'));
  const originals = new Map(); // tvId -> original text

  for (const el of editables) {
    if (!el.dataset.tvId) el.dataset.tvId = pathFor(el);
    originals.set(el.dataset.tvId, el.textContent);
  }

  // ---- Restore from storage (synchronous, before TOC + anchors) ------------
  const readStorage = () => {
    let raw;
    try { raw = localStorage.getItem(STORAGE_KEY); }
    catch { return null; } // localStorage blocked (private mode / quota)
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (!data || data.version !== SCHEMA_VERSION) return null;
      return data;
    } catch { return null; }
  };

  const writeStorage = (data) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch { return false; } // Quota or disabled — silent.
  };

  let lastSavedAt = null;
  let lastSavedEditCount = 0;
  let dirty = false;

  const stored = readStorage();
  if (stored && stored.edits) {
    for (const [tvId, text] of Object.entries(stored.edits)) {
      const el = main.querySelector('[data-tv-id="' + CSS.escape(tvId) + '"]');
      if (el && typeof text === 'string') el.textContent = text;
    }
    lastSavedAt = stored.savedAt || null;
    lastSavedEditCount = Object.keys(stored.edits).length;
  }

  // ---- Save (debounced) ----------------------------------------------------
  const collect = () => {
    const edits = {};
    for (const el of editables) {
      const id = el.dataset.tvId;
      const cur = el.textContent;
      const orig = originals.get(id);
      if (orig !== undefined && cur !== orig) edits[id] = cur;
    }
    return edits;
  };

  const listeners = new Set();
  const emit = (event) => {
    for (const fn of listeners) {
      try { fn(event); } catch (e) { console.error(e); }
    }
  };

  const saveNow = () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const edits = collect();
    const count = Object.keys(edits).length;
    if (count === 0) {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
      lastSavedAt = null;
      lastSavedEditCount = 0;
      dirty = false;
      emit({ type: 'saved', count: 0, savedAt: null, cleared: true });
      return;
    }
    const ok = writeStorage({
      version: SCHEMA_VERSION,
      savedAt: Date.now(),
      edits,
    });
    if (ok) {
      lastSavedAt = Date.now();
      lastSavedEditCount = count;
      dirty = false;
      emit({ type: 'saved', count, savedAt: lastSavedAt, cleared: false });
    } else {
      emit({ type: 'error', reason: 'storage' });
    }
  };

  let saveTimer = null;
  const scheduleSave = () => {
    if (!dirty) {
      dirty = true;
      emit({ type: 'dirty' });
    }
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; saveNow(); }, SAVE_DEBOUNCE_MS);
  };

  // Listen for any input inside main; we filter to .is-editable here so future
  // additions (Phase 7 add-row, etc.) auto-participate as long as they get
  // tagged with .is-editable + data-tv-id on insertion.
  main.addEventListener('input', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const editable = t.closest('.is-editable[data-tv-id]');
    if (!editable) return;
    scheduleSave();
  });

  /**
   * Apply a foreign edits map to the live DOM, resetting every other
   * editable back to its original. After the DOM is in sync, persist via
   * the normal saveNow path so the active storage key reflects the new
   * state and the 'Saved' indicator updates. Phase 7.4 uses this to
   * restore version snapshots in-place without a reload.
   */
  const applyEdits = (incoming) => {
    const next = (incoming && typeof incoming === 'object') ? incoming : {};
    for (const el of editables) {
      const id = el.dataset.tvId;
      const orig = originals.get(id);
      const wanted = Object.prototype.hasOwnProperty.call(next, id)
        ? next[id]
        : orig;
      if (typeof wanted === 'string' && el.textContent !== wanted) {
        el.textContent = wanted;
        // Make sure data-empty stays in sync for the placeholder.
        if (wanted.trim() === '') el.dataset.empty = 'true';
        else delete el.dataset.empty;
      }
    }
    saveNow();

    // Re-label any heading-bearing section so the TOC reflects the
    // restored text without a full rebuild.
    if (typeof TVToc !== 'undefined' && TVToc && TVToc.relabel) {
      const sections = document.querySelectorAll('#main > section[id]');
      for (const sec of sections) TVToc.relabel(sec.id);
    }
  };

  return {
    saveNow,
    isDirty: () => dirty || saveTimer !== null,
    hasStoredEdits: () => lastSavedEditCount > 0,
    lastSavedAt: () => lastSavedAt,
    clear: () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
      lastSavedAt = null;
      lastSavedEditCount = 0;
      dirty = false;
      emit({ type: 'saved', count: 0, savedAt: null, cleared: true });
    },
    /** Snapshot of the current diff vs originals — used by Phase 7.4. */
    getCurrentEdits: () => collect(),
    /** Apply a previously-captured edits map (Phase 7.4 restore). */
    applyEdits,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();

/* -------------------------------------------------------------------------- */
/* Export menu dropdown + HTML export (Phase 6.1)                             */
/* -------------------------------------------------------------------------- */
const TVExport = (function initExport() {
  const trigger = document.querySelector('[data-export-trigger]');
  const list = document.querySelector('[data-export-menu-list]');
  const wrap = document.querySelector('[data-export-menu]');
  if (!trigger || !list || !wrap) return null;

  // ---- Dropdown plumbing ---------------------------------------------------
  const setOpen = (open) => {
    trigger.setAttribute('aria-expanded', String(open));
    list.hidden = !open;
    if (open) {
      // Focus first menu item for keyboard users.
      const first = list.querySelector('[role="menuitem"]:not([hidden])');
      if (first) first.focus({ preventScroll: true });
    }
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = trigger.getAttribute('aria-expanded') !== 'true';
    setOpen(open);
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      trigger.focus();
    }
  });

  // Arrow-key navigation within the open menu.
  list.addEventListener('keydown', (e) => {
    const items = Array.from(list.querySelectorAll('[role="menuitem"]:not([hidden])'));
    const idx = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = items[(idx + 1 + items.length) % items.length];
      if (next) next.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = items[(idx - 1 + items.length) % items.length];
      if (next) next.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0] && items[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1] && items[items.length - 1].focus();
    }
  });

  // Wire menu items to registered actions; subsequent parts (6.2/6.3) push
  // their own actions into this map.
  const actions = Object.create(null);
  list.addEventListener('click', (e) => {
    const item = e.target.closest('[data-export-action]');
    if (!item) return;
    const name = item.dataset.exportAction;
    const fn = actions[name];
    if (typeof fn === 'function') {
      setOpen(false);
      Promise.resolve()
        .then(() => fn())
        .catch((err) => {
          console.error('Export action failed:', err);
          window.alert('Export failed: ' + (err.message || err));
        });
    }
  });

  // ---- Helpers shared across exporters -------------------------------------
  const today = () => {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'),
            String(d.getDate()).padStart(2, '0')].join('-');
  };

  const triggerDownload = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
  };

  // ---- Cleanup: strip JS-injected dynamic state from a cloned document ----
  const cleanForExport = (doc) => {
    // 1. Remove dynamically-injected DOM.
    doc.querySelectorAll('.anchor-link').forEach((n) => n.remove());
    doc.querySelectorAll('.lock-warning').forEach((n) => n.remove());
    doc.querySelectorAll('.toc__list').forEach((ol) => { ol.innerHTML = ''; });
    doc.querySelectorAll('.toc__empty').forEach((p) => { p.hidden = true; });

    // 2. Strip dynamic attributes that JS will re-add.
    doc.querySelectorAll('[contenteditable]').forEach((el) => {
      el.removeAttribute('contenteditable');
      el.removeAttribute('spellcheck');
    });
    doc.querySelectorAll('[data-tv-id]').forEach((el) => el.removeAttribute('data-tv-id'));
    doc.querySelectorAll('[data-empty]').forEach((el) => el.removeAttribute('data-empty'));
    doc.querySelectorAll('.is-editable').forEach((el) => el.classList.remove('is-editable'));

    // 3. Reset body state.
    const body = doc.querySelector('body');
    if (body) {
      body.removeAttribute('data-edit-mode');
      body.removeAttribute('data-headings-unlocked');
    }

    // 4. Reset toolbar UI to its initial-paint state.
    const initialHidden = [
      '[data-save-status]', '[data-edit-mode-pill]',
      '[data-reset-button]', '[data-headings-toggle]', '[data-back-to-top]',
    ];
    for (const sel of initialHidden) {
      const el = doc.querySelector(sel);
      if (el) el.hidden = true;
    }

    const editBtn = doc.querySelector('[data-edit-toggle]');
    if (editBtn) editBtn.setAttribute('aria-pressed', 'false');
    const editLabel = doc.querySelector('[data-edit-label]');
    if (editLabel) editLabel.textContent = 'Edit';
    const iconView = doc.querySelector('[data-edit-icon-view]');
    if (iconView) iconView.hidden = false;
    const iconDone = doc.querySelector('[data-edit-icon-done]');
    if (iconDone) iconDone.hidden = true;

    const exportTrigger = doc.querySelector('[data-export-trigger]');
    if (exportTrigger) exportTrigger.setAttribute('aria-expanded', 'false');
    const exportList = doc.querySelector('[data-export-menu-list]');
    if (exportList) exportList.hidden = true;

    const progress = doc.querySelector('[data-reading-progress-bar]');
    if (progress) progress.style.width = '';
    const progressWrap = doc.querySelector('[data-reading-progress]');
    if (progressWrap) progressWrap.setAttribute('aria-valuenow', '0');

    return doc;
  };

  // ---- Inline current page CSS into the cloned document --------------------
  const inlineCSS = (doc) => {
    const css = [];
    for (const sheet of document.styleSheets) {
      // Skip cross-origin sheets (Google Fonts) — we'll keep their <link>
      // so connected machines still load the font, and they'd throw on
      // cssRules access anyway.
      if (sheet.href && /fonts\.googleapis\.com/.test(sheet.href)) continue;
      let rules;
      try { rules = sheet.cssRules; }
      catch { continue; }
      if (!rules) continue;
      for (const rule of rules) css.push(rule.cssText);
    }
    if (!css.length) return;

    const link = doc.querySelector('link[rel="stylesheet"][href$="styles.css"]');
    if (!link) return;
    const style = doc.createElement('style');
    style.textContent = css.join('\n');
    link.replaceWith(style);
  };

  // ---- Inline app.js source where possible ---------------------------------
  // Cached so repeated exports don't re-fetch.
  let scriptSourcePromise = null;
  const getScriptSource = () => {
    if (scriptSourcePromise) return scriptSourcePromise;
    const src = document.querySelector('script[src$="app.js"]');
    if (!src) {
      scriptSourcePromise = Promise.resolve(null);
      return scriptSourcePromise;
    }
    scriptSourcePromise = fetch(src.getAttribute('src'))
      .then((r) => (r.ok ? r.text() : null))
      .catch(() => null);
    return scriptSourcePromise;
  };

  const inlineJS = async (doc) => {
    const source = await getScriptSource();
    const script = doc.querySelector('script[src$="app.js"]');
    if (!script) return { inlined: false };
    if (!source) return { inlined: false };
    const inline = doc.createElement('script');
    inline.defer = true;
    inline.textContent = source;
    script.replaceWith(inline);
    return { inlined: true };
  };

  // ---- Public: build + download the standalone HTML ------------------------
  const exportHTML = async () => {
    // Flush any pending edits so the export reflects what's on screen.
    if (TVPersistence) {
      try { TVPersistence.saveNow(); } catch { /* noop */ }
    }

    const doc = document.documentElement.cloneNode(true);
    // Wrap in a transient document for querying convenience.
    const docWrap = { querySelector: (s) => doc.querySelector(s),
                      querySelectorAll: (s) => doc.querySelectorAll(s),
                      createElement: (t) => document.createElement(t) };
    cleanForExport(docWrap);
    inlineCSS(docWrap);
    const jsResult = await inlineJS(docWrap);

    // Mark the export with a comment header so recipients know what they have.
    const header =
      '<!--\n' +
      '  TradeVerse PRD — exported ' + new Date().toISOString() + '\n' +
      '  Edit in browser. Saves to your local browser storage.\n' +
      (jsResult.inlined
        ? '  Self-contained: CSS + JS inlined.\n'
        : '  Note: app.js could not be inlined (likely opened from file://).\n' +
          '        Place the original app.js next to this file for full editing.\n') +
      '-->\n';

    const html = '<!DOCTYPE html>\n' + header + doc.outerHTML;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    triggerDownload(blob, 'tradeverse-prd-' + today() + '.html');

    if (!jsResult.inlined) {
      window.alert(
        'Export saved, but app.js could not be inlined (this happens when ' +
        'the page is opened directly from disk in some browsers). The exported ' +
        'HTML still renders correctly — for full edit/save behavior, keep app.js ' +
        'in the same folder as the exported file, or serve over http(s).'
      );
    }
  };

  actions.html = exportHTML;

  return {
    register: (name, fn) => { actions[name] = fn; },
    closeMenu: () => setOpen(false),
    today,
    triggerDownload,
  };
})();

/* -------------------------------------------------------------------------- */
/* Markdown export (Phase 6.2)                                                */
/*                                                                            */
/*   Walks the live <main> tree and emits GitHub-flavored Markdown:           */
/*    - inline elements (strong, em, code, links) preserved                   */
/*    - status badges → `[LABEL]`, chips → `LABEL`                            */
/*    - callouts → GitHub admonitions (> [!NOTE]/[!TIP]/[!WARNING]/[!CAUTION])*/
/*    - tables → GFM pipe tables (| … |) with `|` escaped in cells            */
/*    - lists nested via two-space indent; ordered lists numbered             */
/* -------------------------------------------------------------------------- */
(function initMarkdownExport() {
  if (!TVExport) return;

  // ---- Helpers -------------------------------------------------------------
  const SKIP_CLASSES = new Set([
    'anchor-link', 'lock-warning', 'toc', 'toolbar', 'back-to-top',
    'reading-progress', 'nav-rail', 'nav-scrim', 'toolbar__pill',
    'toolbar__status', 'toolbar__menu',
  ]);

  const shouldSkip = (el) => {
    if (!el || !el.classList) return false;
    for (const cls of SKIP_CLASSES) if (el.classList.contains(cls)) return true;
    if (el.dataset && el.dataset.exportSkip === 'true') return true;
    return false;
  };

  // Light text escape — only the chars that would otherwise create unintended
  // markdown structure inside flowing prose. Aggressive escaping mangles
  // currency symbols and numerics that appear all over the PRD.
  const escText = (s) => (s || '').replace(/([\\`*_{}[\]()#+|])/g, '\\$1')
                                  .replace(/&nbsp;/g, ' ');

  const collapse = (s) => (s || '').replace(/\s+/g, ' ');

  // ---- Inline conversion ---------------------------------------------------
  const inlineOf = (node) => {
    if (!node) return '';
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += escText(child.nodeValue);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (shouldSkip(child)) continue;
      out += inlineEl(child);
    }
    return out;
  };

  const inlineEl = (el) => {
    const tag = el.tagName.toLowerCase();
    switch (tag) {
      case 'strong':
      case 'b':
        return '**' + inlineOf(el) + '**';
      case 'em':
      case 'i':
        return '*' + inlineOf(el) + '*';
      case 'code':
        return '`' + (el.textContent || '') + '`';
      case 'kbd':
      case 'samp':
        return '<' + tag + '>' + (el.textContent || '') + '</' + tag + '>';
      case 'a': {
        if (el.classList.contains('anchor-link')) return '';
        const text = inlineOf(el).trim() || el.textContent.trim();
        const href = el.getAttribute('href') || '';
        return href ? '[' + text + '](' + href + ')' : text;
      }
      case 'br':
        return '  \n';
      case 'span': {
        if (el.classList.contains('badge')) {
          const label = (el.textContent || '').trim().toUpperCase();
          return '`[' + label + ']`';
        }
        if (el.classList.contains('chip')) {
          const label = (el.textContent || '').trim();
          return '`' + label + '`';
        }
        return inlineOf(el);
      }
      default:
        return inlineOf(el);
    }
  };

  // ---- Block conversion ----------------------------------------------------
  // Each block returns its markdown WITHOUT leading/trailing blank lines —
  // the joiner in childrenToMarkdown adds the blank-line separator.
  const blockOf = (node, ctx) => {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.nodeValue || '').trim();
      return t ? escText(collapse(t)) : '';
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (shouldSkip(node)) return '';

    const tag = node.tagName.toLowerCase();

    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const level = parseInt(tag[1], 10);
        const text = inlineOf(node).replace(/\s+#$/, '').trim();
        return '#'.repeat(level) + ' ' + text;
      }

      case 'p':
        return inlineOf(node).trim();

      case 'hr':
        return '---';

      case 'ul':
      case 'ol':
        return listOf(node, tag, ctx);

      case 'blockquote': {
        const inner = childrenToMarkdown(node, ctx).trim();
        return inner.split('\n').map((l) => '> ' + l).join('\n');
      }

      case 'pre': {
        const code = node.textContent || '';
        return '```\n' + code.replace(/\n$/, '') + '\n```';
      }

      case 'table':
        return tableOf(node);

      case 'figure':
      case 'div': {
        if (node.classList.contains('callout')) return calloutOf(node, ctx);
        if (node.classList.contains('table-wrap')) return childrenToMarkdown(node, ctx);
        if (node.classList.contains('doc-status')) return statusRowOf(node);
        if (node.classList.contains('doc-meta')) return childrenToMarkdown(node, ctx);
        if (node.classList.contains('lock-warning')) return '';
        return childrenToMarkdown(node, ctx);
      }

      case 'header':
      case 'section':
      case 'article':
      case 'main':
        return childrenToMarkdown(node, ctx);

      default:
        return childrenToMarkdown(node, ctx);
    }
  };

  const childrenToMarkdown = (node, ctx) => {
    const parts = [];
    for (const child of node.childNodes) {
      const md = blockOf(child, ctx);
      if (md && md.trim()) parts.push(md);
    }
    return parts.join('\n\n');
  };

  // ---- Lists ---------------------------------------------------------------
  const listOf = (ul, kind, ctx) => {
    const depth = (ctx && ctx.listDepth) || 0;
    const indent = '  '.repeat(depth);
    const lines = [];
    let i = 1;
    for (const child of ul.children) {
      if (child.tagName !== 'LI') continue;
      const marker = kind === 'ol' ? (i + '. ') : '- ';
      const item = liToMarkdown(child, { ...ctx, listDepth: depth + 1 });
      const itemLines = item.split('\n');
      lines.push(indent + marker + itemLines[0]);
      // Continuation / nested-list lines get the same indent + 2 spaces of
      // hanging indent so GFM keeps them attached to the same list item.
      for (let j = 1; j < itemLines.length; j++) {
        lines.push(indent + '  ' + itemLines[j]);
      }
      i++;
    }
    return lines.join('\n');
  };

  const liToMarkdown = (li, ctx) => {
    // GFM task list detection: <li><label><input type=checkbox …> Text</label></li>
    const checkbox = li.querySelector(':scope > label > input[type="checkbox"]');
    if (checkbox) {
      const label = li.querySelector(':scope > label');
      const clone = label.cloneNode(true);
      clone.querySelectorAll('input').forEach((i) => i.remove());
      const text = inlineOf(clone).replace(/\s+/g, ' ').trim();
      return (checkbox.checked ? '[x] ' : '[ ] ') + text;
    }

    let main = '';
    const tail = [];
    for (const child of li.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        main += escText(child.nodeValue);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === 'ul' || tag === 'ol') {
        tail.push(blockOf(child, ctx));
      } else if (tag === 'p') {
        if (main.trim()) tail.push(inlineOf(child).trim());
        else main += inlineOf(child);
      } else {
        main += inlineEl(child);
      }
    }
    main = main.replace(/\s+/g, ' ').trim();
    if (!tail.length) return main;
    return main + '\n' + tail.join('\n');
  };

  // ---- Tables --------------------------------------------------------------
  const cellText = (cell) =>
    inlineOf(cell).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim();

  const tableOf = (table) => {
    const lines = [];
    const caption = table.querySelector(':scope > caption');
    if (caption) {
      lines.push('*' + inlineOf(caption).trim() + '*');
      lines.push('');
    }

    let header = [];
    if (table.tHead) {
      const headerRow = table.tHead.rows[0];
      if (headerRow) header = Array.from(headerRow.cells).map(cellText);
    }

    const bodyRows = [];
    for (const tbody of table.tBodies) {
      for (const tr of tbody.rows) {
        bodyRows.push(Array.from(tr.cells).map(cellText));
      }
    }

    // GFM requires a header. If the table didn't have one, fabricate a blank
    // header row from the first body row's column count.
    if (!header.length && bodyRows.length) {
      header = bodyRows[0].map(() => ' ');
    }
    if (!header.length) return '';

    lines.push('| ' + header.join(' | ') + ' |');
    lines.push('| ' + header.map(() => '---').join(' | ') + ' |');
    for (const row of bodyRows) {
      // Pad short rows to header length so the table stays valid.
      while (row.length < header.length) row.push('');
      lines.push('| ' + row.join(' | ') + ' |');
    }
    return lines.join('\n');
  };

  // ---- Callouts ------------------------------------------------------------
  const KIND_FROM_CLASS = {
    'callout--warn':    'WARNING',
    'callout--danger':  'CAUTION',
    'callout--success': 'TIP',
    'callout--neutral': 'NOTE',
  };

  const calloutOf = (div, ctx) => {
    let kind = 'NOTE';
    for (const cls of div.classList) {
      if (KIND_FROM_CLASS[cls]) { kind = KIND_FROM_CLASS[cls]; break; }
    }
    // Inner content lives in the second child div (first is the icon span).
    const content = div.querySelector(':scope > div');
    if (!content) return '> [!' + kind + ']';

    // .callout__title paragraphs render as bold so they read as a heading
    // inside the admonition; everything else uses the normal block pipeline.
    const parts = [];
    for (const child of content.childNodes) {
      if (child.nodeType !== Node.ELEMENT_NODE) {
        const t = (child.nodeValue || '').trim();
        if (t) parts.push(escText(t));
        continue;
      }
      if (child.tagName === 'P' && child.classList.contains('callout__title')) {
        const t = inlineOf(child).trim();
        if (t) parts.push('**' + t + '**');
      } else {
        const md = blockOf(child, ctx);
        if (md && md.trim()) parts.push(md);
      }
    }

    const body = parts.join('\n\n').trim();
    if (!body) return '> [!' + kind + ']';
    const lines = body.split('\n').map((l) => (l ? '> ' + l : '>'));
    return '> [!' + kind + ']\n' + lines.join('\n');
  };

  // ---- Status row in the doc header ---------------------------------------
  const statusRowOf = (ul) => {
    const labels = [];
    for (const li of ul.querySelectorAll('li')) {
      const txt = (li.textContent || '').trim();
      if (txt) labels.push('`[' + txt.toUpperCase() + ']`');
    }
    return labels.join(' ');
  };

  // ---- Top-level entry point -----------------------------------------------
  const buildMarkdown = () => {
    const main = document.getElementById('main');
    if (!main) return '';

    // Walk children of <main> in order; each section becomes its own block.
    const parts = [];
    for (const child of main.children) {
      if (shouldSkip(child)) continue;
      const md = blockOf(child, { listDepth: 0 });
      if (md && md.trim()) parts.push(md);
    }

    // Compose with single blank lines between blocks; collapse runs of blank
    // lines so the output stays tight.
    let out = parts.join('\n\n');
    out = out.replace(/\n{3,}/g, '\n\n').trim();

    const header =
      '<!-- TradeVerse PRD — exported as Markdown ' + new Date().toISOString() +
      ' -->\n\n';
    return header + out + '\n';
  };

  const exportMarkdown = () => {
    if (typeof TVPersistence !== 'undefined' && TVPersistence) {
      try { TVPersistence.saveNow(); } catch { /* noop */ }
    }
    const md = buildMarkdown();
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    TVExport.triggerDownload(blob, 'tradeverse-prd-' + TVExport.today() + '.md');
  };

  TVExport.register('markdown', exportMarkdown);

  // Expose a single-node converter so Phase 6.4 (per-section copy) and any
  // future caller can reuse the same conversion rules without duplicating
  // the walker.
  TVExport.nodeToMarkdown = (node) => {
    if (!node) return '';
    const md = blockOf(node, { listDepth: 0 });
    return (md || '').replace(/\n{3,}/g, '\n\n').trim();
  };
})();

/* -------------------------------------------------------------------------- */
/* Print / Save as PDF (Phase 6.3)                                            */
/* -------------------------------------------------------------------------- */
(function initPrintExport() {
  if (!TVExport) return;

  const printNow = () => {
    // Flush any pending edits so what prints matches what's on screen.
    if (typeof TVPersistence !== 'undefined' && TVPersistence) {
      try { TVPersistence.saveNow(); } catch { /* noop */ }
    }

    // If the user is mid-edit, blur the active editable so the caret/focus
    // ring doesn't flash into the print preview.
    if (document.activeElement && document.activeElement.blur) {
      try { document.activeElement.blur(); } catch { /* noop */ }
    }

    window.print();
  };

  TVExport.register('print', printNow);

  // Keyboard shortcut Cmd/Ctrl+P is already wired by the browser to
  // window.print(); our @media print stylesheet picks it up automatically.
  // No extra binding needed here.
})();

/* -------------------------------------------------------------------------- */
/* Version snapshots (Phase 7.4)                                              */
/*                                                                            */
/*   Manual 'Save version' captures the current text-edit diff into a named  */
/*   snapshot in localStorage; the popover lists snapshots with Restore /    */
/*   Delete actions. Restore applies the snapshot edits in-place via         */
/*   TVPersistence.applyEdits — no reload, TOC labels re-sync, the active    */
/*   storage key updates so the change is durable.                            */
/*                                                                            */
/*   Storage:  tradeverse-prd-versions-v1                                     */
/*   Schema :  { version: 1, snapshots: [{id, label, savedAt, edits}, …] }   */
/*   Capacity: 20 most-recent (older snapshots dropped when limit reached).   */
/* -------------------------------------------------------------------------- */
const TVVersions = (function initVersionSnapshots() {
  if (!TVEditor || !TVPersistence) return null;

  const wrap = document.querySelector('[data-versions-menu]');
  const trigger = document.querySelector('[data-versions-trigger]');
  const popover = document.querySelector('[data-versions-popover]');
  const form = document.querySelector('[data-versions-form]');
  const input = document.querySelector('[data-versions-label-input]');
  const listEl = document.querySelector('[data-versions-list]');
  const emptyEl = document.querySelector('[data-versions-empty]');
  if (!wrap || !trigger || !popover || !form || !input || !listEl || !emptyEl) return null;

  const STORAGE_KEY = 'tradeverse-prd-versions-v1';
  const SCHEMA_VERSION = 1;
  const MAX_VERSIONS = 20;

  // ---- Storage -------------------------------------------------------------
  const load = () => {
    let raw;
    try { raw = localStorage.getItem(STORAGE_KEY); }
    catch { return []; }
    if (!raw) return [];
    try {
      const data = JSON.parse(raw);
      if (!data || data.version !== SCHEMA_VERSION) return [];
      return Array.isArray(data.snapshots) ? data.snapshots : [];
    } catch { return []; }
  };

  const persist = (snapshots) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: SCHEMA_VERSION,
        snapshots,
      }));
      return true;
    } catch { return false; }
  };

  // ---- Time formatting -----------------------------------------------------
  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString(undefined, {
      hour: 'numeric', minute: '2-digit',
    });
    if (sameDay) return 'Today · ' + time;
    const date = d.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
    return date + ' · ' + time;
  };

  // ---- Render -------------------------------------------------------------
  const render = () => {
    const snapshots = load();
    listEl.innerHTML = '';
    emptyEl.hidden = snapshots.length > 0;

    for (const snap of snapshots) {
      const li = document.createElement('li');
      li.className = 'versions-popover__item';
      li.dataset.versionId = snap.id;

      const meta = document.createElement('div');
      meta.className = 'versions-popover__meta';
      const label = document.createElement('span');
      label.className = 'versions-popover__label';
      label.title = snap.label;
      label.textContent = snap.label;
      const time = document.createElement('span');
      time.className = 'versions-popover__time';
      const editCount = snap.edits ? Object.keys(snap.edits).length : 0;
      time.textContent = formatTime(snap.savedAt) + ' · ' + editCount + ' edit' + (editCount === 1 ? '' : 's');
      meta.append(label, time);

      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'versions-popover__action';
      restoreBtn.dataset.versionAction = 'restore';
      restoreBtn.textContent = 'Restore';

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'versions-popover__action versions-popover__action--danger';
      deleteBtn.dataset.versionAction = 'delete';
      deleteBtn.setAttribute('aria-label', 'Delete version: ' + snap.label);
      deleteBtn.textContent = '×';

      li.append(meta, restoreBtn, deleteBtn);
      listEl.appendChild(li);
    }

    // The trigger button is hidden when no versions exist AND no edits exist
    // — surface it the moment either becomes true.
    const hasVersions = snapshots.length > 0;
    const canSave = TVEditor.isEditing() || TVPersistence.hasStoredEdits() || hasVersions;
    wrap.hidden = !canSave;
  };

  // ---- Actions -------------------------------------------------------------
  const create = (label) => {
    // Flush any pending edits so the snapshot reflects what's on screen.
    try { TVPersistence.saveNow(); } catch { /* noop */ }
    const edits = TVPersistence.getCurrentEdits();
    const snapshots = load();
    const snap = {
      id: 'snap-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      label: (label || '').trim() || 'Untitled · ' + new Date().toLocaleString(),
      savedAt: Date.now(),
      edits: edits || {},
    };
    snapshots.unshift(snap);
    while (snapshots.length > MAX_VERSIONS) snapshots.pop();
    if (!persist(snapshots)) {
      window.alert('Could not save version — local storage may be full.');
      return null;
    }
    return snap;
  };

  const restore = (id) => {
    const snapshots = load();
    const snap = snapshots.find((s) => s.id === id);
    if (!snap) return false;
    const editCount = snap.edits ? Object.keys(snap.edits).length : 0;
    const ok = window.confirm(
      'Restore "' + snap.label + '"?\n\n' +
      'This replaces the current text with ' + editCount + ' edit' +
      (editCount === 1 ? '' : 's') + ' from this version. ' +
      'Save the current state first if you want to keep it.'
    );
    if (!ok) return false;
    TVPersistence.applyEdits(snap.edits || {});
    return true;
  };

  const remove = (id) => {
    const snapshots = load();
    const snap = snapshots.find((s) => s.id === id);
    if (!snap) return false;
    const ok = window.confirm('Delete version "' + snap.label + '"? This cannot be undone.');
    if (!ok) return false;
    persist(snapshots.filter((s) => s.id !== id));
    return true;
  };

  // ---- Open / close popover ------------------------------------------------
  const setOpen = (open) => {
    trigger.setAttribute('aria-expanded', String(open));
    popover.hidden = !open;
    if (open) {
      render();
      setTimeout(() => input.focus({ preventScroll: true }), 0);
    }
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(trigger.getAttribute('aria-expanded') !== 'true');
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && trigger.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      trigger.focus();
    }
  });

  // ---- Form submit -> save -------------------------------------------------
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const label = input.value.trim();
    const snap = create(label);
    if (!snap) return;
    input.value = '';
    render();
  });

  // ---- List actions (event-delegated) -------------------------------------
  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-version-action]');
    if (!btn) return;
    const item = btn.closest('[data-version-id]');
    if (!item) return;
    const id = item.dataset.versionId;
    const action = btn.dataset.versionAction;
    if (action === 'restore') {
      if (restore(id)) setOpen(false);
    } else if (action === 'delete') {
      if (remove(id)) render();
    }
  });

  // ---- Show/hide trigger as state changes ---------------------------------
  TVEditor.onChange(render);
  TVPersistence.onChange(render);

  // First paint.
  render();

  return {
    list: load,
    create,
    restore,
    remove,
  };
})();

/* -------------------------------------------------------------------------- */
/* Selection mini-toolbar (Phase 7.3)                                         */
/*                                                                            */
/*   Floating dark popover that appears above any non-empty text selection    */
/*   inside an actively-editable element. Buttons + shortcuts wrap the        */
/*   selection in plain markdown markers (**bold**, *italic*, `code`,         */
/*   [text](url)). Doc stays plaintext — markers are visible inline in the    */
/*   HTML view and rendered correctly by the Phase 6.2 markdown export.       */
/* -------------------------------------------------------------------------- */
(function initSelectionToolbar() {
  if (!TVEditor) return;
  const main = document.getElementById('main');
  if (!main) return;

  const toolbar = document.createElement('div');
  toolbar.className = 'selection-toolbar';
  toolbar.hidden = true;
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Format selection');
  toolbar.innerHTML =
    '<button type="button" class="selection-toolbar__btn selection-toolbar__btn--bold"' +
    '  data-md-action="bold" title="Bold (Cmd/Ctrl+B → wraps in **…**)" aria-label="Bold">B</button>' +
    '<button type="button" class="selection-toolbar__btn selection-toolbar__btn--italic"' +
    '  data-md-action="italic" title="Italic (Cmd/Ctrl+I → wraps in *…*)" aria-label="Italic">I</button>' +
    '<button type="button" class="selection-toolbar__btn selection-toolbar__btn--code"' +
    '  data-md-action="code" title="Inline code (wraps in `…`)" aria-label="Code">&lt;/&gt;</button>' +
    '<span class="selection-toolbar__sep" aria-hidden="true"></span>' +
    '<button type="button" class="selection-toolbar__btn selection-toolbar__btn--link"' +
    '  data-md-action="link" title="Link (Cmd/Ctrl+K → wraps in [text](url))" aria-label="Link">↗</button>';
  document.body.appendChild(toolbar);

  // ---- Position helper -----------------------------------------------------
  const positionAt = (rect) => {
    toolbar.hidden = false;
    toolbar.style.top = '0px';
    toolbar.style.left = '0px';
    const tbHeight = toolbar.offsetHeight || 32;
    const tbWidth = toolbar.offsetWidth || 160;

    let top = rect.top - tbHeight - 6;
    if (top < 8) top = rect.bottom + 6;
    let left = rect.left + (rect.width / 2) - (tbWidth / 2);
    const maxLeft = window.innerWidth - tbWidth - 8;
    if (left > maxLeft) left = maxLeft;
    if (left < 8) left = 8;

    toolbar.style.top = top + 'px';
    toolbar.style.left = left + 'px';
  };

  // ---- Visibility logic ----------------------------------------------------
  const findEditableForSelection = (sel) => {
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    let node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!node) return null;
    const editable = node.closest('.is-editable');
    if (!editable || !main.contains(editable)) return null;
    if (!editable.isContentEditable) return null;
    return editable;
  };

  const refresh = () => {
    if (!TVEditor.isEditing()) { toolbar.hidden = true; return; }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim().length === 0) {
      toolbar.hidden = true;
      return;
    }
    const editable = findEditableForSelection(sel);
    if (!editable) { toolbar.hidden = true; return; }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) { toolbar.hidden = true; return; }
    positionAt(rect);
  };

  document.addEventListener('selectionchange', () => {
    requestAnimationFrame(refresh);
  });
  window.addEventListener('scroll', () => {
    if (!toolbar.hidden) requestAnimationFrame(refresh);
  }, { passive: true, capture: true });
  window.addEventListener('resize', refresh, { passive: true });

  // Block focus shift while clicking the toolbar so the selection survives.
  toolbar.addEventListener('mousedown', (e) => {
    if (e.target.closest('.selection-toolbar__btn')) e.preventDefault();
  });

  // ---- Wrap action ---------------------------------------------------------
  const wrapSelection = (prefix, suffix) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const text = sel.toString();
    if (!text) return;
    const wrapped = prefix + text + suffix;

    // Prefer execCommand for native undo support; fall back to range
    // manipulation if it's been removed by the browser.
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, wrapped);
    } catch { inserted = false; }
    if (!inserted) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(wrapped));
      // Move caret after inserted text.
      sel.removeAllRanges();
      const next = document.createRange();
      next.setStart(range.endContainer, range.endOffset);
      next.collapse(true);
      sel.addRange(next);

      // Trigger persistence input event manually.
      const editable = findEditableForSelection(sel);
      if (editable) editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    }
    toolbar.hidden = true;
  };

  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-md-action]');
    if (!btn) return;
    const action = btn.dataset.mdAction;
    if (action === 'bold')   { wrapSelection('**', '**'); return; }
    if (action === 'italic') { wrapSelection('*', '*'); return; }
    if (action === 'code')   { wrapSelection('`', '`'); return; }
    if (action === 'link') {
      const url = window.prompt('Link URL:', 'https://');
      if (!url) return;
      wrapSelection('[', '](' + url.trim() + ')');
    }
  });

  // ---- Keyboard shortcuts inside editable content -------------------------
  main.addEventListener('keydown', (e) => {
    if (!TVEditor.isEditing()) return;
    const editable = e.target.closest('.is-editable');
    if (!editable || !editable.isContentEditable) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.altKey) return;

    const sel = window.getSelection();
    const hasSel = sel && !sel.isCollapsed && sel.toString().length > 0;

    if (e.key === 'b' || e.key === 'B') {
      if (!hasSel) return;
      e.preventDefault();
      wrapSelection('**', '**');
    } else if (e.key === 'i' || e.key === 'I') {
      if (!hasSel) return;
      e.preventDefault();
      wrapSelection('*', '*');
    } else if (e.key === 'k' || e.key === 'K') {
      if (!hasSel) return;
      e.preventDefault();
      const url = window.prompt('Link URL:', 'https://');
      if (url) wrapSelection('[', '](' + url.trim() + ')');
    }
  });

  TVEditor.onChange((on) => { if (!on) toolbar.hidden = true; });
})();

/* -------------------------------------------------------------------------- */
/* Add new section (Phase 7.2)                                                */
/*                                                                            */
/*   Bottom-of-doc 'Add new section' button (visible only in edit mode)       */
/*   prompts for a title, builds a new <section> with H2 + starter paragraph, */
/*   wires editing affordances + heading anchor + copy button, and hands the  */
/*   section to TVToc so it appears in the sidebar and joins scroll-spy.      */
/*   Section structure is session-only (text persists per cell, but the new   */
/*   section itself disappears on reload); same trade-off as Phase 7.1 rows.  */
/* -------------------------------------------------------------------------- */
(function initAddSection() {
  if (!TVEditor) return;
  const main = document.getElementById('main');
  if (!main) return;

  const supportsPlaintextOnly = (() => {
    const probe = document.createElement('div');
    probe.setAttribute('contenteditable', 'plaintext-only');
    return probe.contentEditable === 'plaintext-only';
  })();
  const editableValue = supportsPlaintextOnly ? 'plaintext-only' : 'true';

  const newId = (prefix) =>
    prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);

  const wireEditable = (el, placeholder) => {
    el.classList.add('is-editable');
    if (!el.dataset.tvId) el.dataset.tvId = newId('gen');
    if (!el.hasAttribute('data-placeholder')) {
      el.setAttribute('data-placeholder', placeholder);
    }
    if (TVEditor.isEditing()) {
      el.setAttribute('contenteditable', editableValue);
      el.setAttribute('spellcheck', 'true');
    }
  };

  const addAnchorLink = (h) => {
    const a = document.createElement('a');
    a.className = 'anchor-link';
    a.href = '#' + h.id;
    a.setAttribute('aria-label', 'Copy link to ' + (h.textContent || '').trim());
    a.setAttribute('contenteditable', 'false');
    a.textContent = '#';
    h.appendChild(a);
  };

  const addCopyButton = (sec) => {
    if (!TVExport || typeof TVExport.nodeToMarkdown !== 'function') return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'section-copy';
    btn.setAttribute('aria-label', 'Copy this section as Markdown');
    btn.dataset.sectionCopy = sec.id;
    btn.innerHTML =
      '<span class="section-copy__icon" aria-hidden="true">⎘</span>' +
      '<span class="section-copy__label">Copy</span>';
    sec.appendChild(btn);
  };

  // ---- Build the trigger ---------------------------------------------------
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'add-section-btn';
  button.setAttribute('data-add-section', 'true');
  button.innerHTML = '<span class="add-section-btn__plus" aria-hidden="true">+</span>Add new section';
  main.appendChild(button);

  button.addEventListener('click', () => {
    const titleRaw = window.prompt(
      'Section title:\n(You can edit this later — unlock structure first.)',
      'New section'
    );
    if (titleRaw === null) return;
    const title = (titleRaw || '').trim() || 'New section';

    const sectionId = newId('sec-custom');
    const headingId = 'h-' + sectionId;

    const section = document.createElement('section');
    section.id = sectionId;
    section.setAttribute('aria-labelledby', headingId);
    section.dataset.tvFresh = 'true';

    const h2 = document.createElement('h2');
    h2.id = headingId;
    h2.textContent = title;

    const p = document.createElement('p');
    p.textContent = '';

    section.append(h2, p);
    main.insertBefore(section, button);

    // Wire affordances. The heading registers .is-editable so the heading-
    // lock toggle treats it consistently with built-in headings.
    wireEditable(h2, 'Section title');
    wireEditable(p, 'Start writing the section…');

    // The paragraph starts empty; mark so the placeholder shows.
    p.dataset.empty = 'true';

    addAnchorLink(h2);
    addCopyButton(section);

    if (typeof TVToc !== 'undefined' && TVToc && TVToc.addSection) {
      TVToc.addSection(section);
    }
    if (typeof TVTocSearch !== 'undefined' && TVTocSearch && TVTocSearch.refresh) {
      TVTocSearch.refresh();
    }

    // Smooth-scroll to the new section and focus the body so the user can
    // start typing immediately. Heading remains locked by default — the
    // 'Unlock structure' toggle in the toolbar is the path to renaming it.
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => {
      try { p.focus({ preventScroll: true }); }
      catch { /* ignore */ }
    }, 250);

    // Drop the freshness marker after the highlight animation finishes.
    setTimeout(() => { delete section.dataset.tvFresh; }, 1800);
  });
})();

/* -------------------------------------------------------------------------- */
/* Add/remove rows in tables (Phase 7.1)                                      */
/*                                                                            */
/*   Floating 3-button toolbar appears above the focused tbody row while in   */
/*   edit mode. Cell text edits persist via Phase 5.1; structural changes     */
/*   (added/removed rows) are session-only — they survive within the page     */
/*   lifetime but not across reloads, since persistence stores text-by-id     */
/*   and the original markup is the source of truth on next load.             */
/* -------------------------------------------------------------------------- */
(function initTableRowEditing() {
  if (!TVEditor) return;
  const main = document.getElementById('main');
  if (!main) return;

  // Build the floating toolbar once and park it on the body.
  const toolbar = document.createElement('div');
  toolbar.className = 'table-row-toolbar';
  toolbar.hidden = true;
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Row actions');
  toolbar.innerHTML =
    '<button type="button" class="table-row-toolbar__btn"' +
    '  data-row-action="insert-above" title="Insert row above (Cmd/Ctrl+Shift+Enter)"' +
    '  aria-label="Insert row above">↑+</button>' +
    '<button type="button" class="table-row-toolbar__btn"' +
    '  data-row-action="insert-below" title="Insert row below (Cmd/Ctrl+Enter at end)"' +
    '  aria-label="Insert row below">+↓</button>' +
    '<span class="table-row-toolbar__sep" aria-hidden="true"></span>' +
    '<button type="button" class="table-row-toolbar__btn table-row-toolbar__btn--danger"' +
    '  data-row-action="delete" title="Delete row" aria-label="Delete row">×</button>';
  document.body.appendChild(toolbar);

  let activeRow = null;

  // ---- Helpers -------------------------------------------------------------
  const isInTbody = (row) =>
    row && row.parentElement && row.parentElement.tagName === 'TBODY';

  const newId = () =>
    'gen-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  const supportsPlaintextOnly = (() => {
    const probe = document.createElement('div');
    probe.setAttribute('contenteditable', 'plaintext-only');
    return probe.contentEditable === 'plaintext-only';
  })();
  const editableValue = supportsPlaintextOnly ? 'plaintext-only' : 'true';

  const wireCell = (cell) => {
    cell.classList.add('is-editable');
    cell.dataset.tvId = newId();
    if (!cell.hasAttribute('data-placeholder')) {
      cell.setAttribute('data-placeholder', '—');
    }
    cell.dataset.empty = 'true';
    if (TVEditor.isEditing()) {
      cell.setAttribute('contenteditable', editableValue);
      cell.setAttribute('spellcheck', 'true');
    }
  };

  const cloneRowStructure = (template) => {
    const newRow = document.createElement('tr');
    for (const cell of template.cells) {
      const fresh = document.createElement(cell.tagName.toLowerCase());
      // Preserve structural attributes (scope on row-headers, inline width).
      if (cell.hasAttribute('scope')) fresh.setAttribute('scope', cell.getAttribute('scope'));
      if (cell.hasAttribute('style')) fresh.setAttribute('style', cell.getAttribute('style'));
      if (cell.hasAttribute('colspan')) fresh.setAttribute('colspan', cell.getAttribute('colspan'));
      wireCell(fresh);
      newRow.appendChild(fresh);
    }
    return newRow;
  };

  const focusFirstCell = (row) => {
    const first = row && row.cells[0];
    if (!first) return;
    first.focus({ preventScroll: false });
    // Place caret inside the empty cell so typing immediately fills it.
    const range = document.createRange();
    range.selectNodeContents(first);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  // ---- Toolbar position ----------------------------------------------------
  const positionToolbar = () => {
    if (!activeRow || !TVEditor.isEditing()) {
      toolbar.hidden = true;
      return;
    }
    if (!document.body.contains(activeRow)) {
      activeRow = null;
      toolbar.hidden = true;
      return;
    }
    const rect = activeRow.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      toolbar.hidden = true;
      return;
    }
    toolbar.hidden = false;
    // Provisional placement so we can measure the toolbar's own size.
    toolbar.style.top = '0px';
    toolbar.style.left = '0px';
    const tbHeight = toolbar.offsetHeight || 30;
    const tbWidth = toolbar.offsetWidth || 100;

    let top = rect.top - tbHeight - 4;
    if (top < 8) top = rect.bottom + 4; // Flip below if not enough space above
    let left = rect.left;
    const maxLeft = window.innerWidth - tbWidth - 8;
    if (left > maxLeft) left = maxLeft;
    if (left < 8) left = 8;

    toolbar.style.top = top + 'px';
    toolbar.style.left = left + 'px';
  };

  const reposition = () => requestAnimationFrame(positionToolbar);

  // ---- Show / hide on focus -----------------------------------------------
  document.addEventListener('focusin', (e) => {
    if (!TVEditor.isEditing()) {
      activeRow = null;
      toolbar.hidden = true;
      return;
    }
    // Keep toolbar up if focus moved INTO it (e.g., via Tab from a cell).
    if (toolbar.contains(e.target)) return;

    const cell = e.target.closest('th, td');
    if (cell && main.contains(cell)) {
      const row = cell.closest('tr');
      if (isInTbody(row)) {
        activeRow = row;
        positionToolbar();
        return;
      }
    }

    // Focus moved somewhere irrelevant — defer hide so a click on the toolbar
    // (which transiently steals focus on some browsers) doesn't kill it.
    setTimeout(() => {
      const ae = document.activeElement;
      if (toolbar.contains(ae)) return;
      const inCell = ae && ae.closest && ae.closest('th, td') && main.contains(ae);
      if (!inCell) {
        activeRow = null;
        toolbar.hidden = true;
      }
    }, 80);
  });

  // Block focus-shift while clicking the toolbar so the active cell stays
  // focused and the row-action handler can rely on `activeRow`.
  toolbar.addEventListener('mousedown', (e) => {
    if (e.target.closest('.table-row-toolbar__btn')) e.preventDefault();
  });

  // ---- Reposition on layout shifts ----------------------------------------
  // Use capture so .table-wrap horizontal scrolling and inner scrolls also fire.
  window.addEventListener('scroll', reposition, { passive: true, capture: true });
  window.addEventListener('resize', reposition, { passive: true });

  // ---- Actions -------------------------------------------------------------
  const insertAbove = () => {
    if (!activeRow) return;
    const fresh = cloneRowStructure(activeRow);
    activeRow.parentElement.insertBefore(fresh, activeRow);
    activeRow = fresh;
    focusFirstCell(fresh);
    reposition();
  };

  const insertBelow = () => {
    if (!activeRow) return;
    const fresh = cloneRowStructure(activeRow);
    activeRow.parentElement.insertBefore(fresh, activeRow.nextSibling);
    activeRow = fresh;
    focusFirstCell(fresh);
    reposition();
  };

  const deleteRow = () => {
    if (!activeRow) return;
    const tbody = activeRow.parentElement;
    const isOnlyRow = tbody.rows.length === 1;
    const hasContent = activeRow.textContent.trim().length > 0;

    if (isOnlyRow) {
      window.alert('Cannot delete the only row in a table.');
      return;
    }
    if (hasContent) {
      const ok = window.confirm('Delete this row? Its content will be lost.');
      if (!ok) return;
    }

    // Pick a neighbor to focus after removal.
    const next = activeRow.nextElementSibling || activeRow.previousElementSibling;
    activeRow.remove();
    if (next && next.cells[0]) {
      activeRow = next;
      next.cells[0].focus();
    } else {
      activeRow = null;
    }
    reposition();
  };

  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-row-action]');
    if (!btn) return;
    const action = btn.dataset.rowAction;
    if (action === 'insert-above') insertAbove();
    else if (action === 'insert-below') insertBelow();
    else if (action === 'delete') deleteRow();
  });

  // ---- Keyboard shortcuts inside cells ------------------------------------
  main.addEventListener('keydown', (e) => {
    if (!TVEditor.isEditing()) return;
    const cell = e.target.closest('td, th');
    if (!cell || !main.contains(cell)) return;
    const row = cell.closest('tr');
    if (!isInTbody(row)) return;

    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    if (e.key === 'Enter') {
      // Cmd/Ctrl + Enter      → insert row below
      // Cmd/Ctrl + Shift+Enter → insert row above
      e.preventDefault();
      activeRow = row;
      if (e.shiftKey) insertAbove();
      else insertBelow();
    } else if (e.key === 'Backspace' && e.shiftKey) {
      // Cmd/Ctrl + Shift + Backspace → delete row (avoid clashing with
      // the browser's "delete word" Cmd+Backspace shortcut).
      e.preventDefault();
      activeRow = row;
      deleteRow();
    }
  });

  // ---- Cleanup on edit-mode exit ------------------------------------------
  TVEditor.onChange((on) => {
    if (!on) {
      activeRow = null;
      toolbar.hidden = true;
    }
  });
})();

/* -------------------------------------------------------------------------- */
/* Per-section copy button (Phase 6.4)                                        */
/* -------------------------------------------------------------------------- */
(function initSectionCopy() {
  if (!TVExport || typeof TVExport.nodeToMarkdown !== 'function') return;
  const main = document.getElementById('main');
  if (!main) return;

  const sections = main.querySelectorAll(':scope > section[id]');
  if (!sections.length) return;

  for (const sec of sections) {
    if (sec.querySelector(':scope > .section-copy')) continue; // idempotent
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'section-copy';
    btn.setAttribute('aria-label', 'Copy this section as Markdown');
    btn.dataset.sectionCopy = sec.id;
    btn.innerHTML =
      '<span class="section-copy__icon" aria-hidden="true">⎘</span>' +
      '<span class="section-copy__label">Copy</span>';
    sec.appendChild(btn);
  }

  const setState = (btn, state, label) => {
    btn.dataset.state = state;
    const labelEl = btn.querySelector('.section-copy__label');
    if (labelEl) labelEl.textContent = label;
    if (state === 'copied' || state === 'error') {
      // Snap back to default after 1.4s.
      clearTimeout(btn.__tvResetTimer);
      btn.__tvResetTimer = setTimeout(() => {
        delete btn.dataset.state;
        if (labelEl) labelEl.textContent = 'Copy';
      }, 1400);
    }
  };

  const copy = async (markdown) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(markdown);
      return true;
    }
    // Legacy fallback for old / locked-down browsers.
    const ta = document.createElement('textarea');
    ta.value = markdown;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
    if (!ok) throw new Error('Clipboard unavailable');
    return true;
  };

  main.addEventListener('click', async (e) => {
    const btn = e.target.closest('.section-copy');
    if (!btn) return;
    e.preventDefault();
    const sec = btn.closest('section[id]');
    if (!sec) return;

    // Flush pending edits so the copied content matches what's on screen.
    if (typeof TVPersistence !== 'undefined' && TVPersistence) {
      try { TVPersistence.saveNow(); } catch { /* noop */ }
    }

    let markdown = '';
    try {
      // Clone so we can strip the copy button itself before serializing.
      const clone = sec.cloneNode(true);
      clone.querySelectorAll('.section-copy').forEach((n) => n.remove());
      markdown = TVExport.nodeToMarkdown(clone);
    } catch (err) {
      console.error('Section serialization failed:', err);
    }

    if (!markdown) {
      setState(btn, 'error', 'Empty');
      return;
    }

    try {
      await copy(markdown);
      setState(btn, 'copied', 'Copied');
    } catch (err) {
      console.error('Clipboard write failed:', err);
      setState(btn, 'error', 'Failed');
    }
  });
})();

/* -------------------------------------------------------------------------- */
/* Unload guard: flush + warn if data is at risk (Phase 5.4)                  */
/* -------------------------------------------------------------------------- */
(function initUnloadGuard() {
  if (!TVPersistence) return;

  let armed = true;

  // Reset (Phase 5.3) calls this so the explicit user-initiated reload isn't
  // double-prompted. Re-arms on the next tick in case Reset bails out.
  window.__tvSkipUnloadGuard = () => {
    armed = false;
    setTimeout(() => { armed = true; }, 1500);
  };

  const flushAndCheck = () => {
    // Try to flush any pending debounced save synchronously. localStorage
    // writes are sync, so this is genuinely 'last chance' protection.
    try { TVPersistence.saveNow(); } catch { /* fall through */ }
    return TVPersistence.isDirty();
  };

  // Modern beforeunload: assigning returnValue (or returning a string)
  // triggers the browser's native confirmation dialog. The custom string
  // is ignored by Chrome/Firefox — they show their own message — but we
  // still set one for older browsers and accessibility tooling.
  window.addEventListener('beforeunload', (e) => {
    if (!armed) return undefined;
    if (!flushAndCheck()) return undefined;
    const msg = 'You have unsaved changes that could not be auto-saved (storage may be full or blocked). Leave anyway?';
    e.preventDefault();
    e.returnValue = msg;
    return msg;
  });

  // Belt-and-braces flush on page hide too (covers iOS Safari which may
  // skip beforeunload on tab close / app switch).
  window.addEventListener('pagehide', () => {
    if (!armed) return;
    try { TVPersistence.saveNow(); } catch { /* noop */ }
  });

  // Also flush when the tab loses visibility — by the time the user
  // returns, their edits are guaranteed to be persisted.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      try { TVPersistence.saveNow(); } catch { /* noop */ }
    }
  });
})();

/* -------------------------------------------------------------------------- */
/* Reset to original (hard reset) (Phase 5.3)                                 */
/* -------------------------------------------------------------------------- */
(function initReset() {
  if (!TVPersistence) return;
  const btn = document.querySelector('[data-reset-button]');
  if (!btn) return;

  const refreshVisibility = () => {
    btn.hidden = !TVPersistence.hasStoredEdits();
  };

  refreshVisibility();
  TVPersistence.onChange(refreshVisibility);

  btn.addEventListener('click', () => {
    const ok = window.confirm(
      'Discard all your edits and reload the original document?\n\n' +
      'This wipes every local change you have made and cannot be undone.'
    );
    if (!ok) return;

    // Disarm the beforeunload guard installed by Phase 5.4 — we want the
    // reload to proceed without prompting again.
    if (window.__tvSkipUnloadGuard) window.__tvSkipUnloadGuard();

    try { TVPersistence.clear(); } catch { /* fall through and force reload */ }

    // Hard reset: reload from network (bypassing any in-memory mutations)
    // by appending a cache-busting query the browser ignores on same-doc.
    const url = new URL(window.location.href);
    url.hash = ''; // Don't snap-scroll into the previously-viewed section.
    window.location.replace(url.toString());
  });
})();

/* -------------------------------------------------------------------------- */
/* "Last saved" status indicator (Phase 5.2)                                  */
/* -------------------------------------------------------------------------- */
(function initSaveStatus() {
  if (!TVPersistence || !TVEditor) return;
  const el = document.querySelector('[data-save-status]');
  const text = document.querySelector('[data-save-status-text]');
  if (!el || !text) return;

  const formatRelative = (ts) => {
    if (!ts) return null;
    const diff = Math.max(0, Date.now() - ts);
    const sec = Math.floor(diff / 1000);
    if (sec < 5)        return 'just now';
    if (sec < 60)       return sec + 's ago';
    const min = Math.floor(sec / 60);
    if (min < 60)       return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24)        return hr + 'h ago';
    const day = Math.floor(hr / 24);
    return day + 'd ago';
  };

  let mode = 'idle'; // idle | dirty | saving | saved | error
  let savedAt = TVPersistence.lastSavedAt();
  let liveTimer = null;

  const stopLiveTimer = () => {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  };

  const render = () => {
    const editing = TVEditor.isEditing();
    const stored = TVPersistence.hasStoredEdits();

    // Visibility: show whenever there's something meaningful to say.
    const show = editing || stored || mode === 'error';
    el.hidden = !show;
    if (!show) return;

    let label;
    let state;
    switch (mode) {
      case 'dirty':
        label = 'Unsaved changes…';
        state = 'dirty';
        break;
      case 'saving':
        label = 'Saving…';
        state = 'saving';
        break;
      case 'error':
        label = 'Save failed — try again';
        state = 'error';
        break;
      case 'saved':
        if (stored && savedAt) {
          label = 'Saved · ' + formatRelative(savedAt);
        } else {
          label = 'Up to date';
        }
        state = 'saved';
        break;
      case 'idle':
      default:
        if (stored && savedAt) {
          label = 'Saved · ' + formatRelative(savedAt);
          state = 'saved';
        } else {
          label = 'Up to date';
          state = 'saved';
        }
        break;
    }
    text.textContent = label;
    el.dataset.state = state;
  };

  const startLiveTimer = () => {
    stopLiveTimer();
    if (!savedAt) return;
    // Update relative time every 5s so 'just now' → 'Xs ago' looks alive.
    liveTimer = setInterval(render, 5000);
  };

  TVPersistence.onChange((event) => {
    if (event.type === 'dirty') {
      mode = 'dirty';
      stopLiveTimer();
    } else if (event.type === 'saved') {
      savedAt = event.savedAt;
      mode = event.cleared ? 'idle' : 'saved';
      if (event.cleared) stopLiveTimer();
      else startLiveTimer();
    } else if (event.type === 'error') {
      mode = 'error';
      stopLiveTimer();
    }
    render();
  });

  TVEditor.onChange(() => render());

  // Initial paint and live timer if we restored prior edits.
  render();
  if (savedAt) startLiveTimer();
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
    a.setAttribute('contenteditable', 'false'); // Survive heading-unlock (Phase 4.5)
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
const TVToc = (function initTOC() {
  const list = document.querySelector('[data-toc-list]');
  const main = document.getElementById('main');
  if (!list || !main) return null;

  const linkBySectionId = new Map();
  const numRe = /^\s*(\d+(?:\.\d+)*)[.\s]+(.*)$/;

  // initHeadingAnchors runs before us and appends <a class="anchor-link">#</a>
  // to every heading. Strip those so they don't leak into TOC labels.
  const labelOf = (h) => {
    const clone = h.cloneNode(true);
    clone.querySelectorAll('.anchor-link').forEach((n) => n.remove());
    return (clone.textContent || '').trim().replace(/\s+/g, ' ');
  };

  // Build a single TOC entry from a section. Returns the link element
  // so the caller can wire it into scroll-spy.
  const buildEntry = (sec) => {
    const h2 = sec.querySelector(':scope > h2');
    if (!h2) return null;
    const raw = labelOf(h2);
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
    return { li, a };
  };

  // Pull every top-level <section> with an id, and use its first H2 as label.
  const sections = Array.from(main.querySelectorAll('section[id]')).filter((s) => {
    return s.querySelector(':scope > h2');
  });
  if (!sections.length) return null;

  for (const sec of sections) {
    const built = buildEntry(sec);
    if (!built) continue;
    list.append(built.li);
    linkBySectionId.set(sec.id, built.a);
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

  // ---- Public API for runtime additions (Phase 7.2) -----------------------
  return {
    addSection: (sec) => {
      if (!sec || !sec.id) return null;
      if (linkBySectionId.has(sec.id)) return linkBySectionId.get(sec.id);
      const built = buildEntry(sec);
      if (!built) return null;
      list.append(built.li);
      linkBySectionId.set(sec.id, built.a);
      io.observe(sec);
      return built.a;
    },
    removeSection: (secId) => {
      const link = linkBySectionId.get(secId);
      if (!link) return;
      const li = link.closest('.toc__item');
      if (li) li.remove();
      linkBySectionId.delete(secId);
      const sec = document.getElementById(secId);
      if (sec) io.unobserve(sec);
    },
    /** Re-read the H2 text into the TOC link (useful after a heading edit). */
    relabel: (secId) => {
      const link = linkBySectionId.get(secId);
      const sec = document.getElementById(secId);
      if (!link || !sec) return;
      const h2 = sec.querySelector(':scope > h2');
      if (!h2) return;
      const raw = labelOf(h2);
      const match = raw.match(numRe);
      const num = match ? match[1] : '';
      const text = match ? match[2] : raw;
      const numEl = link.querySelector('.toc__num');
      const textEl = link.querySelector('.toc__text');
      if (numEl) numEl.textContent = num;
      if (textEl) textEl.textContent = text;
    },
  };
})();

/* -------------------------------------------------------------------------- */
/* TOC search/filter (Phase 3.3)                                              */
/* -------------------------------------------------------------------------- */
const TVTocSearch = (function initTOCSearch() {
  const input = document.querySelector('[data-toc-search]');
  const clear = document.querySelector('[data-toc-search-clear]');
  const empty = document.querySelector('[data-toc-empty]');
  const list = document.querySelector('[data-toc-list]');
  if (!input || !clear || !empty || !list) return null;

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

  // ---- Public API -----------------------------------------------------------
  return {
    /** Re-read the TOC entries (call after sections are added/removed). */
    refresh: () => {
      entries = snapshot();
      apply(input.value);
    },
  };
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
