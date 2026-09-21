// AETL - EPUB chapter extraction
'use strict';

async function parseEpub(buffer, tags, existing, start, projectId, onProgress) {
  assertJsZip();
  existing = new Set(existing || []);
  await Storage.writeEpub(projectId, buffer);
  const zip = new JSZip();
  await zip.loadAsync(buffer);
  const containerEntry = zip.file('META-INF/container.xml');
  if (!containerEntry) throw new Error('Invalid EPUB: missing META-INF/container.xml.');
  const containerXml = await containerEntry.async('text');
  const opfPath = Html.containerRoot(containerXml);
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) + '/' : '';
  const opfEntry = zip.file(opfPath);
  if (!opfEntry) throw new Error(`Invalid EPUB: missing OPF at ${opfPath}.`);
  const opfXml = await opfEntry.async('text');
  const { manifest, spine, coverHref } = Html.opfManifest(opfXml);
  const htmls = spine.map(idref => manifest[idref] ? opfDir + manifest[idref] : null).filter(Boolean);

  const imported = [];
  const skipped = [];
  const images = [];
  if (coverHref) {
    const coverPath = resolveZipPath(opfDir, coverHref);
    if (coverPath && zip.file(coverPath)) {
      images.push({ zipPath: coverPath, file: null, isCover: true, insertAfter: null });
    }
  }
  let cur = start;
  for (let i = 0; i < htmls.length; i++) {
    const path = htmls[i];
    if (existing.has(path)) { skipped.push(path); continue; }
    const entry = zip.file(path);
    if (!entry) continue;
    const html = await entry.async('text');
    const chapterDir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) + '/' : '';
    const { texts, images: chImages } = Html.extractContent(html, path.endsWith('.xhtml'), tags, chapterDir);
    const startNum = cur;
    for (const txt of texts) {
      imported.push({
        line_num: cur++,
        file: path,
        name: null,
        message: txt,
        trans_name: null,
        trans_message: null,
        is_translated: false
      });
    }
    for (const img of chImages) {
      images.push({
        zipPath: img.zipPath,
        file: path,
        isCover: false,
        insertAfter: img.afterIndex >= 0 ? (startNum + img.afterIndex) : null
      });
    }
    if (texts.length || chImages.length) existing.add(path);
    onProgress(`${i + 1} / ${htmls.length} file`, ((i + 1) / htmls.length) * 100);
    if (i % 20 === 0) await yieldToEvent();
  }
  return { imported, skipped, nextStart: cur, existing: Array.from(existing), images };
}
