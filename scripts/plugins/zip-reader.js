// AETL - Pure-JS ZIP reader (no dependencies)
'use strict';

const ZipReader = {
  async open(blob) {
    if (!blob || typeof blob.slice !== 'function' || !Number.isFinite(blob.size)) throw new Error('Invalid package source.');
    const size = blob.size;
    if (size < 22) throw new Error('Invalid or corrupted .zip file.');
    const tailLen = Math.min(size, PLUGIN_CFG.zip.tail);
    const tail = new Uint8Array(await blob.slice(size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Invalid or corrupted .zip file.');
    const eocdDv = new DataView(tail.buffer, tail.byteOffset + eocd, 22);
    let count = eocdDv.getUint16(8, true);
    let cdSize = eocdDv.getUint32(12, true);
    let cdOffset = eocdDv.getUint32(16, true);
    const locOff = eocd - 20;
    if (locOff >= 0 && tail[locOff] === 0x50 && tail[locOff + 1] === 0x4b && tail[locOff + 2] === 0x06 && tail[locOff + 3] === 0x07) {
      const locDv = new DataView(tail.buffer, tail.byteOffset + locOff, 20);
      const z64Offset = Number(locDv.getBigUint64(8, true));
      if (Number.isFinite(z64Offset) && z64Offset >= 0 && z64Offset + 56 <= size) {
        const z64 = new Uint8Array(await blob.slice(z64Offset, z64Offset + 56).arrayBuffer());
        if (z64[0] === 0x50 && z64[1] === 0x4b && z64[2] === 0x06 && z64[3] === 0x06) {
          const z64Dv = new DataView(z64.buffer);
          count = Number(z64Dv.getBigUint64(32, true));
          cdSize = Number(z64Dv.getBigUint64(40, true));
          cdOffset = Number(z64Dv.getBigUint64(48, true));
        }
      }
    }
    if (!Number.isFinite(count) || !Number.isFinite(cdSize) || !Number.isFinite(cdOffset) ||
      cdOffset < 0 || cdSize < 0 || cdOffset + cdSize > size) {
      throw new Error('Invalid or corrupted .zip file.');
    }
    const cd = cdSize === 0 ? new Uint8Array(0) : new Uint8Array(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const dv = new DataView(cd.buffer);
    const decoder = new TextDecoder();
    const entries = new Map();
    let pos = 0;
    let seen = 0;
    while (pos + 46 <= cd.length && seen < count) {
      if (dv.getUint32(pos, true) !== 0x02014b50) break;
      const method = dv.getUint16(pos + 10, true);
      let compSize = dv.getUint32(pos + 20, true);
      let uncompSize = dv.getUint32(pos + 24, true);
      const nameLen = dv.getUint16(pos + 28, true);
      const extraLen = dv.getUint16(pos + 30, true);
      const commentLen = dv.getUint16(pos + 32, true);
      let localOffset = dv.getUint32(pos + 42, true);
      const extAttrs = dv.getUint32(pos + 38, true);
      const nameRaw = cd.subarray(pos + 46, pos + 46 + nameLen);
      if (nameRaw.length < nameLen) break;
      let extraPos = pos + 46 + nameLen;
      const extraEnd = Math.min(extraPos + extraLen, cd.length);
      while (extraPos + 4 <= extraEnd) {
        const xid = dv.getUint16(extraPos, true);
        const xsz = dv.getUint16(extraPos + 2, true);
        if (xid === 0x0001 && extraPos + 4 + xsz <= extraEnd) {
          let xp = extraPos + 4;
          const xe = extraPos + 4 + xsz;
          if (uncompSize === 0xFFFFFFFF && xp + 8 <= xe) { uncompSize = Number(dv.getBigUint64(xp, true)); xp += 8; }
          if (compSize === 0xFFFFFFFF && xp + 8 <= xe) { compSize = Number(dv.getBigUint64(xp, true)); xp += 8; }
          if (localOffset === 0xFFFFFFFF && xp + 8 <= xe) { localOffset = Number(dv.getBigUint64(xp, true)); xp += 8; }
        }
        extraPos += 4 + xsz;
      }
      const name = decoder.decode(nameRaw).replace(/^\.+\//, '').replace(/^\/+/, '');
      const mode = extAttrs >>> 16;
      const isDir = !name || name.endsWith('/') || (mode !== 0 && (mode & 0xf000) === 0x4000) || (mode === 0 && (extAttrs & 0x10) !== 0);
      if (!isDir && name && !name.split('/').some(seg => seg === '..' || seg === '')) {
        entries.set(name, { name, method, compSize, uncompSize, localOffset });
      }
      pos += 46 + nameLen + extraLen + commentLen;
      seen++;
    }
    return {
      names() { return Array.from(entries.keys()); },
      has(n) { return entries.has(String(n)); },
      readBytes(n) { return ZipReader._read(blob, entries.get(String(n))); },
      readText(n) { return ZipReader._read(blob, entries.get(String(n))).then(b => new TextDecoder().decode(b)); }
    };
  },

  async _read(blob, e) {
    if (!e) throw new Error('File not found in plugin package.');
    if (e.method !== 0 && e.method !== 8) throw new Error(`Compression method ${e.method} not supported for "${e.name}".`);
    const head = new Uint8Array(await blob.slice(e.localOffset, e.localOffset + 30).arrayBuffer());
    if (head.length < 30 || head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04) {
      throw new Error(`Corrupted package: invalid local header for "${e.name}".`);
    }
    const nameLen = head[26] | (head[27] << 8);
    const extraLen = head[28] | (head[29] << 8);
    const dataStart = e.localOffset + 30 + nameLen + extraLen;
    if (dataStart < 0 || e.compSize < 0 || dataStart + e.compSize > blob.size) {
      throw new Error(`Corrupted package: data "${e.name}" out of bounds.`);
    }
    if (e.method === 0) {
      const out = new Uint8Array(await blob.slice(dataStart, dataStart + e.compSize).arrayBuffer());
      if (e.uncompSize && out.length !== e.uncompSize) throw new Error(`Corrupted package: size mismatch for "${e.name}".`);
      return out;
    }
    const budget = Math.max(PLUGIN_CFG.zip.bombFloor, e.compSize * PLUGIN_CFG.zip.bombRatio);
    const stream = blob.slice(dataStart, dataStart + e.compSize).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > budget) throw new Error(`"${e.name}" exceeds safe decompression limit (${humanBytes(budget)}). Package is likely corrupted.`);
        chunks.push(value);
      }
    } catch (err) {
      try { reader.cancel(); } catch {}
      throw err;
    }
    if (e.uncompSize && total !== e.uncompSize) throw new Error(`Corrupted package: size mismatch for "${e.name}".`);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }
};
