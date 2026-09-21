// AETL - Plugin manifest parser & validator
'use strict';

const Manifest = {
  parse(text) {
    let raw;
    try { raw = JSON.parse(text); }
    catch (e) {
      const msg = String(e?.message || e);
      return { ok: false, errors: [`manifest.json isn't valid JSON: ${msg}`] };
    }
    if (!isPlainObject(raw)) {
      return { ok: false, errors: ['manifest.json must contain a JSON object ( { ... } ).'] };
    }
    return { ok: true, data: raw };
  },

  validate(m) {
    const errors = [];
    if (!isPlainObject(m)) return ['manifest must be an object.'];

    if (m.manifest_version === undefined) {
      errors.push(`"manifest_version" required, integer (current: ${PLUGIN_VERSION}).`);
    } else if (typeof m.manifest_version !== 'number' || !Number.isInteger(m.manifest_version) || m.manifest_version < 1) {
      errors.push(`"manifest_version" must be a positive integer.`);
    } else if (m.manifest_version > PLUGIN_VERSION) {
      errors.push(`"manifest_version" ${m.manifest_version} is newer than this build supports (max: ${PLUGIN_VERSION}). Update AETL to use this plugin.`);
    }

    const idRe = new RegExp(`^[a-z0-9][a-z0-9_-]{0,${PLUGIN_CFG.manifest.idMax - 1}}$`);
    if (typeof m.id !== 'string' || !idRe.test(m.id)) {
      errors.push(`"id" required: lowercase letters/numbers/underscore/hyphen, 1-${PLUGIN_CFG.manifest.idMax} chars, starting with alphanumeric (e.g. "my-plugin").`);
    }
    if (typeof m.name !== 'string' || !m.name.trim() || m.name.trim().length > PLUGIN_CFG.manifest.nameMax) {
      errors.push(`"name" required, 1-${PLUGIN_CFG.manifest.nameMax} characters.`);
    }
    if (typeof m.version !== 'string' || !m.version.trim() || m.version.trim().length > PLUGIN_CFG.manifest.versionMax) {
      errors.push(`"version" required, 1-${PLUGIN_CFG.manifest.versionMax} characters (semver recommended, e.g. "1.0.0").`);
    }
    if (m.author != null && (typeof m.author !== 'string' || m.author.length > PLUGIN_CFG.manifest.authorMax)) {
      errors.push(`"author" optional, string max ${PLUGIN_CFG.manifest.authorMax} characters.`);
    }
    if (m.description != null && (typeof m.description !== 'string' || m.description.length > PLUGIN_CFG.manifest.descriptionMax)) {
      errors.push(`"description" optional, string max ${PLUGIN_CFG.manifest.descriptionMax} characters.`);
    }

    if (m.extensions !== undefined) {
      if (!Array.isArray(m.extensions) || !m.extensions.length) {
        errors.push('"extensions" must be a non-empty array (e.g. [".ks"]).');
      } else {
        for (const e of m.extensions) {
          if (typeof e !== 'string' || !/^\.[a-z0-9]{1,16}$/i.test(e)) {
            errors.push(`Invalid extension: ${JSON.stringify(e)}. Must start with a dot followed by 1-16 alphanumeric characters (e.g. ".ks").`);
          }
        }
        const lower = m.extensions.map(e => String(e).toLowerCase());
        for (const b of BUILTIN_EXTENSIONS) {
          if (lower.includes(b)) errors.push(`Extension ${b} is a built-in AETL format and cannot be claimed by plugins.`);
        }
      }
    }

    if (m.magic !== undefined) {
      if (!Array.isArray(m.magic) || !m.magic.length) {
        errors.push('"magic" must be a non-empty array.');
      } else {
        m.magic.forEach((s, i) => {
          const res = Manifest.validateSig(s);
          if (!res.ok) errors.push(`magic[${i}]: ${res.error}`);
        });
      }
    }

    if (m.ui !== undefined && m.ui !== null) {
      if (!isPlainObject(m.ui)) {
        errors.push('"ui" must be an object { title?, height? }.');
      } else {
        if (m.ui.title != null && (typeof m.ui.title !== 'string' || !m.ui.title.trim() || m.ui.title.length > PLUGIN_CFG.settings.labelMax)) {
          errors.push(`ui.title must be a string of 1-${PLUGIN_CFG.settings.labelMax} characters.`);
        }
        if (m.ui.height != null && (typeof m.ui.height !== 'number' || !Number.isFinite(m.ui.height) || m.ui.height < PLUGIN_CFG.manifest.uiHeightMin || m.ui.height > PLUGIN_CFG.manifest.uiHeightMax)) {
          errors.push(`ui.height must be a number ${PLUGIN_CFG.manifest.uiHeightMin}-${PLUGIN_CFG.manifest.uiHeightMax} (pixels).`);
        }
      }
    }

    if (m.settings !== undefined) {
      const res = Manifest.validateSettings(m.settings);
      for (const e of res) errors.push(e);
    }

    return errors;
  },

  validateSig(s) {
    if (!isPlainObject(s)) return { ok: false, error: 'must be an object { hex } or { text }, plus optional offset.' };
    const hasHex = Object.hasOwn(s, 'hex'), hasText = Object.hasOwn(s, 'text');
    if (hasHex === hasText) return { ok: false, error: 'must have either hex OR text (not both).' };
    if (hasHex) {
      if (typeof s.hex !== 'string') return { ok: false, error: 'hex must be a string.' };
      const h = s.hex.replace(/\s+/g, '');
      if (!h.length || h.length % 2 || h.length > PLUGIN_CFG.manifest.magicHexMax || !/^[0-9a-f]+$/i.test(h)) return { ok: false, error: `hex must be even-length hexadecimal, max ${PLUGIN_CFG.manifest.magicHexMax / 2} bytes (e.g. "504b0304").` };
    }
    if (hasText) {
      if (typeof s.text !== 'string' || !s.text.length) return { ok: false, error: 'text must be a non-empty string.' };
      if (new TextEncoder().encode(s.text).length > PLUGIN_CFG.manifest.magicTextMaxBytes) return { ok: false, error: `text max ${PLUGIN_CFG.manifest.magicTextMaxBytes} bytes.` };
    }
    if (s.offset != null && (!Number.isInteger(s.offset) || s.offset < 0 || s.offset > PLUGIN_CFG.manifest.magicOffsetMax)) {
      return { ok: false, error: `offset must be an integer 0-${PLUGIN_CFG.manifest.magicOffsetMax}.` };
    }
    return { ok: true };
  },

  validateSettings(raw) {
    if (!isPlainObject(raw)) return ['"settings" must be an object { global?, project? }.'];
    const errors = [];
    for (const k of Object.keys(raw)) {
      if (!SETTING_SCOPES.includes(k)) errors.push(`Unknown key "settings.${k}". Only "global" and "project" are allowed.`);
    }
    for (const scope of SETTING_SCOPES) {
      const arr = raw[scope];
      if (arr === undefined) continue;
      if (!Array.isArray(arr)) { errors.push(`"settings.${scope}" must be an array.`); continue; }
      errors.push(...Manifest.validateSettingList(arr, `settings.${scope}`));
    }
    return errors;
  },

  validateSettingList(raw, at) {
    const errors = [];
    const seen = new Set();
    const types = ['string', 'number', 'boolean', 'select', 'textarea'];
    raw.forEach((s, i) => {
      const a = `${at}[${i}]`;
      if (!isPlainObject(s)) { errors.push(`${a}: must be an object.`); return; }
      if (typeof s.key !== 'string' || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s.key)) {
        errors.push(`${a}.key: must be a valid variable name (e.g. "maxDepth").`); return;
      }
      if (seen.has(s.key)) { errors.push(`${a}.key: key "${s.key}" duplicate.`); return; }
      seen.add(s.key);
      if (typeof s.label !== 'string' || !s.label.trim() || s.label.length > PLUGIN_CFG.settings.labelMax) errors.push(`${a}.label: required, 1-${PLUGIN_CFG.settings.labelMax} characters.`);
      const type = s.type ?? 'string';
      if (!types.includes(type)) errors.push(`${a}.type: must be one of ${types.join(', ')}.`);
      if (s.description != null && (typeof s.description !== 'string' || s.description.length > PLUGIN_CFG.settings.descMax)) errors.push(`${a}.description: max ${PLUGIN_CFG.settings.descMax} characters.`);
      if (s.placeholder != null && (typeof s.placeholder !== 'string' || s.placeholder.length > PLUGIN_CFG.settings.placeholderMax)) errors.push(`${a}.placeholder: max ${PLUGIN_CFG.settings.placeholderMax} characters.`);
      if (type === 'select') {
        if (!Array.isArray(s.options) || !s.options.length) {
          errors.push(`${a}.options: required for select type (at least 1 option).`);
        } else {
          for (const o of s.options) {
            const val = isPlainObject(o) ? o.value : o;
            if (typeof val !== 'string' || !val.length || val.length > PLUGIN_CFG.settings.optionValueMax) {
              errors.push(`${a}.options: each option must be a string ≤ ${PLUGIN_CFG.settings.optionValueMax} characters (or { value, label }).`); break;
            }
          }
        }
      }
      if (type === 'number') {
        for (const k of ['min', 'max', 'step']) {
          if (s[k] != null && typeof s[k] !== 'number') errors.push(`${a}.${k}: must be a number.`);
        }
      }
    });
    return errors;
  },

  normalize(m, files, extra) {
    const settings = Manifest.normalizeSettings(m.settings);
    const magic = (m.magic || []).map(s => Manifest.normalizeSig(s)).filter(Boolean);
    const ui = isPlainObject(m.ui) ? {
      ...(typeof m.ui.title === 'string' && m.ui.title.trim() ? { title: m.ui.title.trim().slice(0, PLUGIN_CFG.settings.labelMax) } : {}),
      ...(typeof m.ui.height === 'number' && Number.isFinite(m.ui.height) ? { height: clampInt(m.ui.height, PLUGIN_CFG.manifest.uiHeightMin, PLUGIN_CFG.manifest.uiHeightMax, PLUGIN_CFG.manifest.uiHeightDefault) } : {})
    } : null;
    return Object.assign({
      manifest_version: m.manifest_version,
      id: m.id,
      name: m.name.trim(),
      version: m.version.trim(),
      author: (m.author || '').trim(),
      description: (m.description || '').trim(),
      extensions: (m.extensions || []).map(e => String(e).toLowerCase()),
      magic,
      ui: ui && Object.keys(ui).length ? ui : null,
      settings,
      files,
      enabled: true
    }, extra || {});
  },

  normalizeSig(s) {
    if (!Manifest.validateSig(s).ok) return null;
    const offset = Number.isInteger(s.offset) && s.offset >= 0 ? s.offset : 0;
    if (Object.hasOwn(s, 'hex')) {
      return { hex: s.hex.replace(/\s+/g, '').toLowerCase(), offset };
    }
    return { hex: Array.from(new TextEncoder().encode(s.text), b => b.toString(16).padStart(2, '0')).join(''), offset };
  },

  normalizeSettings(raw) {
    const out = { global: [], project: [] };
    if (!isPlainObject(raw)) return out;
    for (const scope of SETTING_SCOPES) {
      if (Array.isArray(raw[scope])) out[scope] = Manifest.normalizeSettingList(raw[scope]);
    }
    return out;
  },

  normalizeSettingList(raw) {
    const out = [];
    for (const s of raw) {
      if (!isPlainObject(s)) continue;
      if (typeof s.key !== 'string' || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s.key)) continue;
      if (typeof s.label !== 'string' || !s.label.trim()) continue;
      const type = ['string', 'number', 'boolean', 'select', 'textarea'].includes(s.type) ? s.type : 'string';
      const def = type === 'number' ? (Number(s.default) || 0)
        : type === 'boolean' ? !!s.default
        : String(s.default ?? '');
      const entry = { key: s.key, label: s.label.trim().slice(0, PLUGIN_CFG.settings.labelMax), type, default: def };
      if (type === 'select' && Array.isArray(s.options)) {
        entry.options = s.options.map(o => isPlainObject(o)
          ? { value: String(o.value).slice(0, PLUGIN_CFG.settings.optionValueMax), label: String(o.label ?? o.value).slice(0, PLUGIN_CFG.settings.optionValueMax) }
          : { value: String(o).slice(0, PLUGIN_CFG.settings.optionValueMax), label: String(o).slice(0, PLUGIN_CFG.settings.optionValueMax) });
      }
      if (type === 'number') {
        if (typeof s.min === 'number') entry.min = s.min;
        if (typeof s.max === 'number') entry.max = s.max;
        if (typeof s.step === 'number') entry.step = s.step;
      }
      if (typeof s.placeholder === 'string') entry.placeholder = s.placeholder.slice(0, PLUGIN_CFG.settings.placeholderMax);
      if (typeof s.description === 'string') entry.description = s.description.slice(0, PLUGIN_CFG.settings.descMax);
      out.push(entry);
    }
    return out;
  }
};
