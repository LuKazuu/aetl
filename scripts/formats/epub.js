// AETL - EPUB image cache and parser
'use strict';

const IMG_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp'
};

const EpubImages = {
  zipCache: null,
  zipLoading: null,
  urlCache: new Map(),
  urlPending: new Map(),

  async getZip(projectId) {
    if (this.zipCache && this.zipCache.projectId === projectId) return this.zipCache.zip;
    if (this.zipLoading && this.zipLoading.projectId === projectId) return this.zipLoading.promise;
    assertJsZip();
    const promise = (async () => {
      const buffer = await Storage.readEpub(projectId);
      if (!buffer) throw new Error('EPUB not found in project.');
      const zip = new JSZip();
      await zip.loadAsync(buffer);
      return zip;
    })();
    this.zipLoading = { projectId, promise };
    try {
      const zip = await promise;
      this.zipCache = { projectId, zip };
      return zip;
    } finally {
      if (this.zipLoading && this.zipLoading.projectId === projectId) this.zipLoading = null;
    }
  },

  preload(projectId) {
    if (!projectId) return;
    this.getZip(projectId).then(zip => {
      const paths = [...new Set((State.images || []).map(im => im.zipPath).filter(Boolean))];
      for (const zipPath of paths) this.getUrl(projectId, zipPath);
    }).catch(() => {});
  },

  peekUrl(projectId, zipPath) {
    if (!projectId || !zipPath) return undefined;
    return this.urlCache.get(`${projectId}|${zipPath}`);
  },

  // Shared cache/pending helper for getUrl and getUrlFromMediaPath.
  async _produceUrl(key, producer) {
    if (this.urlCache.has(key)) return this.urlCache.get(key);
    if (this.urlPending.has(key)) return this.urlPending.get(key);
    const promise = (async () => {
      try {
        const blob = await producer();
        if (!blob) { this._commitUrl(key, null); return null; }
        const url = URL.createObjectURL(blob);
        this._commitUrl(key, url);
        return url;
      } catch { this._commitUrl(key, null); return null; }
      finally { this.urlPending.delete(key); }
    })();
    this.urlPending.set(key, promise);
    return promise;
  },

  getUrl(projectId, zipPath) {
    if (!projectId || !zipPath) return Promise.resolve(null);
    return this._produceUrl(`${projectId}|${zipPath}`, async () => {
      const zip = await this.getZip(projectId);
      const entry = zip?.file(zipPath);
      if (!entry) return null;
      const ext = zipPath.split('.').pop().toLowerCase();
      const bytes = await entry.async('uint8array');
      return new Blob([bytes], { type: IMG_MIME[ext] || 'application/octet-stream' });
    });
  },

  getUrlFromMediaPath(projectId, mediaPath) {
    if (!projectId || !mediaPath) return Promise.resolve(null);
    return this._produceUrl(`${projectId}|${mediaPath}`, async () => {
      const buf = await Storage.readMediaFile(projectId, mediaPath);
      return buf ? new Blob([buf]) : null;
    });
  },

  _commitUrl(key, url) {
    if (!this.urlPending.has(key)) {
      if (url) URL.revokeObjectURL(url);
      return;
    }
    this.urlCache.set(key, url);
  },

  clear() {
    for (const url of this.urlCache.values()) { if (url) URL.revokeObjectURL(url); }
    this.urlCache.clear();
    this.urlPending.clear();
    this.zipCache = null;
    this.zipLoading = null;
  }
};
