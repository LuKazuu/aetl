// AETL - Shared utility helpers (escape, sanitize, etc.)
'use strict';

AETL.util = {
  stripNewlines(v) {
    return v == null ? null : String(v).replace(/\r?\n/g, '\\n').trim();
  },
  isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); },
  escapeHtml(s) {
    s = String(s ?? '');
    if (!s) return s;
    if (s.indexOf('&') === -1 && s.indexOf('<') === -1 && s.indexOf('>') === -1 &&
        s.indexOf('"') === -1 && s.indexOf("'") === -1) return s;
    return s.replace(_HTML_ESCAPE_RE, c => _HTML_ESCAPES[c]);
  },
  sanitizeName(s, { maxLen = 200, stripTrailing = true, fallback = 'untitled' } = {}) {
    let n = String(s ?? '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
    if (stripTrailing) n = n.replace(/[.\s]+$/, '');
    if (maxLen) n = n.slice(0, maxLen);
    return n || fallback;
  },
  humanBytes(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return '0 B';
    const { KB, MB, GB } = PLUGIN_CFG.bytes;
    if (v < KB) return v + ' B';
    if (v < MB) return (v / KB).toFixed(1) + ' KB';
    if (v < GB) return (v / MB).toFixed(2) + ' MB';
    return (v / GB).toFixed(2) + ' GB';
  },
  validDataKey(key) {
    if (typeof key !== 'string' || !key || key.length > 255) return false;
    if (key.includes('/') || key.includes('\\') || key === '.' || key === '..') return false;
    if (/[\x00-\x1f]/.test(key)) return false;
    if (key.endsWith('.tmp')) return false;
    return true;
  }
};
