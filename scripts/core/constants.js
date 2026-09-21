// AETL - Constants, CFG, READER
'use strict';

const VERSION = 1;
const PROJECT_MIGRATIONS = {};

function migrateProjectData(data) {
  if (!isPlainObject(data)) {
    throw new Error('Project file is corrupted or invalid and cannot be opened.');
  }
  const from = Number(data.version) || 1;
  if (from > VERSION) {
    throw new Error(`This project was created with a newer version of AETL (v${from}) than this app supports (v${VERSION}). Update AETL and try again.`);
  }
  let out = data;
  for (let v = from + 1; v <= VERSION; v++) {
    const step = PROJECT_MIGRATIONS[v];
    if (step) out = step(out) || out;
  }
  out.version = VERSION;
  return out;
}

const APP_DIR = 'app';
const PLUGINS_DIR = 'plugins';
const PROJECTS_DIR = 'projects';
const MEDIA_DIR = 'media';
const DATA_DIR = 'data';
const APP_SHORTCUTS_FILE = 'shortcuts.json';
const APP_PLUGIN_SETTINGS_FILE = 'plugin-settings.json';
const READER_FILE = 'reader.json';
const BACKUP_FORMAT_PROJECT = 'aetl-project';
const BACKUP_FORMAT_ALL = 'aetl-all';
const BACKUP_VERSION = 1;
const DEFAULT_PROMPT = `Translate entire text to Native English. Euphemism prohibited. Onomatopoeia must be English-based. Result must be inside codeblock. Keep line numbering and format (like code in the middle of the text) intact.`;
const DEFAULT_SUMMARY_PROMPT = `Outside the <translate> and </translate> tags (placed above or below the translated lines), include updated summary of the characters and overall story so far. Any characters and story need to be preserved even though they don't appear again for context.`;
const FIXED_FORMAT_PROMPT = `Format:\n<translate>\ntext\n</translate>`;
const DECODERS = ['utf-8', 'shift_jis', 'windows-31j', 'cp932'];

const READER = {
  modes: ['original', 'translation'],
  widths: ['narrow', 'medium', 'wide'],
  themes: ['dark', 'sepia', 'light'],
  defaults: { mode: 'original', fontSize: 18, width: 'medium', theme: 'dark' },
  font: { min: 14, max: 30 }
};

const CFG = {
  toastTimeoutMs: 3000,
  savedTimeoutMs: 1800,
  dashboardPageSize: 30,
  historyMax: 60,
  historyMin: 15,
  historyLineBudget: 900000,
  scroller: {
    overscan: 6,
    defaultH: 80,
    gap: 8,
    topPad: 8,
    botPad: 12,
    headerH: 32,
    defaultViewportH: 800,
    recyclePos: -10000,
  },
  reader: {
    overscan: 8,
    defaultH: 132,
    gap: 20,
    topPad: 28,
    botPad: 108,
    headerH: 56,
    defaultViewportH: 800,
    recyclePos: -10000,
  },
  anim: {
    itemMs: 160,
    cardMs: 200,
    flipMoveMs: 260,
    flipInMs: 180,
    scrollToMs: 420,
  },
  saveChunkLines: 2000,
  delay: {
    repositionMs: 50,
    focusMs: 30,
    reloadMs: 800,
    revokeUrlMs: 10000,
    dashboardSearchMs: 180,
    proofreadDebounceMs: 200,
    storageWatchMs: 4000,
  },
  chunkSize: { importBatch: 50, fileProgressBatch: 10, namesBatch: 800 },
  warningDisplayMax: 10,
  skippedFilesDisplayMax: 5,
  storage: { criticalFreeMb: 10, safeFreeMb: 80 },
  debounceDefaultMs: 200,
};
