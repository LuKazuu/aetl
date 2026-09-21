// AETL - SHA-256 + FNV-1a hashing helpers
'use strict';

const _HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const _HTML_ESCAPE_RE = /[&<>"']/g;

const { stripNewlines, isPlainObject, escapeHtml, humanBytes, validDataKey, sanitizeName } = AETL.util;
const esc = escapeHtml;

const PLUGIN_VERSION = 1;
const MANIFEST_FILE = 'manifest.json';
const ENTRY_FILE = 'plugin.js';
const SETTING_SCOPES = ['global', 'project'];
const BUILTIN_EXTENSIONS = new Set(['.json', '.epub']);

const PLUGIN_CFG = {
  bytes: { KB: 1024, MB: 1048576, GB: 1073741824 },
  zip: { tail: 65557, bombFloor: 256 * 1024 * 1024, bombRatio: 400 },
  panel: { defaultHeight: 300 },
  manifest: {
    idMax: 64, nameMax: 120, versionMax: 32, authorMax: 120, descriptionMax: 600,
    magicHexMax: 256, magicTextMaxBytes: 128, magicOffsetMax: 8192,
    uiHeightMin: 60, uiHeightMax: 2000, uiHeightDefault: 300,
  },
  settings: { labelMax: 200, descMax: 600, placeholderMax: 400, optionValueMax: 400 },
  delay: { revokeUrlMs: 10000 },
};

function clampInt(v, min, max, def) {
  v = Number(v);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

const Sha256 = (() => {
  const HEX_CHARS = '0123456789abcdef';
  return {
    async hex(bytes) {
      if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes || []);
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      const u8 = new Uint8Array(hash);
      let out = '';
      for (let i = 0; i < u8.length; i++) {
        const b = u8[i];
        out += HEX_CHARS[(b >>> 4) & 0xf] + HEX_CHARS[b & 0xf];
      }
      return out;
    }
  };
})();

async function sha256HexOfBlob(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  return Sha256.hex(buf);
}
