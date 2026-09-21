// AETL - HTML/XML parsing helpers for EPUB
'use strict';

const Html = {
  containerRoot(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const rootFile = doc.querySelector('rootfile');
    const p = rootFile?.getAttribute('full-path');
    if (!p) throw new Error('Invalid EPUB: missing rootfile full-path.');
    return decodeURIComponent(p);
  },
  opfManifest(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const manifest = {};
    const items = Array.from(doc.querySelectorAll('manifest > item'));
    items.forEach(it => {
      const href = it.getAttribute('href');
      if (href != null) manifest[it.getAttribute('id')] = decodeURIComponent(href);
    });
    const spine = Array.from(doc.querySelectorAll('spine > itemref')).map(it => it.getAttribute('idref'));
    let coverId = doc.querySelector('metadata > meta[name="cover"]')?.getAttribute('content') || null;
    if (!coverId) {
      const coverItem = items.find(it => (it.getAttribute('properties') || '').split(/\s+/).includes('cover-image'));
      if (coverItem) coverId = coverItem.getAttribute('id');
    }
    const coverHref = coverId && manifest[coverId] ? manifest[coverId] : null;
    return { manifest, spine, coverHref };
  },
  extractContent(html, isXhtml, tags, baseDir) {
    const doc = new DOMParser().parseFromString(html, isXhtml ? 'application/xhtml+xml' : 'text/html');
    const texts = [];
    const images = [];
    const nodes = doc.querySelectorAll(`${tags}, img, image`);
    nodes.forEach(el => {
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'img' || tag === 'image') {
        const src = el.getAttribute('src') || el.getAttribute('xlink:href') || el.getAttribute('href');
        const zipPath = resolveZipPath(baseDir, src);
        if (zipPath) images.push({ afterIndex: texts.length - 1, zipPath });
      } else {
        const txt = el.textContent.replace(_NEWLINE_RE, ' ').trim();
        if (txt) texts.push(txt);
      }
    });
    return { texts, images };
  },
  rewriteTags(html, isXhtml, tags, replacements) {
    const doc = new DOMParser().parseFromString(html, isXhtml ? 'application/xhtml+xml' : 'text/html');
    let idx = 0;
    doc.querySelectorAll(tags).forEach(el => {
      if (el.textContent.replace(_NEWLINE_RE, ' ').trim() === '') return;
      const r = replacements[idx++];
      if (r != null) el.textContent = r;
    });
    return new XMLSerializer().serializeToString(doc);
  }
};
