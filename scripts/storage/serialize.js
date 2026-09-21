// AETL - Project JSON serialization, line normalization
'use strict';

async function serializeProjectJson(data) {
  const lines = data.lines;
  data.lines = undefined;
  const head = JSON.stringify(data);
  data.lines = lines;
  if (!Array.isArray(lines) || !lines.length) return head.slice(0, -1) + ',"lines":[]}';
  const parts = [];
  for (let i = 0; i < lines.length; i += CFG.saveChunkLines) {
    const chunk = JSON.stringify(lines.slice(i, i + CFG.saveChunkLines));
    parts.push(chunk.slice(1, -1));
    if (parts.length % 2 === 0) await yieldToEvent();
  }
  return head.slice(0, -1) + ',"lines":[' + parts.join(',') + ']' + head.slice(-1);
}

function normalizeLine(l) {
  if (l._n) return l;
  return {
    line_num: Number(l.line_num),
    file: String(l.file),
    name: l.name == null ? null : String(l.name),
    message: String(l.message || ''),
    trans_name: l.trans_name == null ? null : String(l.trans_name),
    trans_message: l.trans_message == null ? null : String(l.trans_message),
    is_translated: Boolean(l.is_translated),
    _n: 1
  };
}

function lineToStorage(l) {
  return {
    line_num: l.line_num,
    file: l.file,
    is_translated: l.is_translated,
    original: { name: l.name, message: l.message },
    translation: { name: l.trans_name, message: l.trans_message }
  };
}

function lineFromStorage(e) {
  const o = e.original || {};
  const t = e.translation || {};
  return {
    line_num: Number(e.line_num),
    file: String(e.file),
    name: o.name == null ? null : String(o.name),
    message: String(o.message || ''),
    trans_name: t.name == null ? null : String(t.name),
    trans_message: t.message == null ? null : String(t.message),
    is_translated: Boolean(e.is_translated),
    _n: 1
  };
}
