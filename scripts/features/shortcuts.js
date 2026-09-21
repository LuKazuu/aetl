// AETL - Keyboard shortcuts system
'use strict';

const SHORTCUT_ACTIONS = [
  { id: 'dash.new', label: 'Create New Project', scope: 'dashboard', def: '', run: () => els.btnNewProject.click() },
  { id: 'dash.restore', label: 'Restore Project', scope: 'dashboard', def: '', run: () => els.btnRestoreProject.click() },
  { id: 'dash.settings', label: 'Open Main Settings', scope: 'dashboard', def: '', run: () => els.btnDashboardSettings.click() },
  { id: 'dash.search', label: 'Focus Project Search', scope: 'dashboard', def: '/', run: () => els.projectSearch.focus() },
  { id: 'work.importFile', label: 'Import File', scope: 'workspace', def: '', run: () => { closeDropdowns(); els.importFileInput.click(); } },
  { id: 'work.importFolder', label: 'Import Folder', scope: 'workspace', def: '', run: () => { closeDropdowns(); els.importFolderInput.click(); } },
  { id: 'work.importZip', label: 'Import ZIP', scope: 'workspace', def: '', run: () => { closeDropdowns(); els.importZipInput.click(); } },
  { id: 'work.export', label: 'Export Project', scope: 'workspace', def: 'Alt+E', run: () => Exporter.run() },
  { id: 'work.proofread', label: 'Open Find & Replace', scope: 'workspace', def: 'Alt+R', run: () => els.btnProofread.click() },
  { id: 'work.glossary', label: 'Open Glossary', scope: 'workspace', def: 'Alt+G', run: () => els.btnGlossary.click() },
  { id: 'work.context', label: 'Open Context', scope: 'workspace', def: 'Alt+X', run: () => els.btnContext.click() },
  { id: 'work.settings', label: 'Open Project Settings', scope: 'workspace', def: 'Alt+S', run: () => els.btnSettings.click() },
  { id: 'work.toggleToolbar', label: 'Show/Hide Toolbar', scope: 'workspace', def: 'Alt+T', run: () => els.btnToggleHeader.click() },
  { id: 'work.immersive', label: 'Open Immersive Mode', scope: 'workspace', def: 'Alt+I', run: () => Immersive.open() },
  { id: 'work.back', label: 'Back to Dashboard', scope: 'workspace', def: 'Alt+B', run: () => App.closeProject() },
  { id: 'work.selectAll', label: 'Select All Lines', scope: 'workspace', def: 'Alt+A', run: () => els.btnSelectAll.click() },
  { id: 'work.clearSelection', label: 'Clear Selection', scope: 'workspace', def: 'Alt+Q', run: () => els.btnClearSelection.click() },
  { id: 'work.selectRange', label: 'Select Line Range', scope: 'workspace', def: 'Alt+L', run: () => App.selectRange() },
  { id: 'work.copy', label: 'Copy for AI', scope: 'workspace', def: 'Alt+C', run: () => App.copyForAi() },
  { id: 'work.paste', label: 'Focus AI Result Column', scope: 'workspace', def: 'Alt+V', inInputs: true, run: () => els.pasteArea.focus() },
  { id: 'work.apply', label: 'Apply Translation', scope: 'workspace', def: 'Ctrl+Enter', inInputs: true, run: () => App.applyTranslation() },
  { id: 'work.undo', label: 'Undo', scope: 'workspace', def: 'Alt+Z', run: () => App.undo() },
  { id: 'work.redo', label: 'Redo', scope: 'workspace', def: 'Alt+Y', run: () => App.redo() },
  { id: 'work.bookmarks', label: 'Open Bookmark Panel', scope: 'workspace', def: 'Alt+M', run: () => App.toggleBookmarkPanel(!els.bookmarkPanel.classList.contains('show')) }
];

const IGNORED_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified', 'ContextMenu', 'Fn', 'FnLock', 'NumLock', 'ScrollLock', 'Hyper', 'Super', 'Compose', 'Process']);

const CODE_MAP = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Escape', Backspace: 'Backspace',
  Delete: 'Delete', Tab: 'Tab', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert',
  Slash: '/', Period: '.', Comma: ',', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
  NumpadDivide: '/', NumpadMultiply: '*', NumpadSubtract: '-', NumpadAdd: '+', NumpadDecimal: '.'
};

const _KEY_CODE_RE = /^(?:Key([A-Z])|Digit(\d))$/;
const _FN_KEY_RE = /^F\d{1,2}$/;

function normalizeKey(e) {
  if (IGNORED_KEYS.has(e.key)) return null;
  const code = e.code || '';
  const m = _KEY_CODE_RE.exec(code);
  if (m) return m[1] || m[2];
  if (CODE_MAP[code]) return CODE_MAP[code];
  if (_FN_KEY_RE.test(code)) return code;
  const k = e.key || '';
  if (k.length === 1) return k.toUpperCase();
  return null;
}

