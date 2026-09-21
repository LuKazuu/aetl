// AETL - Plugin host bridge (AETL.plugins)
'use strict';

const PluginHost = {
  storage: {
    readPluginIndex: () => Storage.readPluginIndex(),
    writePluginIndex: items => Storage.writePluginIndex(items),
    readGlobalPluginSettings: () => Storage.readGlobalPluginSettings(),
    writeGlobalPluginSettings: value => Storage.writeGlobalPluginSettings(value),
    installPluginFiles: (pluginId, manifestJson, pluginCode, assetFiles) => Storage.installPluginFiles(pluginId, manifestJson, pluginCode, assetFiles),
    readPluginCode: pluginId => Storage.readPluginCode(pluginId),
    readPluginAssetBytes: (pluginId, path) => Storage.readPluginAssetBytes(pluginId, path),
    readPluginAssetText: (pluginId, path) => Storage.readPluginAssetText(pluginId, path),
    pluginInstalled: pluginId => Storage.pluginInstalled(pluginId),
    deletePlugin: pluginId => Storage.deletePlugin(pluginId),
    listInstalledPluginIds: () => Storage.listInstalledPluginIds(),
    savePluginData: (pluginId, key, data) => Storage.savePluginData(State.projectId, pluginId, key, data),
    loadPluginData: (pluginId, key) => Storage.loadPluginData(State.projectId, pluginId, key),
    deletePluginData: (pluginId, key) => Storage.deletePluginData(State.projectId, pluginId, key),
    listPluginData: pluginId => Storage.listPluginData(State.projectId, pluginId),
    pluginDataExists: (pluginId, key) => Storage.pluginDataExists(State.projectId, pluginId, key),
    listProjects: () => Storage.listProjects(),
    loadProject: id => Storage.loadProject(id),
    saveProject: (id, data) => Storage.saveProject(id, data),
    root: () => Storage.root()
  },

  state: {
    projectId: () => State.projectId,
    projectName: () => State.projectName,
    pluginSettings: () => State.pluginSettings,
    setPluginSettings: v => { State.pluginSettings = v; },
    queueSave: () => State.queueSave(),
    projectInfo: () => State.projectId ? {
      name: State.projectName,
      type: State.projectType,
      fileCount: State.files.length,
      lineCount: State.lines.length,
      translatedCount: State.translatedCount
    } : null,
    lines: () => State.lines,
    selection: () => Array.from(State.selected),
    clearSelection: () => { State.selected.clear(); App.syncCheckboxes(); },
    selectRangeUI: (from, to) => { els.rangeFromInput.value = from; els.rangeToInput.value = to; App.selectRange(); },
    copyForAi: () => App.copyForAi(),
    snapshot: () => ({
      projectId: State.projectId,
      projectName: State.projectName,
      projectType: State.projectType,
      pluginId: State.pluginId,
      files: State.files.slice(),
      lineCount: State.lines.length,
      translatedCount: State.translatedCount,
      selected: Array.from(State.selected),
      bookmarks: State.bookmarks.slice()
    }),
    lineByNum: num => State.byNum.get(num) || null,
    updateLine: (num, changes) => App.updateLineExternal(num, changes),
    addLine: line => App.addLineExternal(line),
    removeLine: num => App.removeLineExternal(num),
    markTranslated: (num, transMsg, transName) => App.markTranslatedExternal(num, transMsg, transName),
    selectLine: num => { State.selected.add(num); App.syncCheckboxes(); },
    toggleSelection: num => { if (State.selected.has(num)) State.selected.delete(num); else State.selected.add(num); App.syncCheckboxes(); },
    persist: () => State.persist()
  },

  ui: {
    flash: msg => App.flash(msg),
    onPluginsChanged: () => { App.syncImportAccept(); App.renderPluginMenuItems(); },
    onShortcutListMaybeRender: () => {
      if (els.shortcutModal.classList.contains('open')) App.renderShortcutList();
    },
    rebuildShortcuts: () => Shortcuts.rebuild(),
    loadDashboard: () => App.loadDashboard(),
    addMenuItem: (menu, label, onClick) => App.addPluginMenuItem(menu, label, onClick),
    removeMenuItem: btn => App.removePluginMenuItem(btn),
    addSettingsSection: (target, title, hooks) => App.addPluginSettingsSection(target, title, hooks),
    removeSettingsSection: entry => App.removePluginSettingsSection(entry),
    getRegion: name => App.pluginRegion(name),
    addToolbarButton: (label, onClick, opts) => App.addToolbarButton(label, onClick, opts),
    removeToolbarButton: btn => App.removeToolbarButton(btn),
    createModal: (title, bodyHtml, opts) => App.createModal(title, bodyHtml, opts),
    closeModal: modal => App.closeModal(modal),
    addDashboardCard: cardEl => App.addDashboardCard(cardEl),
    removeDashboardCard: cardEl => App.removeDashboardCard(cardEl),
    setTheme: vars => App.setTheme(vars),
    injectStyle: (css, id) => App.injectStyle(css, id),
    toggleBookmark: (num, force) => App.toggleBookmark(num, force),
    openLineEditor: num => App.openLineEditor(num),
    openImmersive: () => Immersive.open(),
    openModal: name => App.openModal(name),
    undo: () => App.undo(),
    redo: () => App.redo(),
    triggerExport: () => Exporter.run(),
    triggerImport: () => els.btnImportMain.click(),
    prompt: (title, def) => App.dialogPrompt(title, def),
    confirm: (title, body) => App.dialogConfirm(title, body),
    alert: (title, body) => App.dialogAlert(title, body)
  },

  util: {
    clipboard,
    progress: Progress
  }
};

document.addEventListener('DOMContentLoaded', App.init);

