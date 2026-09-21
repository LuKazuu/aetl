// AETL - Shared utility helpers
'use strict';

// escapeHtml etc. are destructured from AETL.util in plugins/sha256.js.

const $ = id => document.getElementById(id);
const baseName = p => String(p || '').replace(/\\/g, '/').split('/').pop();
const fileExt = name => { const bn = baseName(name); const i = bn.lastIndexOf('.'); return i > 0 ? bn.slice(i).toLowerCase() : ''; };

const _NEWLINE_RE = /\r?\n/g;
const _JSON_EXT_SUFFIX_RE = /\.(?:json|xhtml|html)$/i;
const _JSON_EXT_SUFFIX_GLOBAL_RE = /\.(?:xhtml|html|json)$/g;
const readHead = async (file, n = 512) => new Uint8Array(await file.slice(0, n).arrayBuffer());
const countFiles = files => (Array.isArray(files) ? files : []).length;
const isTrans = l => !!l.is_translated;
const makeId = () => Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
const makeProjId = () => 'proj_' + makeId();
const MEDIA_EPUB = 'book.epub';
const makeMediaName = (origName) => {
  const base = baseName(origName || 'image');
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : '.bin';
  return `${stem}_${makeId()}${ext}`;
};
const schemaDefault = f => (f.def && typeof f.def === 'object') ? structuredClone(f.def) : f.def;
const snapshot = () => ({ lines: State.lines.map(l => ({ ...l })), selected: new Set(State.selected) });
const historyCap = () => Math.max(CFG.historyMin, Math.min(CFG.historyMax, Math.floor(CFG.historyLineBudget / Math.max(1, State.lines.length))));
const trimHistory = stack => { const cap = historyCap(); while (stack.length > cap) stack.shift(); };
function pushHistory() {
  State.undoStack.push(snapshot());
  trimHistory(State.undoStack);
  State.redoStack = [];
}
const assertJsZip = () => { if (typeof JSZip === 'undefined') throw new Error('JSZip is not available.'); };
const yieldToEvent = () => new Promise(r => setTimeout(r, 0));