function comboFromEvent(e) {
  const key = normalizeKey(e);
  if (!key) return null;
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

function comboHtml(combo) {
  return combo.split('+').map(p => `<kbd>${escapeHtml(p)}</kbd>`).join('<span class="kbd-plus">+</span>');
}

function isEditableTarget(t) {
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

const Shortcuts = {
  _actions: [],
  _map: new Map(),
  _recording: null,
  _bindings: {},

  async init() {
    Shortcuts._actions = SHORTCUT_ACTIONS.slice();
    document.addEventListener('keydown', e => Shortcuts._onKey(e));
    const raw = await Storage.readShortcuts();
    const b = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    for (const k of Object.keys(b)) {
      if (typeof b[k] === 'string' && b[k]) Shortcuts._bindings[k] = b[k];
    }
    Shortcuts.rebuild();
  },

  allActions() { return Shortcuts._actions; },

  loadBindings() { return Shortcuts._bindings; },

  saveBindings(b) {
    Shortcuts._bindings = (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
    if (Object.keys(Shortcuts._bindings).length) {
      Storage.writeShortcuts(Shortcuts._bindings).catch(e => console.error('[shortcuts] save failed:', e));
    } else {
      Storage.removeShortcuts().catch(e => console.error('[shortcuts] remove failed:', e));
    }
  },

  resetBindings() {
    Shortcuts._bindings = {};
    Storage.removeShortcuts().catch(e => console.error('[shortcuts] reset failed:', e));
    Shortcuts.rebuild();
  },

  bindingFor(action) {
    const b = Shortcuts._bindings;
    return action.id in b ? b[action.id] : (action.def || '');
  },

  rebuild() {
    Shortcuts._map = new Map();
    const b = Shortcuts.loadBindings();
    for (const a of Shortcuts.allActions()) {
      const combo = a.id in b ? b[a.id] : (a.def || '');
      if (combo && !Shortcuts._map.has(combo)) Shortcuts._map.set(combo, a.id);
    }
  },

  _onKey(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (Shortcuts._recording) return;
    if (anyModalOpen()) return;
    if (els.busyOverlay.classList.contains('open')) return;
    const combo = comboFromEvent(e);
    if (!combo) return;
    const actionId = Shortcuts._map.get(combo);
    if (actionId) {
      const action = Shortcuts.allActions().find(a => a.id === actionId);
      if (!action) return;
      if (isEditableTarget(e.target) && !action.inInputs) return;
      const dashOpen = els.dashboardView.classList.contains('open');
      if (action.scope === 'dashboard' && !dashOpen) return;
      if (action.scope === 'workspace' && dashOpen) return;
      e.preventDefault();
      try { action.run(); } catch (err) { console.error('[shortcut]', actionId, err); }
      return;
    }
    if (window.AETL?.plugins) {
      for (const ps of AETL.plugins.listPluginShortcuts()) {
        if (ps.combo && ps.combo === combo) {
          if (isEditableTarget(e.target) && !ps.opts.inInputs) return;
          const dashOpen = els.dashboardView.classList.contains('open');
          const scope = ps.opts.scope || 'workspace';
          if (scope === 'dashboard' && !dashOpen) continue;
          if (scope === 'workspace' && dashOpen) continue;
          e.preventDefault();
          try { ps.handler(); } catch (err) { console.error('[plugin shortcut]', ps.id, err); }
          return;
        }
      }
    }
  },

  startRecording(action, btn) {
    if (Shortcuts._recording) Shortcuts.stopRecording();
    Shortcuts._recording = { action, btn };
    btn.classList.add('recording');
    btn.textContent = 'Press a key…';
    document.addEventListener('keydown', Shortcuts._handleRecordKey, true);
  },

  stopRecording() {
    if (!Shortcuts._recording) return;
    document.removeEventListener('keydown', Shortcuts._handleRecordKey, true);
    Shortcuts._recording = null;
    App.renderShortcutList();
  },

  _handleRecordKey(e) {
    const rec = Shortcuts._recording;
    if (!rec) return;
    if (!els.shortcutModal.classList.contains('open')) { Shortcuts.stopRecording(); return; }
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { Shortcuts.stopRecording(); return; }
    if (e.key === 'Backspace') { Shortcuts.applyBinding(rec.action, ''); return; }
    const combo = comboFromEvent(e);
    if (!combo) return;
    Shortcuts.applyBinding(rec.action, combo);
  },

  applyBinding(action, combo) {
    Shortcuts.stopRecording();
    if (combo) {
      const owner = Shortcuts.allActions().find(a => a.id !== action.id && Shortcuts.bindingFor(a) === combo);
      if (owner) {
        Shortcuts.showStatus(`"${combo.replace(/\+/g, ' + ')}" is already in use: ${owner.label}`, true);
        return;
      }
    }
    const b = Shortcuts.loadBindings();
    if (combo) b[action.id] = combo; else delete b[action.id];
    Shortcuts.saveBindings(b);
    Shortcuts.rebuild();
    App.renderShortcutList();
    Shortcuts.showStatus(combo ? `Binding saved: ${combo.replace(/\+/g, ' + ')}.` : 'Binding deleted.');
  },

  showStatus(msg, isError = false) {
    const el = els.shortcutStatus;
    if (!el) return;
    clearTimeout(Shortcuts._statusTimer);
    el.textContent = msg;
    el.hidden = false;
    el.classList.toggle('error', isError);
    Shortcuts._statusTimer = setTimeout(() => {
      el.hidden = true;
      el.classList.remove('error');
    }, CFG.toastTimeoutMs);
  }
};
