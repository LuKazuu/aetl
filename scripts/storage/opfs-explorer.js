// AETL - OPFS file explorer modal
'use strict';

const OpfsExplorer = {
  path: [],
  classify(name, isDir) {
    if (isDir) {
      if (this.path.length === 0) {
        if (name === APP_DIR) return 'app';
        if (name === PLUGINS_DIR) return 'plugins';
        if (name === PROJECTS_DIR) return 'projects';
      }
      return 'folder';
    }
    if (name === 'index.json') return 'index';
    if (name === 'manifest.json') return 'manifest';
    if (name === 'plugin.js') return 'plugin-code';
    if (name === 'project.json') return 'project';
    if (name === 'book.epub') return 'epub';
    if (name.startsWith('.') && name.endsWith('.tmp')) return 'tmp';
    if (/\.(epub|epub3)$/i.test(name)) return 'epub';
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) return 'image';
    if (/\.(js|json|txt|xhtml|html)$/i.test(name)) return 'other';
    return 'other';
  },
  kindLabel(kind) {
    return ({
      app: 'App Data',
      plugins: 'Plugins',
      projects: 'Projects',
      folder: 'Folder',
      project: 'Project',
      epub: 'EPUB',
      image: 'Image',
      manifest: 'Manifest',
      'plugin-code': 'Plugin Code',
      index: 'Index',
      tmp: 'Tmp',
      other: 'File'
    })[kind] || 'File';
  },
  kindIconSvg(kind, isDir) {
    const SVG = (path) => '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
    const M = {
      folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
      app: '<path d="M12 2a10 10 0 1 0 10 10H12V2z"/><path d="M12 2a10 10 0 0 0 0 20z"/>',
      plugins: '<path d="M5 5h4.5a2.5 2.5 0 1 1 5 0H19v4.5a2.5 2.5 0 1 1 0 5V19h-4.5a2.5 2.5 0 1 0-5 0H5v-4.5a2.5 2.5 0 1 0 0-5z"/>',
      projects: '<path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-3H5a2 2 0 0 0-2 2z"/>',
      project: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>',
      epub: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
      image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
      manifest: '<path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4"/><path d="M9 3v4h6V3"/><path d="M9 12h6"/><path d="M9 16h3"/>',
      'plugin-code': '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
      index: '<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>',
      tmp: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      other: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>'
    };
    return SVG(M[isDir ? 'folder' : kind] || M.other);
  },
  formatDate(ms) {
    if (!ms) return '';
    try {
      const d = new Date(ms);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return ''; }
  },
  async dirHandle(path) {
    let dir = await navigator.storage.getDirectory();
    for (const part of path) dir = await dir.getDirectoryHandle(part);
    return dir;
  },
  async listDir() {
    if (!navigator.storage?.getDirectory) return [];
    const dir = await this.dirHandle(this.path);
    const out = [];
    for await (const [name, handle] of dir.entries()) {
      const isDir = handle.kind === 'directory';
      const item = { name, isDir, kind: this.classify(name, isDir), size: null, lastModified: 0, count: null };
      if (isDir) {
        try {
          let n = 0;
          for await (const _ of handle.entries()) n++;
          item.count = n;
        } catch {}
      } else {
        try {
          const file = await handle.getFile();
          item.size = file.size;
          item.lastModified = file.lastModified;
        } catch {}
      }
      out.push(item);
    }
    const kindPriority = { projects: 0, app: 1, plugins: 2, project: 3, epub: 4, image: 5, manifest: 6, 'plugin-code': 7, other: 8, index: 9, tmp: 10 };
    out.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (a.isDir) {
        const pa = kindPriority[a.kind] ?? 5;
        const pb = kindPriority[b.kind] ?? 5;
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name);
      }
      const p = (kindPriority[a.kind] ?? 5) - (kindPriority[b.kind] ?? 5);
      if (p !== 0) return p;
      return a.name.localeCompare(b.name);
    });
    return out;
  },
  _showLoading(show) {
    els.opfsLoading.hidden = !show;
  },
  _showEmpty(show) {
    if (show) {
      els.opfsEmptyText.textContent = this.path.length ? 'This folder is empty.' : 'No files in OPFS yet.';
    }
    els.opfsEmpty.hidden = !show;
  },
  _renderCrumbs() {
    els.opfsCrumbs.hidden = !this.path.length;
    els.opfsCrumbs.innerHTML = '';
    if (!this.path.length) return;
    const frag = document.createDocumentFragment();
    const mkCrumb = (label, depth) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opfs-crumb' + (depth === this.path.length ? ' current' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        this.path = this.path.slice(0, depth);
        this.refresh();
      });
      return b;
    };
    frag.appendChild(mkCrumb('OPFS', 0));
    this.path.forEach((seg, i) => {
      const sep = document.createElement('span');
      sep.className = 'opfs-crumb-sep';
      sep.textContent = '/';
      frag.appendChild(sep);
      frag.appendChild(mkCrumb(seg, i + 1));
    });
    els.opfsCrumbs.appendChild(frag);
  },
  async refresh() {
    if (!navigator.storage?.getDirectory) {
      els.opfsList.innerHTML = '';
      this._showEmpty(false);
      this._showLoading(false);
      const notice = document.createElement('div');
      notice.className = 'opfs-empty';
      notice.style.color = 'var(--danger)';
      notice.textContent = "Browser doesn't support OPFS.";
      els.opfsList.appendChild(notice);
      return;
    }
    this._showLoading(true);
    this._showEmpty(false);
    els.opfsList.innerHTML = '';
    try {
      const items = await this.listDir();
      this._showLoading(false);
      this._renderCrumbs();
      if (!items.length) {
        this._showEmpty(true);
        return;
      }
      const frag = document.createDocumentFragment();
      for (const item of items) {
        frag.appendChild(this._renderItem(item));
      }
      els.opfsList.appendChild(frag);
    } catch (e) {
      this._showLoading(false);
      els.opfsList.innerHTML = '';
      if (e?.name === 'NotFoundError') {
        this.path = [];
        els.opfsCrumbs.hidden = true;
      }
      const notice = document.createElement('div');
      notice.className = 'opfs-error';
      notice.style.color = 'var(--danger)';
      const msg = document.createElement('div');
      msg.textContent = e?.name === 'NotFoundError'
        ? 'Folder not found. It may have been deleted. Return to OPFS root.'
        : friendlyError(e, "Couldn't load file list: ");
      notice.appendChild(msg);
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'btn btn-ghost btn-xs';
      retryBtn.style.marginTop = '8px';
      retryBtn.textContent = 'Try Again';
      retryBtn.addEventListener('click', () => OpfsExplorer.refresh());
      notice.appendChild(retryBtn);
      els.opfsList.appendChild(notice);
    }
  },
  _renderItem(item) {
    const row = document.createElement('div');
    row.className = 'opfs-item' + (item.isDir ? ' is-dir' : '');
    row.setAttribute('role', 'listitem');
    row.dataset.name = item.name;
    row.dataset.kind = item.kind;
    row.dataset.dir = item.isDir ? '1' : '0';
    const downloadTitle = item.isDir
      ? 'Folder cannot be downloaded'
      : item.kind === 'tmp'
        ? 'Tmp file may be incomplete. Download with caution'
        : 'Download file';
    const itemCount = item.count ?? 0;
    const sizeLabel = item.isDir ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : humanBytes(item.size);
    row.innerHTML = `
      <div class="opfs-item-icon kind-${item.isDir ? 'folder' : item.kind}" aria-hidden="true">${this.kindIconSvg(item.kind, item.isDir)}</div>
      <div class="opfs-item-info"${item.isDir ? ' data-action="open" title="Open folder"' : ''}>
        <span class="opfs-item-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <div class="opfs-item-meta">
          <span class="opfs-tag kind-${item.kind}">${this.kindLabel(item.kind)}</span>
          <span class="opfs-meta-size">${sizeLabel}</span>
          ${item.lastModified ? `<span class="opfs-meta-date" title="Last modified">${this.formatDate(item.lastModified)}</span>` : ''}
        </div>
      </div>
      <div class="opfs-item-actions">
        <button type="button" class="opfs-item-btn opfs-download" aria-label="Download ${escapeHtml(item.name)}" title="${downloadTitle}" data-action="download"${item.isDir ? ' disabled' : ''}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button type="button" class="opfs-item-btn danger opfs-delete" aria-label="Delete ${escapeHtml(item.name)}" title="${item.isDir ? 'Delete folder' : 'Delete file'}" data-action="delete">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    `;
    return row;
  },
  async download(name) {
    try {
      const dir = await this.dirHandle(this.path);
      const handle = await dir.getFileHandle(name);
      const file = await handle.getFile();
      const url = URL.createObjectURL(file);
      download(url, name);
      await AETL.plugins.runHooks('afterOpfsDownload', { path: this.path.slice(), name, size: file.size });
    } catch (e) {
      App.flash(friendlyError(e, 'Couldn\'t download "' + name + '": '), true, 'error');
    }
  },
  async remove(name, isDir) {
    const kind = this.classify(name, isDir);
    const atProjectsRoot = this.path.length === 1 && this.path[0] === PROJECTS_DIR;
    const atPluginsRoot = this.path.length === 1 && this.path[0] === PLUGINS_DIR;
    const warnings = {
      projects: 'This is a project folder. The project will disappear from the dashboard after deletion.',
      plugins: 'This is a plugin folder. The plugin will be removed from the plugin list.',
      project: 'This is the project data file. The project may break after deletion.',
      epub: 'This is an EPUB used by the project. Image previews will no longer display.',
      manifest: 'This is the plugin manifest. The plugin may not load correctly.',
      'plugin-code': 'This is the plugin entry file. The plugin will no longer load.',
      index: 'This is an internal index file. The app will rebuild it automatically.',
      tmp: 'This is a temporary file from a failed write. Safe to delete.',
      folder: 'This folder and all its contents will be deleted.',
      other: 'This file is unrecognized. Delete if you are sure.'
    };
    let warning = warnings[kind] || warnings.other;
    if (atProjectsRoot && isDir) warning = warnings.projects;
    else if (atPluginsRoot && isDir) warning = warnings.plugins;
    if (!await App.dialogConfirm(
      `Delete "${name}" from OPFS?`,
      `${warning}\n\nThis action cannot be undone.`
    )) return;
    await AETL.plugins.runHooks('beforeOpfsDelete', { path: this.path.slice(), name, isDir, kind });
    try {
      const dir = await this.dirHandle(this.path);
      await dir.removeEntry(name, { recursive: !!isDir });
      const row = [...els.opfsList.children].find(el => el.dataset.name === name);
      if (row) {
        row.remove();
        if (!els.opfsList.children.length) this._showEmpty(true);
      } else if (!els.opfsList.children.length) {
        this._showEmpty(true);
      }
      if (atPluginsRoot && isDir) await AETL.plugins.sync();
      if (atProjectsRoot && isDir) App.loadDashboard();
      if (kind === 'index' && this.path.length === 1 && this.path[0] === PLUGINS_DIR) await AETL.plugins.sync();
      if (kind === 'index' && this.path.length === 1 && this.path[0] === PROJECTS_DIR) App.loadDashboard();
      await AETL.plugins.runHooks('afterOpfsDelete', { path: this.path.slice(), name, isDir, kind });
    } catch (e) {
      App.flash(friendlyError(e, 'Couldn\'t delete "' + name + '": '), true, 'error');
      if (e?.storage) this.refresh();
    }
  },
  open(name) {
    this.path.push(name);
    this.refresh();
  },
  handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('.opfs-item');
    if (!row) return;
    const name = row.dataset.name;
    if (!name) return;
    const action = btn.dataset.action;
    if (action === 'open') this.open(name);
    else if (action === 'download') this.download(name);
    else if (action === 'delete') this.remove(name, row.dataset.dir === '1');
  }
};
