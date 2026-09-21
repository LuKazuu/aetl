// AETL - Plugin UI: toolbar buttons, dashboard cards, panels, modals, styles
'use strict';

const PluginUI = {

  bind() {
    ui.btnPluginManagerOpen.addEventListener('click', PluginUI.openManager);
    ui.btnPluginManagerClose.addEventListener('click', PluginUI.closeManager);
    ui.btnPluginRefresh.addEventListener('click', async () => {
      await Runtime.sync();
      PluginUI.renderList();
      host.ui.flash('Plugin list reloaded.');
    });
    ui.btnInstallPlugin.addEventListener('click', () => ui.pluginFileInput.click());
    ui.pluginFileInput.addEventListener('change', async e => {
      if (!e.target.files.length) { e.target.value = ''; return; }
      try { await PluginUI.installFlow(e.target.files[0]); }
      finally { e.target.value = ''; }
    });

    const list = ui.pluginList;
    if (list) {
      list.addEventListener('dragover', e => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          list.classList.add('dragover');
        }
      });
      list.addEventListener('dragleave', e => {
        if (e.target === list) list.classList.remove('dragover');
      });
      list.addEventListener('drop', async e => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        list.classList.remove('dragover');
        for (const f of Array.from(e.dataTransfer.files)) {
          if (/\.zip$/i.test(f.name)) {
            await PluginUI.installFlow(f);
            break;
          }
        }
      });
    }
  },

  async openManager() {
    await Runtime.sync();
    ui.pluginManagerModal.classList.add('open');
    PluginUI.renderList();
  },

  closeManager() {
    ui.pluginManagerModal.classList.remove('open');
  },

  async installFlow(file) {
    try {
      const meta = await Runtime.install(file);
      if (!meta) return;
      PluginUI.renderList();
      host.ui.onShortcutListMaybeRender();
      host.ui.flash(`Plugin "${meta.name}" v${meta.version} ${meta.enabled ? 'active' : 'installed (disabled)'}.`);
    } catch (e) {
      await Dialogs.info("Couldn't install plugin",
        `<p class="hint m-0">${esc(e?.message || String(e))}</p>`);
    }
  },

  renderList() {
    const container = ui.pluginList;
    if (!container) return;
    const plugins = Runtime.listMeta();
    container.replaceChildren();
    if (!plugins.length) {
      container.innerHTML = `
        <div class="plugin-empty">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5h4.5a2.5 2.5 0 1 1 5 0H19v4.5a2.5 2.5 0 1 1 0 5V19h-4.5a2.5 2.5 0 1 0-5 0H5v-4.5a2.5 2.5 0 1 0 0-5z"/></svg>
          <span>No plugins installed yet.</span>
          <span class="plugin-empty-sub">Import the ZIP or drag it here.</span>
        </div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    for (const p of plugins) frag.appendChild(PluginUI.buildCard(p));
    container.appendChild(frag);
  },

  buildCard(p) {
    const row = document.createElement('div');
    row.className = 'plugin-row' + (p.enabled ? ' is-enabled' : '');

    const parserBadge = (p.extensions?.length || p.magic?.length)
      ? `<span class="plugin-badge plugin-badge-parser" title="Handles custom format import/export">Parser ${esc(p.extensions.join(' '))}${p.magic?.length ? ' +magic' : ''}</span>`
      : '';
    const panelBadge = p.ui ? '<span class="plugin-badge plugin-badge-panel" title="Provides a UI panel in the Tools panel">Panel</span>' : '';
    const totalSettings = (p.settings?.global?.length || 0) + (p.settings?.project?.length || 0);
    const settingsBadges = totalSettings
      ? `<span class="plugin-badge plugin-badge-settings" title="Settings available">Settings · ${totalSettings}</span>`
      : '';
    const assetsBadge = p.files.length
      ? `<span class="plugin-badge plugin-badge-package" title="${esc(p.files.join('\n'))}">Asset · ${p.files.length}</span>`
      : '';

    const detail = `
      <div class="plugin-detail">
        <div class="plugin-detail-grid">
          <div class="plugin-detail-grid-inner">
            <div>
              <div class="plugin-detail-label">Package info</div>
              <div class="plugin-detail-kv"><span>Manifest</span><span>v${esc(String(p.manifest_version))}</span></div>
              <div class="plugin-detail-kv"><span>Size</span><span>${esc(humanBytes(p.size))}</span></div>
              <div class="plugin-detail-kv"><span>Installed</span><span>${esc(new Date(p.updatedAt || Date.now()).toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span></div>
              ${p.fingerprint ? `<div class="plugin-detail-kv is-stack"><span>SHA-256</span><code class="plugin-detail-fp" title="Click to copy">${esc(p.fingerprint)}</code></div>` : ''}
            </div>
            <div>
              ${p.files.length ? `<div class="plugin-detail-label">Package files (${p.files.length})</div><div class="plugin-detail-files">${p.files.map(f => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
            </div>
          </div>
        </div>
      </div>`;

    row.innerHTML = `
      <div class="plugin-head">
        <div class="plugin-head-main">
          <span class="plugin-name">${esc(p.name)}</span>
          <span class="plugin-version">v${esc(p.version)}</span>
        </div>
        <label class="switch" title="${p.enabled ? 'Disable' : 'Enable'} plugin">
          <input type="checkbox" class="plugin-toggle" ${p.enabled ? 'checked' : ''} />
          <span class="switch-track"></span>
        </label>
      </div>
      ${p.author || p.description ? `
      <div class="plugin-meta">
        ${p.author ? `<span class="plugin-author">by ${esc(p.author)}</span>` : ''}
        ${p.description ? `<span class="plugin-desc-inline">${esc(p.description)}</span>` : ''}
      </div>` : ''}
      ${parserBadge || panelBadge || settingsBadges || assetsBadge ? `<div class="plugin-badges">${[parserBadge, panelBadge, settingsBadges, assetsBadge].filter(Boolean).join('')}</div>` : ''}
      <div class="plugin-actions">
        <button type="button" class="btn btn-ghost btn-xs btn-plugin-details" aria-expanded="false">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          Detail
        </button>
        <span class="grow"></span>
        ${(p.settings?.global?.length || (p.settings?.project?.length && host.state.projectId())) ? `<button type="button" class="btn btn-ghost btn-xs btn-plugin-settings" title="Plugin settings">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          Settings
        </button>` : ''}
        <button type="button" class="btn btn-ghost btn-xs btn-uninstall-plugin" title="Delete plugin">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1.4 14.1A2 2 0 0 1 15.6 22H8.4a2 2 0 0 1-2-1.9L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
          Delete
        </button>
      </div>
      ${detail}`;

    row.querySelector('.plugin-toggle').addEventListener('change', async e => {
      const ok = await Runtime.setEnabled(p.id, e.target.checked);
      if (ok) PluginUI.renderList();
      else e.target.checked = !e.target.checked;
    });

    row.querySelector('.btn-plugin-details').addEventListener('click', e => {
      const btn = e.currentTarget;
      const expanded = row.classList.toggle('show-detail');
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });

    row.querySelector('.btn-plugin-settings')?.addEventListener('click', () => {
      const scope = p.settings?.global?.length ? 'global' : 'project';
      PluginUI.openSettings(p, scope);
    });

    row.querySelector('.btn-uninstall-plugin').addEventListener('click', async () => {
      try {
        const ok = await Runtime.uninstall(p.id);
        if (ok) {
          row.classList.add('is-removing');
          setTimeout(() => {
            PluginUI.renderList();
            host.ui.loadDashboard();
            host.ui.onShortcutListMaybeRender();
            host.ui.flash(`Plugin "${p.name}" deleted.`);
          }, 280);
        }
      } catch (e) {
        await Dialogs.info("Couldn't delete plugin", `<p class="hint m-0">${esc(e?.message || String(e))}</p>`);
      }
    });

    row.querySelector('.plugin-detail-fp')?.addEventListener('click', async () => {
      try { await host.util.clipboard(p.fingerprint || ''); host.ui.flash('Fingerprint copied.'); } catch {}
    });

    return row;
  },

  panelHost(meta) {
    const wrap = ui.pluginPanels;
    if (!wrap) return null;
    const cfg = meta.ui || {};
    const card = document.createElement('div');
    card.className = 'plugin-panel-card open';
    card.dataset.pluginId = meta.id;
    card.innerHTML = `
      <button class="plugin-panel-head" type="button">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
        <span class="plugin-panel-title">${esc(cfg.title || meta.name)}</span>
        <svg class="plugin-panel-chevron" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div class="plugin-panel-body" style="--plugin-panel-height:${cfg.height || PLUGIN_CFG.panel.defaultHeight}px"></div>`;
    wrap.appendChild(card);
    return { card, body: card.querySelector('.plugin-panel-body') };
  },

  wirePanel(inst, hostEl) {
    inst.panelCard = hostEl.card;
    inst.panelBody = hostEl.body;
    hostEl.card.querySelector('.plugin-panel-head').addEventListener('click', () => {
      if (hostEl.card.classList.toggle('open')) PluginUI.panelShow(inst);
    });
    PluginUI.panelShow(inst);
  },

  panelShow(inst) {
    if (!inst.hasPanel || !inst.panelBody) return;
    try {
      inst.pluginObj.panel.call(inst.pluginObj, inst.panelBody, inst.api);
    } catch (e) { Runtime._fail(inst.meta, e); }
  },

  _fieldRow(meta, s, values) {
    const row = document.createElement('div');
    row.className = 'plugin-settings-row';
    const id = `pluginSetting_${meta.id}_${s.key}`;
    const cur = values[s.key];
    const type = s.type;
    let inputHtml;
    if (type === 'boolean') {
      inputHtml = `<label class="check-line"><input id="${id}" type="checkbox" ${cur ? 'checked' : ''}/> ${esc(s.label)}</label>`;
    } else if (type === 'select') {
      const opts = (s.options || []).map(o => `<option value="${esc(o.value)}" ${String(cur) === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
      inputHtml = `<select id="${id}" class="input w-full">${opts}</select>`;
    } else if (type === 'textarea') {
      inputHtml = `<textarea id="${id}" class="textarea w-full" rows="4" placeholder="${esc(s.placeholder || '')}">${esc(String(cur ?? ''))}</textarea>`;
    } else if (type === 'number') {
      inputHtml = `<input id="${id}" class="input w-full" type="number" value="${esc(String(cur ?? ''))}" ${s.min != null ? `min="${esc(String(s.min))}"` : ''} ${s.max != null ? `max="${esc(String(s.max))}"` : ''} ${s.step != null ? `step="${esc(String(s.step))}"` : ''}/>`;
    } else {
      inputHtml = `<input id="${id}" class="input w-full" type="text" value="${esc(String(cur ?? ''))}" placeholder="${esc(s.placeholder || '')}"/>`;
    }
    const descHtml = s.description ? `<span class="plugin-settings-desc">${esc(s.description)}</span>` : '';
    const labelHtml = type === 'boolean' ? '' : `<label for="${id}" class="plugin-settings-label">${esc(s.label)}${descHtml}</label>`;
    row.innerHTML = `<div class="plugin-settings-cell">${labelHtml}${inputHtml}${type === 'boolean' ? descHtml : ''}</div>`;
    return row;
  },

  _readFields(meta, fields) {
    const out = {};
    for (const s of fields) {
      const el = document.getElementById(`pluginSetting_${meta.id}_${s.key}`);
      if (!el) continue;
      if (s.type === 'boolean') out[s.key] = !!el.checked;
      else if (s.type === 'number') {
        if (el.value === '') out[s.key] = s.default;
        else { const n = Number(el.value); out[s.key] = Number.isFinite(n) ? n : s.default; }
      }
      else out[s.key] = el.value;
    }
    return out;
  },

  _resetFields(meta, fields) {
    for (const s of fields) {
      const el = document.getElementById(`pluginSetting_${meta.id}_${s.key}`);
      if (!el) continue;
      if (s.type === 'boolean') el.checked = !!s.default;
      else el.value = String(s.default ?? '');
    }
  },

  openSettings(meta, scope) {
    const ownFields = (scope === 'global') ? meta.settings?.global : meta.settings?.project;
    const hasOwn = Array.isArray(ownFields) && ownFields.length > 0;
    if (!hasOwn) {
      host.ui.flash("This plugin doesn't have settings.");
      return;
    }
    if (scope === 'project' && !host.state.projectId()) {
      host.ui.flash('Open a project first to change settings.');
      return;
    }
    const ownMerged = scope === 'global' ? Runtime.globalSettingsFor(meta) : Runtime.projectSettingsFor(meta);
    const form = document.createElement('div');
    form.className = 'plugin-settings-form';
    const ownWrap = document.createElement('div');
    ownWrap.className = 'plugin-settings-own';
    for (const s of ownFields) ownWrap.appendChild(PluginUI._fieldRow(meta, s, ownMerged));
    form.appendChild(ownWrap);

    const overlay = document.createElement('div');
    overlay.className = 'backdrop backdrop-top';
    overlay.innerHTML = `
      <div class="modal modal-wide" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>Settings: ${esc(meta.name)}</h3></div>
        <div class="modal-body"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost btn-plugin-settings-reset">Reset Default</button>
          <span class="grow"></span>
          <button class="btn btn-ghost btn-plugin-settings-cancel">Cancel</button>
          <button class="btn btn-primary btn-plugin-settings-save">Save</button>
        </div>
      </div>`;
    const body = overlay.querySelector('.modal-body');
    const scopeHint = document.createElement('p');
    scopeHint.className = 'hint m-0 mt-1 mb-2';
    if (scope === 'project') {
      const pn = host.state.projectName() || 'this one';
      scopeHint.textContent = `Only applies to project "${pn}".`;
    } else {
      scopeHint.textContent = 'Applies to all projects.';
    }
    body.append(scopeHint, form);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('open')));

    let settled = false;
    const close = () => {
      if (settled) return;
      settled = true;
      overlay.classList.remove('open');
      setTimeout(() => { try { overlay.remove(); } catch {} }, 360);
    };
    // Click outside modal or press Escape closes.
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });

    overlay.querySelector('.btn-plugin-settings-cancel').addEventListener('click', close);
    overlay.querySelector('.btn-plugin-settings-reset').addEventListener('click', () => {
      PluginUI._resetFields(meta, ownFields);
    });
    overlay.querySelector('.btn-plugin-settings-save').addEventListener('click', () => {
      if (scope === 'global') Runtime.setGlobalPluginSettings(meta.id, PluginUI._readFields(meta, ownFields));
      else Runtime.setProjectPluginSettings(meta.id, PluginUI._readFields(meta, ownFields));
      close();
      host.ui.flash(`Settings for "${meta.name}" saved.`);
    });
  }
};

AETL.plugins = {
  attach(bridge) {
    host = bridge;
    const g = id => document.getElementById(id);
    ui = {
      pluginManagerModal: g('pluginManagerModal'),
      btnPluginManagerOpen: g('btnPluginManagerOpen'),
      btnPluginManagerClose: g('btnPluginManagerClose'),
      btnPluginRefresh: g('btnPluginRefresh'),
      btnInstallPlugin: g('btnInstallPlugin'),
      pluginFileInput: g('pluginFileInput'),
      pluginList: g('pluginList'),
      pluginPanels: g('pluginPanels')
    };
    PluginUI.bind();
  },

  async init() { return Runtime.init(); },
  async sync() { return Runtime.sync(); },
  getMeta(id) { return Runtime.getMeta(id); },
  projectSettingsFor(meta) { return Runtime.projectSettingsFor(meta); },
  activeParserInfo() { return Runtime.activeParserInfo(); },
  resolveByExtension(name) { return Runtime.resolveByExtension(name); },
  resolveByMagic(head) { return Runtime.resolveByMagic(head); },
  async callExtract(meta, input) { return Runtime.callExtract(meta, input); },
  async callPack(meta, input) { return Runtime.callPack(meta, input); },
  abort(meta) {
    const inst = Runtime._instances.get(meta.id);
    if (inst) {
      for (const ctrl of inst.aborts) { try { ctrl.abort(); } catch {} }
      inst.aborts.clear();
    }
  },
  normalizePluginLines(raw, startNum) { return Runtime.normalizePluginLines(raw, startNum); },
  toPluginLine(l) { return Runtime.toPluginLine(l); },
  async runCopyHook(text) { return Runtime.runCopyHook(text); },
  async runApplyHook(text) { return Runtime.runApplyHook(text); },
  emit(event, payload) { return Runtime.emit(event, payload); },
  onProjectOpened() { return Runtime.onProjectOpened(); },
  onProjectClosed() { return Runtime.onProjectClosed(); },

  async runHooks(name, ...args) { return Runtime.runHooks(name, ...args); },
  runHooksSync(name, value, ...rest) { return Runtime.runHooksSync(name, value, ...rest); },

  listImporters() { return Runtime.listImporters(); },
  getImporter(name) { return Runtime.getImporter(name); },
  listExporters() { return Runtime.listExporters(); },
  getExporter(name) { return Runtime.getExporter(name); },
  listPluginShortcuts() { return Runtime.listPluginShortcuts(); }
};

