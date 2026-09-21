// AETL - File export flow
'use strict';

const Exporter = {
  async _runJsonExport(label, suffix, forceOriginal, keepIf, filterCheck, emptyMsg, emitMode) {
    if (!State.lines.length) return;
    if (filterCheck && !State.lines.some(filterCheck)) { App.flash(emptyMsg, true, 'error'); return; }
    await withProgress(`Creating ${label.toLowerCase()}...`, 'Grouping lines...', async () => {
      Progress.determinate(`Creating ${label}`, `0 file`);
      const result = await buildExportJson(State.lines, State.projectName, Progress.update, suffix, forceOriginal, keepIf);
      download(URL.createObjectURL(result.blob), result.name);
      App.flash(`${label} export successful!`);
      const payload = { filename: result.name };
      if (emitMode) payload.mode = emitMode;
      AETL.plugins.emit('export', payload);
    }, e => 'JSON export failed: ' + e.message);
  },

  async runEpub() {
    await withProgress('Creating EPUB...', 'Loading archive...', async () => {
      Progress.determinate('Creating EPUB', `0 file`);
      const result = await buildExportEpub(State.projectId, State.lines, State.epubTags || 'p', State.projectName, Progress.update);
      download(URL.createObjectURL(result.blob), result.name);
      App.flash('EPUB export successful!');
      AETL.plugins.emit('export', { filename: result.name });
    }, e => 'EPUB export failed: ' + e.message);
  },

  runJson() { return this._runJsonExport('JSON', 'export', false, null, null, null, null); },
  runTranslationJson() { return this._runJsonExport('translation', 'translation', false, isTrans, isTrans, 'No translated lines.', 'translation'); },
  runUntranslatedJson() { return this._runJsonExport('untranslated', 'untranslated', false, l => !isTrans(l), l => !isTrans(l), 'No untranslated lines.', 'untranslated'); },
  runOriginalJson() { return this._runJsonExport('original text', 'original', true, null, null, null, 'original'); },

  async runPlugin() {
    await withProgress('Creating file via plugin...', 'Loading plugin...', async () => {
      const meta = AETL.plugins.getMeta(State.pluginId);
      if (!meta) throw new Error('The plugin for this project is no longer installed. The project cannot be exported.');
      if (!meta.enabled) throw new Error('This plugin is disabled. Enable it in the Plugin Manager first.');
      const lines = State.lines.map(AETL.plugins.toPluginLine);
      const pluginData = (State.pluginData && typeof State.pluginData === 'object') ? State.pluginData : {};
      const settings = AETL.plugins.projectSettingsFor(meta);
      let cancelled = false;
      Progress.cancellableDeterminate('Plugin: Creating output', `0 file`, () => {
        cancelled = true;
        AETL.plugins.abort(meta);
      });
      let out;
      try {
        out = await AETL.plugins.callPack(meta, {
          lines,
          sourceMap: pluginData,
          projectName: State.projectName || 'untitled',
          settings
        });
      } catch (e) {
        if (cancelled) { App.flash('Export cancelled.'); return; }
        throw e;
      }
      const filename = out.filename || (sanitizeName(State.projectName) + '_tl' + (meta.extensions[0] || '.bin'));
      download(URL.createObjectURL(out.blob), filename);
      App.flash('Plugin export successful!');
      AETL.plugins.emit('export', { filename });
    }, e => 'Plugin export failed: ' + e.message);
  },

  async run() {
    if (!State.lines.length) return;
    const ctx = { projectType: State.projectType, cancel: false };
    await AETL.plugins.runHooks('beforeExport', ctx);
    if (ctx.cancel) return;
    if (State.projectType === 'epub' && State.epubSourceId) await Exporter.runEpub();
    else if (State.projectType === 'plugin' && State.pluginId) await Exporter.runPlugin();
    else await Exporter.runJson();
    await AETL.plugins.runHooks('afterExport', ctx);
  }
};

