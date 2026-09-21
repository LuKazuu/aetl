// AETL - Plugin runtime: lifecycle, hooks, importers/exporters, settings
'use strict';

let host = null;
let ui = null;

const Runtime = {
  _index: [],
  _instances: new Map(),
  _sigCache: new WeakMap(),
  _hooks: new Map(),
  _importers: new Map(),
  _exporters: new Map(),
  _shortcuts: new Map(),
  _toolbarButtons: [],
  _dashboardCards: [],
  _styles: new Map(),

  listMeta() { return Runtime._index.slice(); },
  getMeta(id) { return Runtime._index.find(p => p.id === id) || null; },

  hook(name, fn, inst) {
    if (typeof name !== 'string' || !name || typeof fn !== 'function') return null;
    if (!Runtime._hooks.has(name)) Runtime._hooks.set(name, []);
    const entry = { fn, inst: inst || null };
    Runtime._hooks.get(name).push(entry);
    return { name, entry };
  },

  unhook(token) {
    if (!token || typeof token !== 'object') return;
    const arr = Runtime._hooks.get(token.name);
    if (!arr) return;
    const i = arr.indexOf(token.entry);
    if (i >= 0) arr.splice(i, 1);
  },

  async runHooks(name, ...args) {
    const arr = Runtime._hooks.get(name);
    if (!arr || !arr.length) return args;
    for (const entry of arr.slice()) {
      try {
        const r = await entry.fn(...args);
        if (r !== undefined) args[0] = r;
      } catch (e) { Runtime._fail(entry.inst?.meta, e); }
    }
    return args;
  },

  runHooksSync(name, value, ...rest) {
    const arr = Runtime._hooks.get(name);
    if (!arr || !arr.length) return value;
    for (const entry of arr.slice()) {
      try {
        const r = entry.fn(value, ...rest);
        if (r !== undefined) value = r;
      } catch (e) { Runtime._fail(entry.inst?.meta, e); }
    }
    return value;
  },

  clearHooksFor(inst) {
    for (const [name, arr] of Runtime._hooks) {
      Runtime._hooks.set(name, arr.filter(e => e.inst !== inst));
    }
  },

  registerImporter(name, handler, inst) {
    if (typeof name !== 'string' || !name || typeof handler !== 'function') return null;
    Runtime._importers.set(name, { handler, inst });
    host.ui.onPluginsChanged();
    return name;
  },

  unregisterImporter(name) {
    if (Runtime._importers.delete(name)) host.ui.onPluginsChanged();
  },

  registerExporter(name, handler, inst) {
    if (typeof name !== 'string' || !name || typeof handler !== 'function') return null;
    Runtime._exporters.set(name, { handler, inst });
    host.ui.onPluginsChanged();
    return name;
  },

  unregisterExporter(name) {
    if (Runtime._exporters.delete(name)) host.ui.onPluginsChanged();
  },

  listImporters() { return Array.from(Runtime._importers.keys()); },
  getImporter(name) { return Runtime._importers.get(name) || null; },

  listExporters() { return Array.from(Runtime._exporters.keys()); },
  getExporter(name) { return Runtime._exporters.get(name) || null; },

  registerShortcut(id, label, combo, handler, opts, inst) {
    if (typeof id !== 'string' || !id || typeof handler !== 'function') return null;
    Runtime._shortcuts.set(id, { id, label, combo: combo || '', handler, opts: opts || {}, inst });
    host.ui.rebuildShortcuts();
    return id;
  },

  unregisterShortcut(id) {
    if (Runtime._shortcuts.delete(id)) host.ui.rebuildShortcuts();
  },

  listPluginShortcuts() {
    return Array.from(Runtime._shortcuts.values());
  },

  addToolbarButton(label, onClick, opts, inst) {
    const btn = host.ui.addToolbarButton(label, onClick, opts);
    if (btn) Runtime._toolbarButtons.push({ btn, inst });
    return btn;
  },

  removeToolbarButton(btn) {
    host.ui.removeToolbarButton(btn);
    const i = Runtime._toolbarButtons.findIndex(e => e.btn === btn);
    if (i >= 0) Runtime._toolbarButtons.splice(i, 1);
  },

  clearToolbarButtonsFor(inst) {
    for (let i = Runtime._toolbarButtons.length - 1; i >= 0; i--) {
      if (Runtime._toolbarButtons[i].inst === inst) {
        host.ui.removeToolbarButton(Runtime._toolbarButtons[i].btn);
        Runtime._toolbarButtons.splice(i, 1);
      }
    }
  },

  createModal(title, bodyHtml, opts, inst) {
    const modal = host.ui.createModal(title, bodyHtml, opts);
    if (modal && inst) {
      if (!inst.modals) inst.modals = [];
      inst.modals.push(modal);
    }
    return modal;
  },

  closeModal(modal) {
    if (!modal) return;
    host.ui.closeModal(modal);
  },

  addDashboardCard(cardEl, inst) {
    const ok = host.ui.addDashboardCard(cardEl);
    if (ok) Runtime._dashboardCards.push({ card: cardEl, inst });
    return ok ? cardEl : null;
  },

  removeDashboardCard(cardEl) {
    host.ui.removeDashboardCard(cardEl);
    const i = Runtime._dashboardCards.findIndex(e => e.card === cardEl);
    if (i >= 0) Runtime._dashboardCards.splice(i, 1);
  },

  clearDashboardCardsFor(inst) {
    for (let i = Runtime._dashboardCards.length - 1; i >= 0; i--) {
      if (Runtime._dashboardCards[i].inst === inst) {
        host.ui.removeDashboardCard(Runtime._dashboardCards[i].card);
        Runtime._dashboardCards.splice(i, 1);
      }
    }
  },

  setTheme(vars) {
    host.ui.setTheme(vars);
  },

  injectStyle(css, id, inst) {
    const existing = id ? Runtime._styles.get(id) : null;
    if (existing) {
      existing.el.textContent = css;
      existing.inst = inst;
      return existing.el;
    }
    const el = host.ui.injectStyle(css, id);
    if (el && id) Runtime._styles.set(id, { el, inst });
    return el;
  },

  removeStyle(id) {
    const entry = Runtime._styles.get(id);
    if (entry) { entry.el.remove(); Runtime._styles.delete(id); }
  },

  clearStylesFor(inst) {
    for (const [id, entry] of Runtime._styles) {
      if (entry.inst === inst) { entry.el.remove(); Runtime._styles.delete(id); }
    }
  },

  async persistPluginIndex() { await host.storage.writePluginIndex(Runtime._index); },

  async loadGlobalPluginSettings() {
    const raw = await host.storage.readGlobalPluginSettings();
    const store = isPlainObject(raw) ? raw : {};
    for (const k of Object.keys(store)) {
      if (!isPlainObject(store[k])) delete store[k];
    }
    Runtime._store = store;
  },

  async saveGlobalPluginSettings() {
    try { await host.storage.writeGlobalPluginSettings(Runtime._store); }
    catch (e) { console.error('[plugins] failed to save settings:', e); }
  },

  async init() {
    await Runtime.loadGlobalPluginSettings();
    const raw = await host.storage.readPluginIndex();
    const list = Array.isArray(raw) ? raw : [];
    const valid = [];
    const dropped = [];
    for (const p of list) {
      if (!p || typeof p.id !== 'string' || !Array.isArray(p.files)) {
        dropped.push(p?.id || '<unknown>');
        continue;
      }
      valid.push(p);
    }
    if (dropped.length) {
      console.warn(`[plugins] dropped ${dropped.length} plugin(s) with invalid metadata: ${dropped.join(', ')}.`);
    }
    Runtime._index = valid;
    await Runtime._sweepOrphanPacks();
    if (dropped.length) await Runtime.persistPluginIndex();
    await Runtime.sync();
    let dirty = false;
    for (const meta of Runtime._index) {
      if (meta.enabled !== true) continue;
      try { await Runtime.activatePlugin(meta); }
      catch (e) {
        console.error(`[plugin:${meta.id}] failed to activate:`, e);
        meta.enabled = false;
        dirty = true;
      }
    }
    if (dirty) await Runtime.persistPluginIndex();
    host.ui.onPluginsChanged();
  },

  async sync() {
    let changed = false;
    const alive = [];
    for (const meta of Runtime._index) {
      try {
        const exists = await host.storage.pluginInstalled(meta.id);
        if (exists) alive.push(meta);
        else { await Runtime.deactivatePlugin(meta.id); changed = true; }
      } catch {
        await Runtime.deactivatePlugin(meta.id);
        changed = true;
      }
    }
    if (!changed) return false;
    Runtime._index = alive;
    await Runtime.persistPluginIndex();
    host.ui.onPluginsChanged();
    return true;
  },

  async _sweepOrphanPacks() {
    const ids = await host.storage.listInstalledPluginIds();
    const installed = new Set(Runtime._index.map(p => p.id));
    for (const id of ids) {
      if (installed.has(id)) continue;
      await host.storage.deletePlugin(id);
    }
  },

  projectSettingsFor(meta) {
    const vals = host.state.pluginSettings();
    const v = (vals && typeof vals === 'object' && vals[meta.id]) ? vals[meta.id] : {};
    const out = {};
    for (const s of (meta.settings?.project || [])) out[s.key] = (s.key in v) ? v[s.key] : s.default;
    return out;
  },

  globalSettingsFor(meta) {
    const v = isPlainObject(Runtime._store[meta.id]) ? Runtime._store[meta.id] : {};
    const out = {};
    for (const s of (meta.settings?.global || [])) out[s.key] = (s.key in v) ? v[s.key] : s.default;
    return out;
  },

  setProjectPluginSettings(id, values) {
    const next = { ...(host.state.pluginSettings() || {}) };
    if (isPlainObject(values) && Object.keys(values).length) next[id] = values;
    else delete next[id];
    host.state.setPluginSettings(next);
    host.state.queueSave();
    Runtime.syncSettings();
  },

  setGlobalPluginSettings(id, values) {
    if (isPlainObject(values) && Object.keys(values).length) Runtime._store[id] = values;
    else delete Runtime._store[id];
    Runtime.saveGlobalPluginSettings();
    Runtime.syncSettings();
  },

  syncSettings() {
    for (const inst of Runtime._instances.values()) {
      if (typeof inst.onSettings === 'function') {
        try {
          inst.onSettings({
            settings: Runtime.projectSettingsFor(inst.meta),
            globalSettings: Runtime.globalSettingsFor(inst.meta)
          });
        } catch (e) { Runtime._fail(inst.meta, e); }
      }
    }
  },

  async activatePlugin(meta) {
    if (Runtime._instances.has(meta.id)) return;
    const code = await host.storage.readPluginCode(meta.id);

    host.util.progress.show('Loading plugin...', `Activating "${meta.name}"...`);
    let inst;
    try {
      const factory = new Function('module', 'exports', 'AETL', 'document', 'window',
        '"use strict";\n' + code + '\n;return module.exports;');
      const mod = { exports: {} };
      const pluginObj = factory(mod, mod.exports, AETL, document, window);
      if (!pluginObj || typeof pluginObj !== 'object') throw new Error("Plugin doesn't export an object (module.exports).");

      inst = {
        meta,
        pluginObj,
        aborts: new Set(),
        menuItems: [],
        settingsSections: [],
        panelCard: null,
        panelBody: null,
        listeners: new Map(),
        onSettings: typeof pluginObj.onSettings === 'function' ? pluginObj.onSettings.bind(pluginObj) : null,
        hasExtract: typeof pluginObj.extract === 'function',
        hasPack: typeof pluginObj.pack === 'function',
        hasPanel: typeof pluginObj.panel === 'function',
        hasOnCopy: typeof pluginObj.onCopy === 'function',
        hasOnApply: typeof pluginObj.onApply === 'function',
      };

      const api = Runtime._buildApi(inst);
      inst.api = api;

      if (typeof pluginObj.activate === 'function') {
        Runtime._instances.set(meta.id, inst);
        try {
          await pluginObj.activate.call(pluginObj, api);
        } catch (e) {
          Runtime._instances.delete(meta.id);
          throw e;
        }
      } else {
        Runtime._instances.set(meta.id, inst);
      }

      if (meta.ui && inst.hasPanel) {
        const panelHostEl = PluginUI.panelHost(meta);
        if (panelHostEl) {
          PluginUI.wirePanel(inst, panelHostEl);
        }
      }
    } catch (e) {
      if (inst) {
        await Runtime.deactivatePlugin(meta.id);
      }
      host.util.progress.hide();
      throw e;
    }
    host.util.progress.hide();
    Runtime.syncSettings();
  },

  async deactivatePlugin(id) {
    const inst = Runtime._instances.get(id);
    if (!inst) return;
    Runtime._instances.delete(id);
    try {
      if (typeof inst.pluginObj.deactivate === 'function') {
        await inst.pluginObj.deactivate.call(inst.pluginObj);
      }
    } catch (e) { console.error(`[plugin:${id}] deactivate error:`, e); }
    inst.listeners.clear();
    for (const ctrl of inst.aborts) { try { ctrl.abort(); } catch {} }
    inst.aborts.clear();
    for (const el of inst.menuItems) { try { host.ui.removeMenuItem(el); } catch {} }
    inst.menuItems.length = 0;
    for (const entry of inst.settingsSections) { try { host.ui.removeSettingsSection(entry); } catch {} }
    inst.settingsSections.length = 0;
    if (inst.panelCard) { try { inst.panelCard.remove(); } catch {} }
    if (inst.modals) { for (const m of inst.modals) { try { host.ui.closeModal(m); } catch {} } inst.modals.length = 0; }
    Runtime.clearHooksFor(inst);
    Runtime.clearToolbarButtonsFor(inst);
    Runtime.clearDashboardCardsFor(inst);
    Runtime.clearStylesFor(inst);
    for (const [name, entry] of Runtime._importers) if (entry.inst === inst) Runtime._importers.delete(name);
    for (const [name, entry] of Runtime._exporters) if (entry.inst === inst) Runtime._exporters.delete(name);
    for (const [sid, entry] of Runtime._shortcuts) if (entry.inst === inst) { Runtime._shortcuts.delete(sid); }
    host.ui.rebuildShortcuts();
    host.ui.onPluginsChanged();
  },

  async setEnabled(id, enabled) {
    const meta = Runtime.getMeta(id);
    if (!meta) return false;
    if (enabled) {
      try { await Runtime.activatePlugin(meta); }
      catch (e) {
        await Dialogs.info("Couldn't activate plugin", `<p class="hint m-0">${esc(`Plugin "${meta.name}" failed to activate.`)}</p><p class="mono aetl-err-detail">${esc(e?.message || String(e))}</p>`);
        PluginUI.renderList();
        return false;
      }
    } else {
      await Runtime.deactivatePlugin(id);
    }
    meta.enabled = !!enabled;
    await Runtime.persistPluginIndex();
    host.ui.onPluginsChanged();
    return true;
  },

  async install(file) {
    if (!file || typeof file.slice !== 'function' || typeof file.stream !== 'function' || typeof file.arrayBuffer !== 'function') throw new Error('Invalid plugin file.');
    const name = String(file.name || '');
    if (!/\.zip$/i.test(name)) throw new Error('Plugins must be .zip files with manifest.json and plugin.js at the root.');

    host.util.progress.show('Checking plugin package...', 'Reading manifest.json...');

    let meta, manifestText, pluginCode, assetFiles;
    try {
      const zip = await ZipReader.open(file).catch(() => { throw new Error('Invalid or corrupted .zip file.'); });
      if (!zip.has(MANIFEST_FILE)) {
        throw new Error(`${MANIFEST_FILE} not found at package root. Standard structure: .zip containing ${MANIFEST_FILE} + ${ENTRY_FILE}.`);
      }
      manifestText = await zip.readText(MANIFEST_FILE);

      const parsed = Manifest.parse(manifestText);
      if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
      const errors = Manifest.validate(parsed.data);
      if (errors.length) throw new Error('Invalid manifest:\n- ' + errors.join('\n- '));
      const manifest = parsed.data;

      if (!zip.has(ENTRY_FILE)) throw new Error(`${ENTRY_FILE} not found at package root. It is required as the entry point.`);
      pluginCode = await zip.readText(ENTRY_FILE);

      const assetNames = zip.names().filter(nm => nm !== MANIFEST_FILE && nm !== ENTRY_FILE).sort();
      assetFiles = [];
      for (const nm of assetNames) {
        assetFiles.push([nm, await zip.readBytes(nm)]);
      }

      const fingerprint = await sha256HexOfBlob(file);
      meta = Manifest.normalize(manifest, assetNames, {
        fingerprint,
        size: file.size,
        updatedAt: Date.now()
      });
    } finally {
      host.util.progress.hide();
    }

    const existing = Runtime.getMeta(meta.id);

    host.util.progress.show('Installing plugin...', 'Extracting files...');
    try {
      await host.storage.installPluginFiles(meta.id, manifestText, pluginCode, assetFiles);
      meta.enabled = existing ? existing.enabled === true : true;
      const i = Runtime._index.findIndex(p => p.id === meta.id);
      if (i >= 0) Runtime._index[i] = meta; else Runtime._index.push(meta);

      await Runtime.deactivatePlugin(meta.id);
      if (meta.enabled) {
        try {
          await Runtime.activatePlugin(meta);
        } catch (e) {
          meta.enabled = false;
          host.ui.flash(`Plugin "${meta.name}" failed to activate: ${e?.message || e}`);
        }
      }
      await Runtime.persistPluginIndex();
      host.ui.onPluginsChanged();
      if (existing) host.ui.flash(`Plugin "${meta.name}" updated to v${meta.version}.`);
      return meta;
    } finally {
      host.util.progress.hide();
    }
  },

  async uninstall(id) {
    const meta = Runtime.getMeta(id);
    if (!meta) throw new Error('Plugin not found.');
    const linked = (await host.storage.listProjects()).filter(p => p.projectType === 'plugin' && p.pluginId === id);
    const linkedNote = linked.length
      ? `<p>${linked.length} linked project(s) remain saved with their data. Just reinstall this plugin to reopen them. Data is only deleted when the project is deleted.</p>`
      : '';
    const ok = await Dialogs.confirm({
      title: 'Delete plugin?',
      danger: true,
      confirmLabel: 'Delete',
      bodyHtml: `<p>Plugin <strong>${esc(meta.name)}</strong> v${esc(meta.version)} will be deleted.</p>${linkedNote}`
    });
    if (!ok) return false;

    await Runtime.deactivatePlugin(id);
    for (const p of linked) {
      try {
        const data = await host.storage.loadProject(p.id);
        if (data && !data.pluginName) {
          data.pluginName = meta.name;
          await host.storage.saveProject(p.id, data);
        }
      } catch (e) {
        console.error(`[plugin:${id}] failed to preserve pluginName for project ${p.id}:`, e);
      }
    }
    await host.storage.deletePlugin(id);
    delete Runtime._store[id];
    await Runtime.saveGlobalPluginSettings();
    Runtime._index = Runtime._index.filter(p => p.id !== id);
    await Runtime.persistPluginIndex();
    host.ui.onPluginsChanged();
    return true;
  },

  _buildApi(inst) {
    const meta = inst.meta;
    const api = {
      version: PLUGIN_VERSION,
      pluginId: meta.id,
      get settings() { return Runtime.projectSettingsFor(meta); },
      get globalSettings() { return Runtime.globalSettingsFor(meta); },

      getProject: () => host.state.projectInfo(),
      getLines: () => host.state.lines().map(Runtime.toPluginLine),
      getSelection: () => host.state.selection(),
      selectRange: (from, to) => {
        const f = Number(from), t = Number(to);
        if (!Number.isInteger(f) || !Number.isInteger(t) || f < 1 || t < f) throw new Error('Invalid line range.');
        host.state.selectRangeUI(f, t);
      },
      clearSelection: () => host.state.clearSelection(),
      copySelection: () => host.state.copyForAi(),

      listAssets: () => meta.files.slice(),
      asset: async path => host.storage.readPluginAssetBytes(meta.id, String(path ?? '')),
      assetText: async path => host.storage.readPluginAssetText(meta.id, String(path ?? '')),

      toast: msg => host.ui.flash(String(msg ?? '')),
      copy: text => host.util.clipboard(String(text ?? '')),
      pickFile: accept => Runtime.pickFile(accept),
      download: (data, filename) => Runtime.download(data, filename),
      fetch: (url, opts) => NetRunner.fetch(url, opts, inst),

      get JSZip() { return window.JSZip; },
      get gpu() { return navigator.gpu; },
      wasm: (source, imports) => WasmRunner.instantiate(source, imports),

      saveData: (key, data) => {
        if (!validDataKey(key)) throw new Error('Invalid data key.');
        if (!host.state.projectId()) throw new Error('Open a project first to save data.');
        return host.storage.savePluginData(meta.id, key, data);
      },
      loadData: key => {
        if (!validDataKey(key)) return null;
        if (!host.state.projectId()) return null;
        return host.storage.loadPluginData(meta.id, key);
      },
      deleteData: key => {
        if (!validDataKey(key)) return;
        if (!host.state.projectId()) return;
        return host.storage.deletePluginData(meta.id, key);
      },
      listData: () => {
        if (!host.state.projectId()) return [];
        return host.storage.listPluginData(meta.id);
      },
      dataExists: key => {
        if (!validDataKey(key)) return false;
        if (!host.state.projectId()) return false;
        return host.storage.pluginDataExists(meta.id, key);
      },

      decode: (buf, encodings) => {
        const bytes = buf instanceof Uint8Array ? buf : buf instanceof ArrayBuffer ? new Uint8Array(buf) : null;
        if (!bytes) throw new Error('decode accepts Uint8Array or ArrayBuffer.');
        const encs = Array.isArray(encodings) && encodings.length ? encodings : ['utf-8', 'shift_jis', 'windows-31j', 'cp932'];
        for (const enc of encs) {
          try { return new TextDecoder(enc, { fatal: true }).decode(bytes); } catch {}
        }
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      },

      addMenuItem: (menu, label, onClick) => {
        const el = host.ui.addMenuItem(menu, label, onClick);
        inst.menuItems.push(el);
        return el;
      },
      removeMenuItem: el => {
        host.ui.removeMenuItem(el);
        const i = inst.menuItems.indexOf(el);
        if (i >= 0) inst.menuItems.splice(i, 1);
      },
      addSettingsSection: (target, title, hooks) => {
        const entry = host.ui.addSettingsSection(target, title, hooks);
        inst.settingsSections.push(entry);
        return entry;
      },
      removeSettingsSection: entry => {
        host.ui.removeSettingsSection(entry);
        const i = inst.settingsSections.indexOf(entry);
        if (i >= 0) inst.settingsSections.splice(i, 1);
      },
      ui: name => host.ui.getRegion(name),

      on: (event, handler) => Runtime._subscribe(inst, event, handler),
      off: token => Runtime._unsubscribe(inst, token),
      emit: (event, payload) => Runtime.emit(event, payload),

      hook: (name, fn) => Runtime.hook(name, fn, inst),
      unhook: token => Runtime.unhook(token),

      registerImporter: (name, handler) => Runtime.registerImporter(name, handler, inst),
      unregisterImporter: name => Runtime.unregisterImporter(name),
      registerExporter: (name, handler) => Runtime.registerExporter(name, handler, inst),
      unregisterExporter: name => Runtime.unregisterExporter(name),

      registerShortcut: (id, label, combo, handler, opts) => Runtime.registerShortcut(id, label, combo, handler, opts, inst),
      unregisterShortcut: id => Runtime.unregisterShortcut(id),

      addToolbarButton: (label, onClick, opts) => Runtime.addToolbarButton(label, onClick, opts, inst),
      removeToolbarButton: btn => Runtime.removeToolbarButton(btn),

      createModal: (title, bodyHtml, opts) => Runtime.createModal(title, bodyHtml, opts, inst),
      closeModal: modal => Runtime.closeModal(modal),

      addDashboardCard: cardEl => Runtime.addDashboardCard(cardEl, inst),
      removeDashboardCard: cardEl => Runtime.removeDashboardCard(cardEl),

      setTheme: vars => Runtime.setTheme(vars),
      injectStyle: (css, id) => Runtime.injectStyle(css, id, inst),
      removeStyle: id => Runtime.removeStyle(id),

      getState: () => host.state.snapshot(),
      getStorage: () => host.storage.root(),
      getPluginMeta: () => ({ ...meta }),

      getLine: num => {
        const l = host.state.lineByNum(num);
        return l ? Runtime.toPluginLine(l) : null;
      },
      updateLine: (num, changes) => host.state.updateLine(num, changes),
      addLine: line => host.state.addLine(line),
      removeLine: num => host.state.removeLine(num),
      markTranslated: (num, transMsg, transName) => host.state.markTranslated(num, transMsg, transName),

      prompt: (title, def) => host.ui.prompt(title, def),
      confirm: (title, body) => host.ui.confirm(title, body),
      alert: (title, body) => host.ui.alert(title, body),

      abort: () => {
        for (const ctrl of inst.aborts) { try { ctrl.abort(); } catch {} }
        inst.aborts.clear();
      }
    };
    return api;
  },

  _subscribe(inst, event, handler) {
    if (typeof event !== 'string' || !event || typeof handler !== 'function') return null;
    if (!inst.listeners.has(event)) inst.listeners.set(event, new Set());
    inst.listeners.get(event).add(handler);
    return { event, handler };
  },

  _unsubscribe(inst, token) {
    if (!token || typeof token !== 'object') return;
    const set = inst.listeners.get(token.event);
    if (set) set.delete(token.handler);
  },

  pickFile(accept) {
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';
      if (accept && typeof accept === 'string') inp.accept = accept;
      inp.style.display = 'none';
      document.body.appendChild(inp);
      let settled = false;
      const finish = val => {
        if (settled) return;
        settled = true;
        inp.remove();
        resolve(val);
      };
      inp.addEventListener('change', async () => {
        const f = inp.files && inp.files[0];
        if (!f) return finish(null);
        try { finish({ name: f.name, buffer: await f.arrayBuffer() }); }
        catch { finish(null); }
      });
      inp.addEventListener('cancel', () => finish(null));
      inp.click();
    });
  },

  download(data, filename) {
    let blob = data instanceof Blob ? data : null;
    if (!blob) {
      const body = (data instanceof Uint8Array || data instanceof ArrayBuffer) ? data : String(data ?? '');
      blob = new Blob([body], { type: 'application/octet-stream' });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeName(filename, { stripTrailing: false, fallback: 'download' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), PLUGIN_CFG.delay.revokeUrlMs);
  },

  resolveByExtension(fileName) {
    const name = String(fileName || '');
    const dot = name.lastIndexOf('.');
    if (dot < 0) return null;
    const ext = name.slice(dot).toLowerCase();
    return Runtime._index.find(p => p.enabled === true && (p.extensions || []).some(e => String(e).toLowerCase() === ext)) || null;
  },

  resolveByMagic(head) {
    if (!(head instanceof Uint8Array) || !head.length) return null;
    for (const p of Runtime._index) {
      if (p.enabled !== true || !(p.magic || []).length) continue;
      let sigs = Runtime._sigCache.get(p);
      if (!sigs) {
        sigs = p.magic.map(raw => {
          const bytes = new Uint8Array(raw.hex.length / 2);
          for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(raw.hex.slice(i * 2, i * 2 + 2), 16);
          return { bytes, offset: raw.offset || 0 };
        });
        Runtime._sigCache.set(p, sigs);
      }
      for (const sig of sigs) {
        if (sig.offset + sig.bytes.length <= head.length && sig.bytes.every((b, i) => head[sig.offset + i] === b)) return p;
      }
    }
    return null;
  },

  activeParserInfo() {
    const exts = new Set(BUILTIN_EXTENSIONS);
    let magic = false;
    for (const p of Runtime._index) {
      if (p.enabled !== true) continue;
      for (const e of (p.extensions || [])) exts.add(String(e).toLowerCase());
      if ((p.magic || []).length) magic = true;
    }
    return { extensions: exts, magic };
  },

  _hookCtx() {
    const info = host.state.projectInfo();
    return {
      projectName: info?.name || null,
      lineCount: info?.lineCount || 0,
      translatedCount: info?.translatedCount || 0,
      selectedLines: host.state.selection()
    };
  },

  async runCopyHook(text) {
    let out = text;
    for (const inst of Runtime._instances.values()) {
      if (!inst.hasOnCopy) continue;
      try {
        const r = await inst.pluginObj.onCopy.call(inst.pluginObj, out, Runtime._hookCtx());
        if (typeof r === 'string') out = r;
      } catch (e) { Runtime._fail(inst.meta, e); }
    }
    return out;
  },

  async runApplyHook(text) {
    let out = text;
    for (const inst of Runtime._instances.values()) {
      if (!inst.hasOnApply) continue;
      try {
        const r = await inst.pluginObj.onApply.call(inst.pluginObj, out, Runtime._hookCtx());
        if (typeof r === 'string') out = r;
      } catch (e) { Runtime._fail(inst.meta, e); }
    }
    return out;
  },

  emit(event, payload) {
    for (const inst of Runtime._instances.values()) {
      const set = inst.listeners.get(event);
      if (!set) continue;
      for (const handler of set) {
        try { handler(payload); } catch (e) { Runtime._fail(inst.meta, e); }
      }
    }
  },

  async callExtract(meta, input) {
    const inst = Runtime._instances.get(meta.id);
    if (!inst) throw new Error(`Plugin "${meta.name}" isn't active.`);
    if (!inst.hasExtract) throw new Error(`Plugin "${meta.name}" doesn't support extract.`);
    const out = await inst.pluginObj.extract.call(inst.pluginObj, {
      fileName: input.fileName,
      buffer: input.buffer,
      settings: Runtime.projectSettingsFor(meta),
      globalSettings: Runtime.globalSettingsFor(meta),
      api: inst.api
    });
    if (!out || !Array.isArray(out.lines)) throw new Error(`Plugin "${meta.name}" didn't return a lines array.`);
    return out;
  },

  async callPack(meta, input) {
    const inst = Runtime._instances.get(meta.id);
    if (!inst) throw new Error(`Plugin "${meta.name}" isn't active.`);
    if (!inst.hasPack) throw new Error(`Plugin "${meta.name}" doesn't support pack.`);
    const out = await inst.pluginObj.pack.call(inst.pluginObj, {
      lines: input.lines,
      sourceMap: input.sourceMap,
      projectName: input.projectName,
      settings: Runtime.projectSettingsFor(meta),
      globalSettings: Runtime.globalSettingsFor(meta),
      api: inst.api
    });
    if (!out || !(out.blob instanceof Blob)) throw new Error(`Plugin "${meta.name}" didn't return a valid blob.`);
    return out;
  },

  normalizePluginLines(raw, startNum) {
    const out = [];
    let n = startNum;
    for (const l of (raw || [])) {
      if (!l || typeof l !== 'object') continue;
      const msg = String(l.message ?? '').trim();
      if (!msg) continue;
      out.push({
        line_num: n++,
        file: String(l.file || ''),
        name: l.name == null ? null : stripNewlines(l.name),
        message: msg.replace(/\r?\n/g, '\\n').trim(),
        trans_name: null,
        trans_message: null,
        is_translated: false,
        _n: 1
      });
    }
    return out;
  },

  toPluginLine(l) {
    return {
      line_num: l.line_num,
      file: l.file,
      name: l.name,
      message: l.message,
      trans_name: l.trans_name,
      trans_message: l.trans_message,
      is_translated: !!l.is_translated
    };
  },

  onProjectOpened() {
    Runtime.syncSettings();
    host.ui.onPluginsChanged();
    const info = host.state.projectInfo();
    Runtime.emit('projectOpen', info ? {
      name: info.name, type: info.type, lineCount: info.lineCount, translatedCount: info.translatedCount
    } : null);
  },

  onProjectClosed() {
    Runtime.emit('projectClose', null);
    Runtime.syncSettings();
    host.ui.onPluginsChanged();
  },

  _fail(meta, e) {
    console.error(`[plugin:${meta?.id || '?'}]`, e);
    host.ui.flash(`Plugin "${meta?.name || '?'}" error: ${e?.message || e}`);
  }
};

