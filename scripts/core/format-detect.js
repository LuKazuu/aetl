// AETL - Format detection & path helpers
'use strict';

function decodeBuffer(buf) {
  for (const enc of DECODERS) {
    try { return new TextDecoder(enc, { fatal: true }).decode(buf); } catch {}
  }
  return new TextDecoder('utf-8').decode(buf);
}

const asciiOf = bytes => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; };
const isZipHead = h => h.length >= 4 && h[0] === 0x50 && h[1] === 0x4b && h[2] === 0x03 && h[3] === 0x04;
const isEpubHead = h => isZipHead(h) && asciiOf(h).includes('application/epub+archive');
const isJsonHead = h => {
  let i = 0;
  if (h.length >= 3 && h[0] === 0xef && h[1] === 0xbb && h[2] === 0xbf) i = 3;
  while (i < h.length && (h[i] === 0x20 || h[i] === 0x09 || h[i] === 0x0a || h[i] === 0x0d)) i++;
  return i < h.length && (h[i] === 0x7b || h[i] === 0x5b);
};

function resolveZipPath(baseDir, rel) {
  if (!rel) return null;
  if (/^(?:[a-z]+:)?\/\//i.test(rel) || /^data:/i.test(rel)) return null;
  rel = rel.split('#')[0].split('?')[0];
  if (!rel) return null;
  const parts = (baseDir + rel).split('/');
  const stack = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  return stack.join('/');
}

function isJapanese(s) {
  return /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(s);
}
