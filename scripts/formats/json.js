// AETL - JSON array parsing helpers
'use strict';

function parseJsonArray(arr, file, start) {
  if (!Array.isArray(arr)) throw new Error(`File ${file} is not a JSON array.`);
  const out = [];
  let skipped = 0;
  let n = start;
  for (const e of arr) {
    if (!e || typeof e !== 'object' || !Object.hasOwn(e, 'message')) { skipped++; continue; }
    out.push({
      line_num: n++,
      file,
      name: stripNewlines(e.name),
      message: String(e.message || '').replace(_NEWLINE_RE, '\\n').trim(),
      trans_name: null,
      trans_message: null,
      is_translated: false
    });
  }
  return { lines: out, skipped };
}

async function parseFilesList(files, existing, start, onProgress, label = 'file') {
  existing = new Set(existing || []);
  const imported = [];
  const skipped = [];
  let invalidEntries = 0;
  let cur = start;
  const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    const bn = baseName(f.name);
    if (existing.has(bn)) { skipped.push(bn); continue; }
    const arr = JSON.parse(decodeBuffer(f.buffer));
    const parsed = parseJsonArray(arr, bn, cur);
    if (parsed.lines.length) {
      existing.add(bn);
      for (let j = 0; j < parsed.lines.length; j++) imported.push(parsed.lines[j]);
      cur += parsed.lines.length;
    }
    invalidEntries += parsed.skipped;
    onProgress(`${i + 1} / ${sorted.length} ${label}`, ((i + 1) / sorted.length) * 100);
    if (i % CFG.chunkSize.importBatch === 0) await yieldToEvent();
  }
  return { imported, skipped, invalidEntries, nextStart: cur, existing: Array.from(existing) };
}

async function parseZipJson(buffer, existing, start, onProgress) {
  assertJsZip();
  const zip = new JSZip();
  await zip.loadAsync(buffer);
  const files = [];
  for (const name of Object.keys(zip.files).filter(n => n.endsWith('.json') && !zip.files[n].dir)) {
    const entry = zip.file(name);
    if (entry) files.push({ name, buffer: await entry.async('uint8array') });
  }
  return parseFilesList(files, existing, start, onProgress, 'file');
}

const fileKeyOf = name => baseName(name).replace(_JSON_EXT_SUFFIX_RE, '').toLowerCase();

async function readJsonInputs(files) {
  const out = [];
  for (const f of Array.from(files)) {
    const buf = new Uint8Array(await f.arrayBuffer());
    if (isZipHead(buf)) {
      assertJsZip();
      const zip = new JSZip();
      await zip.loadAsync(buf);
      for (const name of Object.keys(zip.files).filter(n => n.toLowerCase().endsWith('.json') && !zip.files[n].dir)) {
        const entry = zip.file(name);
        if (entry) out.push({ name: baseName(name), buffer: await entry.async('uint8array') });
      }
    } else {
      out.push({ name: baseName(f.name), buffer: buf });
    }
  }
  return out;
}

function parseJsonEntries(arr, file) {
  if (!Array.isArray(arr)) throw new Error(`File ${file} is not a JSON array.`);
  const entries = [];
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    if (!e || typeof e !== 'object' || !Object.hasOwn(e, 'message')) {
      throw new Error(`File ${file}: entry #${i + 1} does not have a "message" field.`);
    }
    entries.push({
      name: e.name == null ? null : String(e.name),
      message: String(e.message ?? '')
    });
  }
  return { entries };
}

function groupLinesByFile(lines) {
  const grouped = new Map();
  for (const l of lines) {
    let arr = grouped.get(l.file);
    if (!arr) { arr = []; grouped.set(l.file, arr); }
    arr.push(l);
  }
  return grouped;
}

function buildFileKeyMap(files) {
  const m = new Map();
  for (const f of files) {
    const key = fileKeyOf(f);
    if (!m.has(key)) m.set(key, f);
  }
  return m;
}
