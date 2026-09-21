// AETL - Search & Replace logic
'use strict';

function buildRe(query, regex, exact, caseSensitive) {
  if (!query) return null;
  try {
    let p = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (exact) p = `(^|[^\\p{L}\\p{N}_])${p}(?![\\p{L}\\p{N}_])`;
    return new RegExp(p, caseSensitive ? 'gu' : 'giu');
  } catch { return null; }
}

function proofreadSearch(lines, query, regex, exact, caseSensitive, scope, translatedOnly) {
  const re = buildRe(query, regex, exact, caseSensitive);
  const matches = [];
  for (const l of lines) {
    if (translatedOnly && !l.is_translated) continue;
    const on = l.name || '';
    const tn = l.is_translated ? (l.trans_name || '').trim() || l.name : null;
    const msg = translatedOnly ? l.trans_message : l.message;
    const name = translatedOnly ? tn : on;
    if (query && re) {
      let found = false;
      re.lastIndex = 0;
      if ((scope === 'all' || scope === 'message') && msg && re.test(msg)) found = true;
      re.lastIndex = 0;
      if (!found && (scope === 'all' || scope === 'name') && name && re.test(name)) found = true;
      if (!found) continue;
    }
    matches.push({
      num: l.line_num,
      file: l.file,
      origName: l.name || '',
      origMsg: l.message,
      transName: l.is_translated ? (l.trans_name || '').trim() || l.name : null,
      transMsg: l.trans_message,
      isTrans: !!l.is_translated
    });
  }
  return matches;
}

function replaceAll(lines, query, replace, regex, exact, caseSensitive, scope, translatedOnly) {
  const re = buildRe(query, regex, exact, caseSensitive);
  if (!re) return { modified: [], count: 0 };
  const replacer = exact
    ? (m, p1) => p1 + replace
    : () => replace;
  const modified = [];
  let count = 0;
  for (const l of lines) {
    if (translatedOnly && !l.is_translated) continue;
    let replaced = false;
    const m = { line_num: l.line_num, message: l.message, trans_message: l.trans_message, name: l.name, trans_name: l.trans_name };
    const msgProp = translatedOnly ? 'trans_message' : 'message';
    const nameProp = translatedOnly ? 'trans_name' : 'name';
    if ((scope === 'all' || scope === 'message') && l[msgProp]) {
      const v = l[msgProp].replace(re, replacer);
      if (v !== l[msgProp]) { m[msgProp] = v; replaced = true; }
    }
    if ((scope === 'all' || scope === 'name') && l[nameProp]) {
      const v = l[nameProp].replace(re, replacer);
      if (v !== l[nameProp]) { m[nameProp] = v; replaced = true; }
    }
    if (replaced) { modified.push(m); count++; }
  }
  return { modified, count };
}
