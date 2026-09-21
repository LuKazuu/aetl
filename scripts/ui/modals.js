// AETL - Modal & dropdown helpers
'use strict';

// Cached open-modals set for O(1) anyModalOpen()/topModal().
const _openModals = new Set();

function positionDropdown(panelId) {
  const trigger = els[DROPDOWNS.find(d => d.panel === panelId).trigger];
  const dropdown = els[panelId];
  const r = trigger.getBoundingClientRect();
  if (dropdown.classList.contains('dropdown-right')) {
    dropdown.style.left = '';
    dropdown.style.right = `${Math.round(window.innerWidth - r.right)}px`;
  } else {
    dropdown.style.right = '';
    dropdown.style.left = `${Math.round(r.left)}px`;
  }
  dropdown.style.top = `${Math.round(r.bottom + 4)}px`;
}

function closeDropdowns() {
  for (const { panel } of DROPDOWNS) els[panel].classList.remove('show');
}

function toggleModal(el, show) {
  if (!el) return;
  const willOpen = !!show;
  // No-op if state already matches — avoids restarting the transition.
  if (willOpen === el.classList.contains('open')) return;
  el.classList.toggle('open', willOpen);
  if (willOpen) {
    _openModals.add(el);
  } else {
    _openModals.delete(el);
  }
}

function anyModalOpen() {
  return _openModals.size > 0;
}

function topModal() {
  if (!_openModals.size) return null;
  let best = null, bestZ = -1;
  for (const el of _openModals) {
    const z = parseInt(getComputedStyle(el).zIndex) || 0;
    if (z > bestZ) { bestZ = z; best = el; }
  }
  return best;
}

// Sync cache when any .open class is toggled on a .backdrop element.
if (typeof MutationObserver !== 'undefined') {
  const _mo = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.attributeName !== 'class') continue;
      const el = m.target;
      if (!(el instanceof Element) || !el.classList.contains('backdrop')) continue;
      if (el.classList.contains('open')) _openModals.add(el);
      else _openModals.delete(el);
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    _mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
}
