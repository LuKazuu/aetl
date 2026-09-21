// AETL - OPFS-backed Storage layer
'use strict';

const Storage = {
  _rootPromise: null,
  root() {
    if (!this._rootPromise) {
      this._rootPromise = Promise.resolve().then(() => navigator.storage.getDirectory());
      this._rootPromise.catch(() => { Storage._rootPromise = null; });
    }
    return this._rootPromise;
  },
  invalidateRoot() {
    const p = Storage._rootPromise;
    Storage._rootPromise = null;
    if (p) p.catch(() => {});
  },
  async _withRootRetry(fn, noun) {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) Storage.invalidateRoot();
      let root;
      try { root = await Storage.root(); }
      catch (e) {
        lastErr = e;
        if (!isStorageError(e)) throw e;
        continue;
      }
      try { return await fn(root); }
      catch (e) {
        lastErr = e;
        if (!isStorageError(e)) throw e;
      }
    }
    throw storageFailure(lastErr, noun);
  },
  async probe() {
    try {
      const root = await Storage.root();
      await root.entries().next();
      return true;
    } catch {
      Storage.invalidateRoot();
      return false;
    }
  },
  _queue: Promise.resolve(),
  _queued(fn) {
    const run = Storage._queue.then(fn, fn);
    Storage._queue = run.then(() => {}, () => {});
    return run;
  },

  async _writeFile(dir, name, content) {
    const rand = Math.random().toString(36).slice(2, 8);
    const tmpName = '.' + String(name).slice(0, 240) + '.' + rand + '.tmp';
    let tmpHandle = null;
    let w = null;
    try {
      tmpHandle = await dir.getFileHandle(tmpName, { create: true });
      w = await tmpHandle.createWritable();
      await w.write(content);
      await w.close();
      w = null;
      let moved = false;
      if (typeof tmpHandle.move === 'function') {
        try { await tmpHandle.move(name); moved = true; } catch {}
      }
      if (!moved) {
        const finalHandle = await dir.getFileHandle(name, { create: true });
        const w2 = await finalHandle.createWritable();
        try {
          await w2.write(content);
          await w2.close();
        } catch (e) {
          try { await w2.abort(); } catch {}
          throw e;
        }
      }
    } catch (e) {
      if (w) { try { await w.abort(); } catch {} }
      if (e && /quota/i.test(String(e.name || e.message || ''))) {
        throw new Error('Browser storage is full while saving file. Clean up unnecessary files and try again.');
      }
      throw e;
    } finally {
      if (tmpHandle) { try { await dir.removeEntry(tmpName); } catch {} }
    }
  },

  async _readJson(dir, name) {
    const f = await (await dir.getFileHandle(name)).getFile();
    return JSON.parse(await f.text());
  },

  async _readJsonSafe(dir, name, fallback) {
    try { return await Storage._readJson(dir, name); }
    catch { return fallback; }
  },

  async _ensureAppDir(root) {
    return await root.getDirectoryHandle(APP_DIR, { create: true });
  },
  async _ensurePluginsDir(root) {
    return await root.getDirectoryHandle(PLUGINS_DIR, { create: true });
  },
  async _ensureProjectsDir(root) {
    return await root.getDirectoryHandle(PROJECTS_DIR, { create: true });
  },

  writeAppJson(name, value) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const dir = await Storage._ensureAppDir(root);
      const parts = name.split('/').filter(Boolean);
      let cur = dir;
      for (let i = 0; i < parts.length - 1; i++) {
        cur = await cur.getDirectoryHandle(parts[i], { create: true });
      }
      await Storage._writeFile(cur, parts[parts.length - 1], JSON.stringify(value));
    }));
  },

  async readAppJson(name) {
    try {
      return await Storage._withRootRetry(async root => {
        const dir = await Storage._ensureAppDir(root);
        const parts = name.split('/').filter(Boolean);
        let cur = dir;
        for (let i = 0; i < parts.length - 1; i++) {
          cur = await cur.getDirectoryHandle(parts[i]);
        }
        return await Storage._readJson(cur, parts[parts.length - 1]);
      });
    } catch { return null; }
  },

  removeAppFile(name) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const dir = await Storage._ensureAppDir(root);
      const parts = name.split('/').filter(Boolean);
      let cur = dir;
      for (let i = 0; i < parts.length - 1; i++) {
        cur = await cur.getDirectoryHandle(parts[i]);
      }
      try { await cur.removeEntry(parts[parts.length - 1]); } catch {}
    }));
  },

  async readShortcuts() {
    return Storage.readAppJson(APP_SHORTCUTS_FILE);
  },
  writeShortcuts(value) {
    return Storage.writeAppJson(APP_SHORTCUTS_FILE, value);
  },
  removeShortcuts() {
    return Storage.removeAppFile(APP_SHORTCUTS_FILE);
  },

  async readGlobalPluginSettings() {
    return Storage.readAppJson(APP_PLUGIN_SETTINGS_FILE);
  },
  writeGlobalPluginSettings(value) {
    return Storage.writeAppJson(APP_PLUGIN_SETTINGS_FILE, value);
  },

  async readReaderPrefs() {
    return Storage.readAppJson(READER_FILE);
  },
  writeReaderPrefs(value) {
    return Storage.writeAppJson(READER_FILE, value);
  },

  async readPluginIndex() {
    try {
      return await Storage._withRootRetry(async root => {
        const dir = await Storage._ensurePluginsDir(root);
        return await Storage._readJsonSafe(dir, 'index.json', []);
      });
    } catch { return []; }
  },
  writePluginIndex(items) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const dir = await Storage._ensurePluginsDir(root);
      await Storage._writeFile(dir, 'index.json', JSON.stringify(items));
    }));
  },

  async _pluginDir(root, pluginId, create) {
    const plugins = await Storage._ensurePluginsDir(root);
    return await plugins.getDirectoryHandle(pluginId, { create: !!create });
  },

  async installPluginFiles(pluginId, manifestJson, pluginCode, assetFiles) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const dir = await Storage._pluginDir(root, pluginId, true);
      await Storage._writeFile(dir, 'manifest.json', manifestJson);
      await Storage._writeFile(dir, 'plugin.js', pluginCode);
      for (const [path, bytes] of assetFiles) {
        const parts = path.split('/').filter(Boolean);
        let cur = dir;
        for (let i = 0; i < parts.length - 1; i++) {
          cur = await cur.getDirectoryHandle(parts[i], { create: true });
        }
        await Storage._writeFile(cur, parts[parts.length - 1], bytes);
      }
    }));
  },

  async readPluginCode(pluginId) {
    return Storage._withRootRetry(async root => {
      const dir = await Storage._pluginDir(root, pluginId, false);
      const f = await (await dir.getFileHandle('plugin.js')).getFile();
      return await f.text();
    });
  },

  async readPluginAssetBytes(pluginId, path) {
    return Storage._withRootRetry(async root => {
      const dir = await Storage._pluginDir(root, pluginId, false);
      const parts = path.split('/').filter(Boolean);
      let cur = dir;
      for (let i = 0; i < parts.length - 1; i++) {
        cur = await cur.getDirectoryHandle(parts[i]);
      }
      const f = await (await cur.getFileHandle(parts[parts.length - 1])).getFile();
      return new Uint8Array(await f.arrayBuffer());
    });
  },

  async readPluginAssetText(pluginId, path) {
    const bytes = await Storage.readPluginAssetBytes(pluginId, path);
    return new TextDecoder().decode(bytes);
  },

  async pluginInstalled(pluginId) {
    try {
      await Storage._withRootRetry(async root => {
        const dir = await Storage._pluginDir(root, pluginId, false);
        await dir.getFileHandle('plugin.js');
        await dir.getFileHandle('manifest.json');
      });
      return true;
    } catch { return false; }
  },

  async deletePlugin(pluginId) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const plugins = await Storage._ensurePluginsDir(root);
      try { await plugins.removeEntry(pluginId, { recursive: true }); }
      catch (e) { if (e?.name !== 'NotFoundError') throw e; }
    }));
  },

  async listInstalledPluginIds() {
    try {
      return await Storage._withRootRetry(async root => {
        const plugins = await Storage._ensurePluginsDir(root);
        const out = [];
        for await (const [name, h] of plugins.entries()) {
          if (h.kind !== 'directory') continue;
          out.push(name);
        }
        return out;
      });
    } catch { return []; }
  },

  async _projectDir(root, projectId, create) {
    const projects = await Storage._ensureProjectsDir(root);
    return await projects.getDirectoryHandle(projectId, { create: !!create });
  },

  async createProjectDir(projectId) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const dir = await Storage._projectDir(root, projectId, true);
      await dir.getDirectoryHandle(MEDIA_DIR, { create: true });
      await dir.getDirectoryHandle(DATA_DIR, { create: true });
    }));
  },

  async saveProject(projectId, data) {
    if (!data.updatedAt) data.updatedAt = Date.now();
    const json = await serializeProjectJson(data);
    return Storage.saveProjectJson(projectId, json);
  },

  async saveProjectJson(projectId, json) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const dir = await Storage._projectDir(root, projectId, true);
      await dir.getDirectoryHandle(MEDIA_DIR, { create: true });
      await dir.getDirectoryHandle(DATA_DIR, { create: true });
      await Storage._writeFile(dir, 'project.json', json);
    }));
  },

  async loadProject(projectId) {
    let data;
    try {
      data = await Storage._withRootRetry(async root => {
        const dir = await Storage._projectDir(root, projectId, false);
        return await Storage._readJson(dir, 'project.json');
      }, 'project');
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error('Project file is corrupted or invalid and cannot be opened.');
      throw e;
    }
    return migrateProjectData(data);
  },

  async deleteProject(projectId) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const projects = await Storage._ensureProjectsDir(root);
      try { await projects.removeEntry(projectId, { recursive: true }); }
      catch (e) { if (e?.name !== 'NotFoundError') throw e; }
      await Storage._removeProjectIndexEntry(root, projectId);
    }));
  },

  async writeMediaFile(projectId, relPath, bytes) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const dir = await Storage._projectDir(root, projectId, true);
      const media = await dir.getDirectoryHandle(MEDIA_DIR, { create: true });
      const parts = relPath.split('/').filter(Boolean);
      let cur = media;
      for (let i = 0; i < parts.length - 1; i++) {
        cur = await cur.getDirectoryHandle(parts[i], { create: true });
      }
      await Storage._writeFile(cur, parts[parts.length - 1], bytes);
    }));
  },

  async readMediaFile(projectId, relPath) {
    try {
      return await Storage._withRootRetry(async root => {
        const dir = await Storage._projectDir(root, projectId, false);
        const media = await dir.getDirectoryHandle(MEDIA_DIR);
        const parts = relPath.split('/').filter(Boolean);
        let cur = media;
        for (let i = 0; i < parts.length - 1; i++) {
          cur = await cur.getDirectoryHandle(parts[i]);
        }
        const f = await (await cur.getFileHandle(parts[parts.length - 1])).getFile();
        return await f.arrayBuffer();
      });
    } catch { return null; }
  },

  async writeEpub(projectId, buffer) {
    return Storage.writeMediaFile(projectId, MEDIA_EPUB, buffer);
  },

  async readEpub(projectId) {
    const buf = await Storage.readMediaFile(projectId, MEDIA_EPUB);
    return buf ? new Uint8Array(buf) : null;
  },

  async _pluginDataDir(root, projectId, pluginId, create) {
    const dir = await Storage._projectDir(root, projectId, create);
    const data = await dir.getDirectoryHandle(DATA_DIR, create ? { create: true } : {});
    return await data.getDirectoryHandle(pluginId, create ? { create: true } : {});
  },

  async savePluginData(projectId, pluginId, key, data) {
    if (!validDataKey(key)) throw new Error('Invalid data key.');
    let blob;
    if (data instanceof Blob) blob = data;
    else if (data instanceof ArrayBuffer || data instanceof Uint8Array) blob = new Blob([data], { type: 'application/octet-stream' });
    else if (typeof data === 'string') blob = new Blob([data], { type: 'text/plain' });
    else throw new Error('Invalid data (must be Blob / ArrayBuffer / Uint8Array / string).');
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const dir = await Storage._pluginDataDir(root, projectId, pluginId, true);
      await Storage._writeFile(dir, key, blob);
    }));
  },

  async loadPluginData(projectId, pluginId, key) {
    if (!validDataKey(key)) return null;
    try {
      return await Storage._withRootRetry(async root => {
        const dir = await Storage._pluginDataDir(root, projectId, pluginId, false);
        const fh = await dir.getFileHandle(key);
        return await fh.getFile();
      });
    } catch { return null; }
  },

  async deletePluginData(projectId, pluginId, key) {
    if (!validDataKey(key)) return;
    return Storage._queued(() => Storage._withRootRetry(async root => {
      try {
        const dir = await Storage._pluginDataDir(root, projectId, pluginId, false);
        await dir.removeEntry(key);
      } catch (e) { if (e?.name !== 'NotFoundError') throw e; }
    }));
  },

  async listPluginData(projectId, pluginId) {
    try {
      return await Storage._withRootRetry(async root => {
        const dir = await Storage._pluginDataDir(root, projectId, pluginId, false);
        const keys = [];
        for await (const [name, h] of dir.entries()) {
          if (h.kind !== 'file') continue;
          if (name.startsWith('.') && name.endsWith('.tmp')) continue;
          keys.push(name);
        }
        return keys;
      });
    } catch { return []; }
  },

  async pluginDataExists(projectId, pluginId, key) {
    if (!validDataKey(key)) return false;
    try {
      await Storage._withRootRetry(async root => {
        const dir = await Storage._pluginDataDir(root, projectId, pluginId, false);
        await dir.getFileHandle(key);
      });
      return true;
    } catch { return false; }
  },

  async _readProjectIndex(root) {
    try {
      const dir = await Storage._ensureProjectsDir(root);
      return await Storage._readJsonSafe(dir, 'index.json', []);
    } catch { return []; }
  },

  async _writeProjectIndex(root, items) {
    const dir = await Storage._ensureProjectsDir(root);
    await Storage._writeFile(dir, 'index.json', JSON.stringify(items));
  },

  async _removeProjectIndexEntry(root, projectId) {
    const items = await Storage._readProjectIndex(root);
    const filtered = items.filter(p => p.id !== projectId);
    if (filtered.length !== items.length) await Storage._writeProjectIndex(root, filtered);
  },

  upsertProjectIndexEntry(meta) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const items = await Storage._readProjectIndex(root);
      const i = items.findIndex(p => p.id === meta.id);
      if (i >= 0) items[i] = meta; else items.push(meta);
      items.sort((a, b) => b.updatedAt - a.updatedAt);
      await Storage._writeProjectIndex(root, items);
    }));
  },

  async listProjects() {
    return Storage.reconcileProjectIndex(await Storage._readProjectIndexFromRoot());
  },

  async _readProjectIndexFromRoot() {
    try {
      return await Storage._withRootRetry(root => Storage._readProjectIndex(root));
    } catch { return []; }
  },

  projectIndexEntry(id, data, fallbackModified) {
    return {
      id,
      name: data.projectName || id,
      projectType: data.projectType || 'uninitialized',
      pluginId: data.pluginId || null,
      pluginName: data.pluginName || null,
      updatedAt: data.updatedAt || fallbackModified,
      fileCount: countFiles(data.imported_files),
      lineCount: data.lines?.length || 0,
      translatedCount: data.lines?.reduce((n, l) => n + (l.is_translated ? 1 : 0), 0) || 0
    };
  },

  reconcileProjectIndex(items) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const saved = Array.isArray(items) ? items : [];
      const byId = new Map(saved.map(p => [p.id, p]));
      const found = [];
      let changed = false;
      const projects = await Storage._ensureProjectsDir(root);
      for await (const [name, h] of projects.entries()) {
        if (h.kind !== 'directory') continue;
        const meta = byId.get(name);
        if (meta) {
          byId.delete(name);
          found.push(meta);
          continue;
        }
        const data = await Storage._readJson(h, 'project.json');
        found.push(Storage.projectIndexEntry(name, data, Date.now()));
        changed = true;
      }
      if (byId.size) changed = true;
      found.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (changed) await Storage._writeProjectIndex(root, found);
      return found;
    }));
  },

  async wipeAll(onProgress) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const names = [];
      for await (const [name] of root.entries()) names.push(name);
      let done = 0;
      for (const name of names) {
        try { await root.removeEntry(name, { recursive: true }); } catch {}
        done++;
        if (onProgress) { try { onProgress(done, names.length); } catch {} }
      }
    }));
  },

  async sweepTemp() {
    const stale = Date.now() - 3600000;
    const sweepDir = async dir => {
      const staleNames = [];
      for await (const [name, h] of dir.entries()) {
        if (h.kind !== 'file' || !name.startsWith('.') || !name.endsWith('.tmp')) continue;
        try {
          const f = await h.getFile();
          if (f.lastModified < stale) staleNames.push(name);
        } catch {}
      }
      for (const name of staleNames) {
        try { await dir.removeEntry(name); } catch {}
      }
    };
    const sweepTree = async dir => {
      await sweepDir(dir);
      for await (const [, h] of dir.entries()) {
        if (h.kind !== 'directory') continue;
        await sweepTree(h);
      }
    };
    try { await Storage._withRootRetry(root => sweepTree(root)); } catch {}
  }
};
