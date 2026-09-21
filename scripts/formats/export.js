// AETL - Export: lineToJsonEntry, buildExportJson, buildExportEpub
'use strict';

const _NEWLINE_LITERAL_RE = /\\n/g;

function lineToJsonEntry(l, forceOriginal) {
  const isT = forceOriginal ? false : !!l.is_translated;
  const name = isT ? (l.trans_name != null ? l.trans_name : l.name) : l.name;
  const msg = isT ? l.trans_message : l.message;
  const entry = {};
  if (name != null) entry.name = name.replace(_NEWLINE_LITERAL_RE, '\n');
  entry.message = (msg || '').replace(_NEWLINE_LITERAL_RE, '\n');
  return entry;
}

async function buildExportJson(lines, projectName, onProgress, suffix = 'export', forceOriginal = false, keepIf = null) {
  assertJsZip();
  const grouped = groupLinesByFile(lines);
  const entries = Array.from(grouped.entries());
  const results = [];
  for (let i = 0; i < entries.length; i++) {
    const [file, fileLines] = entries[i];
    const kept = keepIf ? fileLines.filter(keepIf) : fileLines;
    if (kept.length) {
      results.push({
        name: `${file.replace(_JSON_EXT_SUFFIX_GLOBAL_RE, '')}.json`,
        content: JSON.stringify(kept.map(l => lineToJsonEntry(l, forceOriginal)), null, 2)
      });
    }
    onProgress(`${i + 1} / ${entries.length} file`, ((i + 1) / entries.length) * 100);
    if (i % CFG.chunkSize.importBatch === 0) await yieldToEvent();
  }
  if (!results.length) throw new Error('No entries to export after filter.');
  if (results.length > 1) {
    onProgress('Compressing ZIP...', 100);
    const zip = new JSZip();
    for (const r of results) zip.file(r.name, r.content);
    const blob = await zip.generateAsync({
      type: 'blob', mimeType: 'application/octet-stream',
      compression: 'DEFLATE', compressionOptions: { level: 9 }
    });
    return { blob, name: `${sanitizeName(projectName)}_${suffix}.zip`, multiple: true };
  }
  const r = results[0];
  const blob = new Blob([r.content], { type: 'application/json' });
  return { blob, name: r.name, multiple: false };
}

async function buildExportEpub(projectId, lines, tags, projectName, onProgress) {
  assertJsZip();
  const buffer = await Storage.readEpub(projectId);
  if (!buffer) throw new Error('EPUB not found in project. Re-import the EPUB to export.');
  const zip = new JSZip();
  await zip.loadAsync(buffer);
  const byFile = {};
  for (const l of lines) (byFile[l.file] ||= []).push(l);
  const paths = Object.keys(byFile);
  for (let pi = 0; pi < paths.length; pi++) {
    const path = paths[pi];
    const entry = zip.file(path);
    if (!entry) continue;
    const html = await entry.async('text');
    const xmlMatch = html.match(/^<\?xml.*?\?>/i);
    const replacements = byFile[path].map(l => (l.is_translated && l.trans_message) ? l.trans_message : null);
    let out = Html.rewriteTags(html, path.endsWith('.xhtml'), tags, replacements);
    if (xmlMatch && !out.startsWith('<?xml')) out = xmlMatch[0] + '\n' + out;
    zip.file(path, out);
    onProgress(`${pi + 1} / ${paths.length} file`, ((pi + 1) / paths.length) * 100);
    if (pi % 20 === 0) await yieldToEvent();
  }
  if (zip.file('mimetype')) {
    zip.file('mimetype', await zip.file('mimetype').async('text'), { compression: 'STORE' });
  }
  onProgress('Compressing EPUB...', 100);
  const blob = await zip.generateAsync({
    type: 'blob', mimeType: 'application/epub+zip',
    compression: 'DEFLATE', compressionOptions: { level: 9 }
  });
  return { blob, name: `${sanitizeName(projectName)}_tl.epub` };
}
