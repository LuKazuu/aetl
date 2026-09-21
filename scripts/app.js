// AETL - Main App controller (UI orchestration)
'use strict';

const App = {
  main: null,
  pr: null,
  activeLine: null,
  highlightRe: null,
  lastProofreadSig: '',
  lastProofreadContentVer: 0,
  lastFile: null,
  fileCache: null,
  toastToken: 0,
  toastTimer: null,
  savedTimer: 0,
  tmpVndb: [],
  dashboardItems: [],
  dashboardAllItems: [],
  dashboardRendered: 0,
  dashboardObserver: null,
  revealId: null,
  dashboardSentinel: null,
  dashboardFailed: false,
  storageCheckBusy: false,
  storageWatchTimer: null,
  healScheduled: false,
  _storageCheckCount: 0,
  _storageCriticalShown: false,

  flash(msg, keep = false, kind = '') {
    const el = els.globalToast;
    const t = ++App.toastToken;
    const timeout = keep ? 6000 : CFG.toastTimeoutMs;
    // Force reflow so the transition replays on consecutive flash() calls.
    el.classList.remove('show');
    void el.offsetWidth;
    el.textContent = msg;
    el.className = 'global-toast show' + (kind ? ' ' + kind : '');
    clearTimeout(App.toastTimer);
    App.toastTimer = setTimeout(() => { if (App.toastToken === t) el.classList.remove('show'); }, timeout);
  },

  flashSaved() {
    const bar = els.progressText;
    if (!bar || !State.projectId) return;
    bar.classList.add('saved');
    clearTimeout(App.savedTimer);
    App.savedTimer = setTimeout(() => bar.classList.remove('saved'), CFG.savedTimeoutMs);
  },

  async init() {
    cacheEls();
    App.swReady = App.swFlow();

    if (!navigator.storage?.getDirectory) {
      els.projectList.innerHTML = `<p class="hint" style="grid-column:1/-1;color:var(--danger);">Browser doesn't support OPFS.</p>`;
      await App.swReady;
      App.hideBootSplash();
      return;
    }

    window.addEventListener('error', e => {
      console.error('[global error]', e.error || e.message);
    });
    window.addEventListener('unhandledrejection', e => {
      const reason = e.reason;
      const msg = reason?.storage ? reason.message : (reason?.message || String(reason));
      console.error('[unhandled rejection]', reason);
      if (reason?.storage) App.flash('Failed: ' + msg, true);
    });

    Storage.sweepTemp();
    await App.ensurePersisted();

    App.main = new Scroller(
      els.previewViewport, els.previewContainer, App.createMainRow, App.updateMainRow,
      (item) => item.type === 'header' ? `h:${item.file}` : item.type === 'image' ? `i:${item.img.file || ''}:${item.img.zipPath}:${item.img.insertAfter ?? 'c'}` : `l:${item.line.line_num}`
    );
    App.pr = new Scroller(
      els.proofreadContainer.closest('.proofread-results-wrap'),
      els.proofreadContainer,
      App.createPrRow,
      App.updatePrRow,
      (item) => `p:${item.num}`
    );

    App.bind();
    await Shortcuts.init();
    await Immersive.init();
    AETL.plugins.attach(PluginHost);
    await AETL.plugins.init();
    App.syncImportAccept();
    App.renderPluginMenuItems();
    await App.loadDashboard();
    App.startStorageWatch();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') App.checkStorageAlive();
    });
    window.addEventListener('focus', () => App.checkStorageAlive());
    window.addEventListener('pageshow', e => {
      if (e.persisted) App.checkStorageAlive();
    });

    await App.swReady;
    App.hideBootSplash();
  },

  bind() {
    App.bindToolbar();
    App.bindToolsLayout();
    App.bindDropdowns();
    App.bindImportExport();
    App.bindSelection();
    App.bindGlossary();
    App.bindSettings();
    App.bindContext();
    App.bindLineEditor();
    App.bindProofread();
    App.bindPreview();
    App.bindNames();
    App.bindBookmarks();
  },

  bindToolbar() {
    els.busyCancel.addEventListener('click', () => Progress.cancel());
    els.btnNewProject.addEventListener('click', App.createProject);
    els.btnBackToDashboard.addEventListener('click', App.closeProject);
    els.btnToggleHeader.addEventListener('click', () => App.setToolbarHidden(true));
    els.btnShowHeader.addEventListener('click', () => App.setToolbarHidden(false));
    els.btnRestoreProject.addEventListener('click', () => els.restoreProjectInput.click());
    els.restoreProjectInput.addEventListener('change', App.restoreProject);
    els.btnOpenPlugins.addEventListener('click', () => {
      closeDropdowns();
      document.getElementById('btnPluginManagerOpen').click();
    });
    els.btnImmersive.addEventListener('click', () => { closeDropdowns(); Immersive.open(); });

    let searchTimer = null;
    els.projectSearch.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => App.renderDashboardItems(), CFG.delay.dashboardSearchMs);
    });
    els.projectSearchClear.addEventListener('click', () => {
      els.projectSearch.value = '';
      els.projectSearch.focus();
      App.renderDashboardItems();
    });

    App.bindSortDropdown();

    els.btnDashboardSettings.addEventListener('click', () => {
      toggleModal(els.dashboardSettingsModal, true);
    });
    els.btnDashboardSettingsClose.addEventListener('click', () => toggleModal(els.dashboardSettingsModal, false));
    els.btnShortcutsOpen.addEventListener('click', () => {
      App.renderShortcutList();
      toggleModal(els.shortcutModal, true);
    });
    els.btnShortcutsClose.addEventListener('click', () => { Shortcuts.stopRecording(); toggleModal(els.shortcutModal, false); });
    els.btnShortcutsResetAll.addEventListener('click', async () => {
      if (!await App.dialogConfirm('Reset all shortcuts?', 'All custom key bindings will be replaced with defaults.')) return;
      Shortcuts.resetBindings();
      App.renderShortcutList();
    });
    els.btnBackupAll.addEventListener('click', App.backupAll);
    els.btnWipeAllData.addEventListener('click', App.wipeAllData);

    els.btnOpfsExplorerOpen.addEventListener('click', () => {
      toggleModal(els.opfsExplorerModal, true);
      OpfsExplorer.path = [];
      OpfsExplorer.refresh();
    });
    els.btnOpfsExplorerClose.addEventListener('click', () => {
      toggleModal(els.opfsExplorerModal, false);
      App.loadDashboard();
    });
    els.btnOpfsRefresh.addEventListener('click', () => OpfsExplorer.refresh());
    els.opfsList.addEventListener('click', e => OpfsExplorer.handleClick(e));

  },

  bindSortDropdown() {
    const box = els.projectSortBox;
    const trigger = els.projectSortTrigger;
    const menu = els.projectSortMenu;
    const label = els.projectSortLabel;
    const hidden = els.projectSort;

    const labelMap = {};
    menu.querySelectorAll('.sort-menu-item').forEach(item => {
      labelMap[item.dataset.value] = item.querySelector('.sort-menu-text').textContent;
    });

    const closeMenu = () => {
      box.classList.remove('open');
      menu.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    };
    const openMenu = () => {
      box.classList.add('open');
      menu.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      const active = menu.querySelector('.sort-menu-item.active');
      if (active) setTimeout(() => active.focus(), CFG.delay.focusMs);
    };
    const toggleMenu = () => {
      if (box.classList.contains('open')) closeMenu();
      else openMenu();
    };
    const selectValue = (value) => {
      if (!value || !labelMap[value]) return;
      hidden.value = value;
      label.textContent = labelMap[value];
      menu.querySelectorAll('.sort-menu-item').forEach(item => {
        const isActive = item.dataset.value === value;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      App.renderDashboardItems();
      closeMenu();
    };

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        toggleMenu();
      } else if (e.key === 'Escape' && box.classList.contains('open')) {
        e.preventDefault();
        closeMenu();
        trigger.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!box.classList.contains('open')) openMenu();
        else {
          const active = menu.querySelector('.sort-menu-item.active');
          const next = active ? active.nextElementSibling : menu.querySelector('.sort-menu-item');
          if (next) next.focus();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!box.classList.contains('open')) openMenu();
        else {
          const active = menu.querySelector('.sort-menu-item.active');
          const prev = active ? active.previousElementSibling : null;
          if (prev) prev.focus();
        }
      }
    });

    menu.querySelectorAll('.sort-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        selectValue(item.dataset.value);
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          selectValue(e.currentTarget.dataset.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeMenu();
          trigger.focus();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = e.currentTarget.nextElementSibling;
          if (next) next.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = e.currentTarget.previousElementSibling;
          if (prev) prev.focus();
        }
      });
    });

    document.addEventListener('click', (e) => {
      if (!box.contains(e.target) && box.classList.contains('open')) {
        closeMenu();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && box.classList.contains('open')) {
        closeMenu();
        trigger.focus();
      }
    });

    const reposition = () => {
      if (!box.classList.contains('open')) return;
      const r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth - 8) {
        menu.style.left = 'auto';
        menu.style.right = '0';
      }
      if (r.left < 8) {
        menu.style.right = 'auto';
        menu.style.left = '0';
      }
    };
    trigger.addEventListener('click', () => setTimeout(reposition, CFG.delay.repositionMs));
    window.addEventListener('resize', reposition);
  },

  bindDropdowns() {
    document.addEventListener('click', e => {
      for (const { trigger, panel } of DROPDOWNS) {
        if (e.target.closest(`#${trigger}`)) {
          e.preventDefault();
          const willShow = !els[panel].classList.contains('show');
          closeDropdowns();
          if (willShow) { positionDropdown(panel); els[panel].classList.add('show'); }
          return;
        }
      }
      if (!DROPDOWNS.some(({ group }) => e.target.closest(`#${group}`))) closeDropdowns();
      const bd = e.target.closest('.backdrop.open');
      if (bd && e.target === bd) toggleModal(bd, false);
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (anyModalOpen()) { const m = topModal(); if (m) toggleModal(m, false); }
      else closeDropdowns();
    });

    els.dynamicToolbarWrap.addEventListener('scroll', closeDropdowns, { passive: true });
    window.addEventListener('scroll', closeDropdowns, true);
    window.addEventListener('resize', closeDropdowns);
  },

  bindImportExport() {
    const importInputs = [els.importFileInput, els.importFolderInput, els.importZipInput];
    ['btnImportFile', 'btnImportFolder', 'btnImportZip'].forEach((id, i) => {
      const input = importInputs[i];
      els[id].addEventListener('click', () => { closeDropdowns(); input.click(); });
      input.addEventListener('change', async e => {
        if (!e.target.files.length) return;
        await Importer.process(id === 'btnImportZip' ? e.target.files[0] : e.target.files, id === 'btnImportZip');
        e.target.value = '';
      });
    });

    const replaceBindings = [
      ['btnImportTranslation', 'importTranslationInput', 'translation'],
      ['btnImportUntranslated', 'importUntranslatedInput', 'untranslated'],
      ['btnImportOriginal', 'importOriginalInput', 'original']
    ];
    replaceBindings.forEach(([btnId, inputId, mode]) => {
      els[btnId].addEventListener('click', () => { closeDropdowns(); els[inputId].click(); });
      els[inputId].addEventListener('change', async e => {
        if (!e.target.files.length) return;
        await Importer.processReplaceJson(e.target.files, mode);
        e.target.value = '';
      });
    });

    const exportBindings = [
      ['btnExportProject', Exporter.run],
      ['btnExportTranslation', Exporter.runTranslationJson],
      ['btnExportUntranslated', Exporter.runUntranslatedJson],
      ['btnExportOriginal', Exporter.runOriginalJson]
    ];
    for (const [id, fn] of exportBindings) {
      els[id].addEventListener('click', () => { closeDropdowns(); fn.call(Exporter); });
    }

    els.btnCopyForAi.addEventListener('click', App.copyForAi);
    els.btnApply.addEventListener('click', App.applyTranslation);
    els.btnUndo.addEventListener('click', App.undo);
    els.btnRedo.addEventListener('click', App.redo);
    els.btnProofread.addEventListener('click', App.openProofread);
  },

  bindSelection() {
    els.btnSelectAll.addEventListener('click', () => {
      State.lines.forEach(l => { if (!isTrans(l)) State.selected.add(l.line_num); });
      App.syncCheckboxes();
    });
    els.btnClearSelection.addEventListener('click', () => { State.selected.clear(); App.syncCheckboxes(); });
    els.btnSelectRange.addEventListener('click', App.selectRange);
  },

  bindGlossary() {
    els.btnGlossary.addEventListener('click', () => {
      els.glossaryVndbCheck.checked = State.vndbEnabled;
      els.glossaryVndbIdInput.value = State.vndbId || '';
      App.tmpVndb = [...State.vndbGlossary];
      els.glossaryVndbPreviewArea.value = App.tmpVndb.map(g => `${g[0]}: ${g[1]}`).join('\n');
      els.glossaryVndbWrap.classList.toggle('section-disabled', !State.vndbEnabled);
      els.glossaryVndbIdInput.disabled = els.btnGlossaryVndbFetch.disabled = App.tmpVndb.length > 0;
      els.glossaryCustomCheck.checked = State.customEnabled;
      els.glossaryCustomInput.value = State.customRaw || '';
      els.glossaryCustomWrap.classList.toggle('section-disabled', !State.customEnabled);
      App.renderPluginSections('glossary');
      toggleModal(els.glossaryModal, true);
    });
    els.glossaryVndbCheck.addEventListener('change', e => {
      els.glossaryVndbWrap.classList.toggle('section-disabled', !e.target.checked);
    });
    els.btnGlossaryVndbFetch.addEventListener('click', async () => {
      let id = els.glossaryVndbIdInput.value.trim();
      if (!id) return;
      if (!id.startsWith('v')) id = 'v' + id;
      const status = els.glossaryVndbStatus;
      try {
        els.btnGlossaryVndbFetch.disabled = els.glossaryVndbIdInput.disabled = true;
        status.textContent = 'Fetching data...';
        status.className = 'toast info';
        const chars = await Vndb.fetchCharacters(id);
        if (!chars.length) throw new Error('No characters found.');
        App.tmpVndb = Vndb.buildGlossary(chars);
        els.glossaryVndbPreviewArea.value = App.tmpVndb.map(g => `${g[0]}: ${g[1]}`).join('\n');
        status.textContent = `Found ${App.tmpVndb.length} entries.`;
        status.className = 'toast success';
      } catch (e) {
        status.textContent = e.message;
        status.className = 'toast error';
        els.btnGlossaryVndbFetch.disabled = els.glossaryVndbIdInput.disabled = false;
      }
    });
    els.btnGlossaryVndbReset.addEventListener('click', () => {
      els.glossaryVndbCheck.checked = false;
      els.glossaryVndbIdInput.value = '';
      els.glossaryVndbPreviewArea.value = '';
      App.tmpVndb = [];
      els.glossaryVndbStatus.className = 'toast empty mb-2';
      els.glossaryVndbIdInput.disabled = els.btnGlossaryVndbFetch.disabled = false;
      els.glossaryVndbWrap.classList.add('section-disabled');
    });
    els.glossaryCustomCheck.addEventListener('change', e => {
      els.glossaryCustomWrap.classList.toggle('section-disabled', !e.target.checked);
    });
    els.btnGlossaryCustomReset.addEventListener('click', () => {
      els.glossaryCustomCheck.checked = false;
      els.glossaryCustomInput.value = '';
      els.glossaryCustomWrap.classList.add('section-disabled');
    });
    els.btnGlossaryCancel.addEventListener('click', () => toggleModal(els.glossaryModal, false));
    els.btnGlossarySave.addEventListener('click', () => {
      State.vndbEnabled = els.glossaryVndbCheck.checked;
      State.vndbId = els.glossaryVndbIdInput.value.trim();
      State.vndbGlossary = App.tmpVndb;
      State.customEnabled = els.glossaryCustomCheck.checked;
      State.customRaw = els.glossaryCustomInput.value.trim();
      App.savePluginSections('glossary');
      toggleModal(els.glossaryModal, false);
      State.queueSave();
    });
  },

  bindSettings() {
    els.btnSettings.addEventListener('click', () => {
      App.syncSettingsModal();
      toggleModal(els.settingsModal, true);
    });
    els.btnSettingsBasicReset.addEventListener('click', () => App.resetSettingsModal('basic'));
    els.btnSettingsLayoutReset.addEventListener('click', () => App.resetSettingsModal('layout'));
    els.btnSettingsPromptReset.addEventListener('click', () => { els.settingsPromptInput.value = DEFAULT_PROMPT; });
    els.btnSettingsEpubReset.addEventListener('click', () => { els.settingsEpubTagsInput.value = 'p'; });
    els.btnSettingsIncrementReset.addEventListener('click', () => {
      els.settingsIncrementCheck.checked = false;
      els.settingsIncrementStepInput.value = 100;
      els.incrementStepWrap.classList.add('section-disabled');
    });
    els.settingsIncrementCheck.addEventListener('change', e => {
      els.incrementStepWrap.classList.toggle('section-disabled', !e.target.checked);
    });
    els.btnSettingsCancel.addEventListener('click', () => toggleModal(els.settingsModal, false));
    els.btnSettingsSave.addEventListener('click', () => {
      const prevIncrementEnabled = State.incrementEnabled;
      const changes = {};
      SETTINGS_FIELDS.forEach(({ id, key, type, def }) => {
        const before = State[key];
        if (type === 'check') State[key] = els[id].checked;
        else if (type === 'number') State[key] = Math.max(1, Math.floor(Number(els[id].value) || def));
        else State[key] = els[id].value.trim() || def;
        if (State[key] !== before) changes[key] = State[key];
      });
      App.savePluginSections('settings');
      App.applyToolsLayout();
      toggleModal(els.settingsModal, false);
      if (State.incrementEnabled && State.projectId && State.lines.length) {
        const from = parseInt(els.rangeFromInput.value, 10);
        const to = parseInt(els.rangeToInput.value, 10);
        const hasRange = from >= 1 && to >= from;
        const justEnabled = !prevIncrementEnabled && State.incrementEnabled;
        if (!hasRange || justEnabled) App.prefillIncrement();
      }
      State.queueSave();
      if (Object.keys(changes).length) AETL.plugins.runHooksSync('settingsChange', changes);
    });
  },

  bindContext() {
    els.btnContext.addEventListener('click', () => {
      els.summaryEnabledCheck.checked = State.summaryEnabled;
      els.summaryPromptInput.value = State.summaryPrompt || DEFAULT_SUMMARY_PROMPT;
      els.summaryStoredInput.value = State.summary || '';
      els.summaryWrap.classList.toggle('section-disabled', !State.summaryEnabled);
      App.renderPluginSections('summary');
      toggleModal(els.contextModal, true);
    });
    els.summaryEnabledCheck.addEventListener('change', e => {
      els.summaryWrap.classList.toggle('section-disabled', !e.target.checked);
    });
    els.btnSummaryReset.addEventListener('click', () => {
      els.summaryEnabledCheck.checked = false;
      els.summaryPromptInput.value = DEFAULT_SUMMARY_PROMPT;
      els.summaryStoredInput.value = '';
      els.summaryWrap.classList.add('section-disabled');
    });
    els.btnSummaryPromptReset.addEventListener('click', () => {
      els.summaryPromptInput.value = DEFAULT_SUMMARY_PROMPT;
    });
    els.btnSummaryStoredReset.addEventListener('click', () => {
      els.summaryStoredInput.value = '';
    });
    els.btnContextCancel.addEventListener('click', () => toggleModal(els.contextModal, false));
    els.btnContextSave.addEventListener('click', () => {
      State.summaryEnabled = els.summaryEnabledCheck.checked;
      State.summaryPrompt = els.summaryPromptInput.value.trim() || DEFAULT_SUMMARY_PROMPT;
      State.summary = els.summaryStoredInput.value.trim();
      App.savePluginSections('summary');
      toggleModal(els.contextModal, false);
      State.queueSave();
    });
  },

  bindLineEditor() {
    els.btnLineCancel.addEventListener('click', () => toggleModal(els.lineEditorModal, false));
    els.btnLineSave.addEventListener('click', App.saveLineEditor);
  },

  bindProofread() {
    els.btnProofreadClose.addEventListener('click', () => toggleModal(els.proofreadModal, false));
    els.btnProofreadReset.addEventListener('click', () => {
      els.proofreadSearchInput.value = '';
      els.proofreadReplaceInput.value = '';
      PROOFREAD_FIELDS.forEach(({ id, def, type }) => {
        const el = els[id];
        if (type === 'check') el.checked = def; else el.value = def;
      });
      App.syncProofread();
      App.renderProofread();
    });
    els.btnProofreadReplaceAll.addEventListener('click', App.replaceAll);

    const delayedRender = debounce(App.renderProofread, CFG.delay.proofreadDebounceMs);
    els.proofreadSearchInput.addEventListener('input', delayedRender);
    PROOFREAD_FIELDS.forEach(({ id }) => {
      els[id].addEventListener('change', () => { App.syncProofread(); App.renderProofread(); });
    });
  },

  bindPreview() {
    els.previewContainer.addEventListener('change', e => {
      if (e.target.closest('.checkbox-cell') && e.target.type === 'checkbox') {
        const n = Number(e.target.dataset.num);
        if (!n) return;
        if (e.target.checked) State.selected.add(n); else State.selected.delete(n);
        App.patchSelectedRow(n);
        App.updateFileBadge();
        App.updateButtons();
      } else if (e.target.matches('.file-header-inner input[type="checkbox"][data-file]')) {
        App.toggleFileSelection(e.target);
      }
    });
    els.stickyFileCheckbox.addEventListener('change', e => {
      if (e.target.dataset.file) App.toggleFileSelection(e.target);
    });
    els.previewContainer.addEventListener('click', e => {
      if (e.target.matches('input[type="checkbox"]')) return;
      const bmBtn = e.target.closest('.row-bookmark-btn');
      if (bmBtn) {
        e.stopPropagation();
        e.preventDefault();
        const n = Number(bmBtn.dataset.num);
        if (n) App.toggleBookmark(n);
        return;
      }
      const imgEl = e.target.closest('.row-image-el');
      if (imgEl && imgEl.src) { App.openImageLightbox(imgEl.src); return; }
      const wrap = e.target.closest('.text-content');
      if (!wrap) return;
      const row = wrap.closest('.preview-row');
      if (!row || row.classList.contains('file-header')) return;
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb?.dataset.num) App.openLineEditor(Number(cb.dataset.num));
    });

    let raf = 0;
    els.previewViewport.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; App.updateFileBadge(); });
    }, { passive: true });

    els.proofreadContainer.addEventListener('click', e => {
      const wrap = e.target.closest('.text-content');
      if (!wrap?.dataset.num) return;
      const n = Number(wrap.dataset.num);
      if (State.jumpToContext) {
        toggleModal(els.proofreadModal, false);
        App.scrollToLine(n);
      } else {
        App.openLineEditor(n);
      }
    });
  },

  bindNames() {
    els.nameTableBody.addEventListener('click', async e => {
      if (e.target.tagName !== 'TD') return;
      try { await clipboard(e.target.textContent); App.flash('Name copied!'); }
      catch { App.flash('Copy failed.', true, 'error'); }
    });
    els.btnCopyNamesPlain.addEventListener('click', () => App.copyAllNames('plain'));
    els.btnCopyNamesWithGlossary.addEventListener('click', () => App.copyAllNames('glossary'));
    els.btnCopyNamesMissingGlossary.addEventListener('click', () => App.copyAllNames('missing'));
  },

  bindBookmarks() {
    els.btnBookmarks.addEventListener('click', () => {
      const panel = els.bookmarkPanel;
      const willShow = !panel.classList.contains('show');
      App.toggleBookmarkPanel(willShow);
    });

    els.bookmarkList.addEventListener('click', e => {
      const del = e.target.closest('.bookmark-item-del');
      if (del) {
        e.stopPropagation();
        const item = del.closest('.bookmark-item');
        const n = Number(item?.dataset.num);
        if (n) App.toggleBookmark(n, false);
        return;
      }
      const item = e.target.closest('.bookmark-item');
      if (!item) return;
      const n = Number(item.dataset.num);
      if (!n) return;
      App.scrollToLine(n);
      App.toggleBookmarkPanel(false);
    });

    els.btnBookmarkClear.addEventListener('click', async () => {
      if (!State.bookmarks.length) return;
      if (!await App.dialogConfirm('Delete all bookmarks?', 'This action cannot be undone.')) return;
      const nums = State.bookmarks.slice();
      State.bookmarks = [];
      State.bookmarkSet = new Set();
      App.syncBookmarkUI();
      for (const n of nums) App.patchBookmarkRow(n);
      App.renderBookmarkList();
      Immersive.syncAllBookmarks();
      State.queueSave();
    });

    document.addEventListener('click', e => {
      if (!els.bookmarkPanel.classList.contains('show')) return;
      if (e.target.closest('.bookmark-dock')) return;
      App.toggleBookmarkPanel(false);
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (els.bookmarkPanel.classList.contains('show')) {
        App.toggleBookmarkPanel(false);
      }
    });

    window.addEventListener('blur', () => App.toggleBookmarkPanel(false));
  },

  toggleBookmarkPanel(show) {
    els.bookmarkPanel.classList.toggle('show', show);
    els.btnBookmarks.classList.toggle('active', show);
    els.btnBookmarks.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) App.renderBookmarkList();
  },

  patchBookmarkRow(num) {
    App.main.patch(`l:${num}`, row => {
      const isBm = State.bookmarkSet.has(num);
      row.classList.toggle('row-bookmarked', isBm);
      const bm = row._bm;
      if (bm && Number(bm.dataset.num) === num) {
        bm.setAttribute('aria-pressed', isBm ? 'true' : 'false');
        bm.title = isBm ? 'Remove bookmark' : 'Add bookmark';
      }
    });
  },

  openImageLightbox(src) {
    els.imageLightboxImg.src = src;
    toggleModal(els.imageLightbox, true);
  },

  toggleBookmark(num, force) {
    if (!num) return;
    const has = State.bookmarkSet.has(num);
    const next = force === undefined ? !has : force;
    if (next === has) return;
    if (next) { State.bookmarks.push(num); State.bookmarkSet.add(num); }
    else {
      const idx = State.bookmarks.indexOf(num);
      State.bookmarks.splice(idx, 1);
      State.bookmarkSet.delete(num);
    }
    App.syncBookmarkUI();
    App.patchBookmarkRow(num);
    if (els.bookmarkPanel.classList.contains('show')) {
      if (next) App.addBookmarkItem(num);
      else App.removeBookmarkItem(num);
    }
    Immersive.syncBookmark(num, next);
    State.queueSave();
  },

  syncBookmarkUI() {
    const count = State.bookmarks.length;
    els.bookmarkPanelCount.textContent = `(${count})`;
    els.btnBookmarks.disabled = !State.lines.length;
    els.btnBookmarkClear.disabled = count === 0;
    Immersive.updateBookmarkCount();
  },

  renderBookmarkList() { renderBookmarkListInto(els.bookmarkList, 'bookmark'); },

  addBookmarkItem(num) { addBookmarkItemTo(els.bookmarkList, num, 'bookmark'); },

  removeBookmarkItem(num) { removeBookmarkItemFrom(els.bookmarkList, num, 'bookmark'); },

  scrollToLine(num) {
    const idx = State.indexOfLine(num);
    if (idx === -1) return;
    App.main.scrollToIndex(idx, () => App.flashRow(num));
  },

  flashRow(num) {
    App.main.patch(`l:${num}`, row => {
      row.classList.remove('row-flash');
      void row.offsetWidth;
      row.classList.add('row-flash');
    });
  },

  syncSettingsModal() {
    SETTINGS_FIELDS.forEach(({ id, key, type, def }) => {
      const v = State[key] ?? def;
      if (type === 'check') els[id].checked = v; else els[id].value = v;
    });
    els.incrementStepWrap.classList.toggle('section-disabled', !State.incrementEnabled);
    App.renderPluginSections('settings');
  },

  _pluginSections: { settings: [], glossary: [], summary: [] },
  _pluginSectionModal: {
    settings: () => els.settingsModal,
    glossary: () => els.glossaryModal,
    summary: () => els.contextModal
  },
  _pluginRegions: {
    importMenu: () => els.importDropdown,
    exportMenu: () => els.exportDropdown,
    settingsModal: () => els.settingsModal,
    glossaryModal: () => els.glossaryModal,
    summaryModal: () => els.contextModal,
    toolsPanel: () => document.querySelector('.panel-right'),
    textPanel: () => document.querySelector('.panel-left'),
    previewContainer: () => els.previewContainer,
    toolbar: () => els.workspaceToolbar,
    toolbarActions: () => document.querySelector('.toolbar-actions'),
    pluginPanels: () => els.pluginPanels,
    dashboard: () => els.dashboardView,
    dashboardContent: () => els.projectList.parentElement,
    lineEditorModal: () => els.lineEditorModal,
    lineEditorBody: () => els.lineEditorModal?.querySelector('.modal-body'),
    proofreadModal: () => els.proofreadModal,
    proofreadContainer: () => els.proofreadContainer,
    namePanel: () => document.querySelector('.name-table-wrap'),
    pasteArea: () => els.pasteArea,
    progressOverlay: () => els.busyOverlay,
    progressText: () => els.progressText,
    heroBar: () => document.querySelector('.hero-bar'),
    bookmarkPanel: () => els.bookmarkPanel,
    bookmarkList: () => els.bookmarkList,
    selectionRange: () => document.querySelector('.panel-right .card .row'),
    shortcutsModal: () => els.shortcutModal,
    dashboardSettingsModal: () => els.dashboardSettingsModal,
    pluginManagerModal: () => document.getElementById('pluginManagerModal'),
    opfsExplorerModal: () => els.opfsExplorerModal
  },

  pluginRegion(name) {
    const fn = App._pluginRegions[name];
    if (!fn) throw new Error(`Unknown UI region "${name}". See README for the supported list.`);
    const el = fn();
    if (!el) throw new Error(`UI region "${name}" isn't available right now.`);
    return el;
  },

  renderPluginSections(target) {
    for (const s of App._pluginSections[target]) {
      s.body.innerHTML = '';
      try { s.hooks.render && s.hooks.render(s.body); } catch (e) { console.error('[plugin settings]', e); }
    }
  },

  savePluginSections(target) {
    for (const s of App._pluginSections[target]) {
      try { s.hooks.onSave && s.hooks.onSave(); } catch (e) { console.error('[plugin settings]', e); }
    }
  },

  addPluginMenuItem(menu, label, onClick) {
    const dropdown = menu === 'import' ? els.importDropdown : menu === 'export' ? els.exportDropdown : null;
    if (!dropdown) throw new Error('addMenuItem: menu must be "import" or "export".');
    const btn = document.createElement('button');
    btn.className = 'dropdown-item';
    btn.textContent = String(label ?? '');
    btn.addEventListener('click', () => {
      closeDropdowns();
      try { onClick && onClick(); } catch (e) { App.flash(String(e?.message || e)); }
    });
    dropdown.appendChild(btn);
    return btn;
  },

  removePluginMenuItem(btn) {
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
  },

  addPluginSettingsSection(target, title, hooks) {
    const modalFn = App._pluginSectionModal[target];
    if (!modalFn) throw new Error('addSettingsSection: target must be "settings", "glossary", or "summary".');
    const modal = modalFn();
    const card = document.createElement('div');
    card.className = 'card mb-2 mt-3';
    const head = document.createElement('div');
    head.className = 'row between mb-1';
    const label = document.createElement('div');
    label.className = 'section-label-lg m-0';
    label.textContent = String(title ?? '');
    head.appendChild(label);
    const body = document.createElement('div');
    card.append(head, body);
    const actions = modal.querySelector('.modal-actions');
    actions.parentNode.insertBefore(card, actions);
    const entry = { target, card, body, hooks: hooks || {} };
    App._pluginSections[target].push(entry);
    return entry;
  },

  removePluginSettingsSection(entry) {
    if (!entry) return;
    const list = App._pluginSections[entry.target];
    const i = list ? list.indexOf(entry) : -1;
    if (i >= 0) list.splice(i, 1);
    if (entry.card.parentNode) entry.card.parentNode.removeChild(entry.card);
  },

  resetSettingsModal(group) {
    const filter = group ? f => f.group === group : null;
    if (!filter) return;
    SETTINGS_FIELDS.filter(filter).forEach(({ id, def, type }) => {
      const el = els[id];
      if (type === 'check') el.checked = def;
      else el.value = def;
    });
  },

  async createProject() {
    const name = (await App.dialogPrompt('New project name:'))?.trim();
    if (!name) return;
    const ctx = { name, cancel: false };
    await AETL.plugins.runHooks('projectCreate', ctx);
    if (ctx.cancel) return;
    const id = makeProjId();
    State.resetTransient();
    State.projectId = id;
    State.projectName = ctx.name || name;
    try {
      await Storage.createProjectDir(id);
      const data = State.toData();
      await Storage.saveProject(id, data);
      await Storage.upsertProjectIndexEntry(Storage.projectIndexEntry(id, data, Date.now()));
      App.open(id, data);
    } catch (e) {
      App.flash(friendlyError(e, "Couldn't create project: "), true, 'error');
    }
  },

  open(id, data) {
    EpubImages.clear();
    State.loadFromData(data);
    State.projectId = id;
    State.selected.clear();
    State.undoStack = [];
    State.redoStack = [];
    State.namesDirty = true;
    els.rangeFromInput.value = '';
    els.rangeToInput.value = '';

    Storage.upsertProjectIndexEntry(Storage.projectIndexEntry(id, data, Date.now())).catch(e => console.error('[index] upsert failed:', e));
    if (data.projectType === 'epub' && data.epubSourceId) EpubImages.preload(id);

    if (App.dashboardObserver) { App.dashboardObserver.disconnect(); App.dashboardObserver = null; }
    App.stopStorageWatch();

    els.projectNameDisplay.textContent = State.projectName;
    els.dashboardView.classList.remove('open');
    els.workspaceView.hidden = false;
    AETL.plugins.onProjectOpened();
    App.applyToolsLayout();
    App.refresh(false);
    App.syncBookmarkUI();
    App.toggleBookmarkPanel(false);
    App.main.scrollToIndex(State.lastBookmarkIndex(), null, true);
  },

  closeProject() {
    if (State.saveTimer) {
      clearTimeout(State.saveTimer);
      State.saveTimer = null;
      State.persist({ silent: true }).then(() => App.finishClose());
    } else App.finishClose();
  },

  finishClose() {
    AETL.plugins.onProjectClosed();
    Immersive.close();
    EpubImages.clear();
    App.revealId = State.projectId;
    State.resetTransient();
    App.syncImportAccept();
    App.main.setItems([], false);
    App.pr.setItems([], false);
    els.nameTableBody.replaceChildren();
    els.pasteArea.value = '';
    els.rangeFromInput.value = '';
    els.rangeToInput.value = '';
    els.globalToast.classList.remove('show');
    els.progressText.textContent = '0/0 (0%)';
    els.progressText.classList.remove('saved');
    els.stickyFileName.textContent = '';
    els.stickyFileName.title = '';
    els.stickyFileRange.textContent = '';
    els.stickyFileBar.classList.remove('show');
    els.stickyFileCheckbox.checked = false;
    els.stickyFileCheckbox.disabled = true;
    delete els.stickyFileCheckbox.dataset.file;
    App.lastFile = null;
    App.fileCache = null;
    App.toggleBookmarkPanel(false);
    els.bookmarkList.replaceChildren();
    App.syncBookmarkUI();
    els.workspaceView.hidden = true;
    App.applyToolsLayout();
    els.workspaceToolbar.classList.remove('hidden');
    els.btnShowHeader.classList.remove('visible');
    els.dashboardView.classList.add('open');
    App.startStorageWatch();
    App.loadDashboard();
  },

  applyToolsLayout() {
    const side = State.toolsPosMobile === 'side';
    const left = State.toolsPosDesktop === 'left';
    els.split.classList.toggle('hide-tools', State.hideTools);
    els.split.classList.toggle('tools-side', side);
    els.split.classList.toggle('tools-left', left);
    const drawerAvailable = side && !State.hideTools && App.mqMobile.matches;
    els.btnToolsDrawer.classList.toggle('available', drawerAvailable);
    if (!drawerAvailable) App.setToolsDrawer(false);
    requestAnimationFrame(() => App.main.forceUpdate());
  },

  setToolsDrawer(open) {
    if (open === els.split.classList.contains('tools-open')) return;
    els.split.classList.toggle('tools-open', open);
    els.toolsScrim.classList.toggle('show', open);
    els.btnToolsDrawer.setAttribute('aria-expanded', open ? 'true' : 'false');
    closeDropdowns();
  },

  bindToolsLayout() {
    App.mqMobile = window.matchMedia('(max-width: 768px)');
    els.btnToolsDrawer.addEventListener('click', () => App.setToolsDrawer(true));
    els.btnToolsDrawerClose.addEventListener('click', () => App.setToolsDrawer(false));
    els.toolsScrim.addEventListener('click', () => App.setToolsDrawer(false));
    // Capture phase: one Escape closes one layer (modal, dropdown, then drawer).
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !els.split.classList.contains('tools-open')) return;
      if (anyModalOpen() || document.querySelector('.dropdown-content.show')) return;
      App.setToolsDrawer(false);
    }, true);
    App.mqMobile.addEventListener('change', () => {
      if (State.projectId) App.applyToolsLayout();
    });
  },

  setToolbarHidden(hidden) {
    const tb = els.workspaceToolbar;
    if (hidden === tb.classList.contains('hidden')) return;
    if (hidden) tb.style.setProperty('--toolbar-h', tb.offsetHeight + 'px');
    tb.classList.toggle('hidden', hidden);
    els.btnShowHeader.classList.toggle('visible', hidden);
  },

  syncImportAccept() {
    const info = AETL.plugins.activeParserInfo();
    const accept = info.magic ? '' : Array.from(info.extensions).join(',');
    els.importFileInput.accept = accept;
    els.importFolderInput.accept = accept;
  },

  renderShortcutList() {
    const wrap = els.shortcutList;
    const bindings = Shortcuts.loadBindings();
    wrap.replaceChildren();
    const groups = [
      { label: 'Dashboard', actions: Shortcuts._actions.filter(a => a.scope === 'dashboard') },
      { label: 'Workspace', actions: Shortcuts._actions.filter(a => a.scope === 'workspace') }
    ];
    for (const g of groups) {
      if (!g.actions.length) continue;
      const head = document.createElement('div');
      head.className = 'shortcut-group';
      head.textContent = g.label;
      wrap.appendChild(head);
      for (const a of g.actions) wrap.appendChild(App.buildShortcutRow(a, bindings));
    }
  },

  buildShortcutRow(action, bindings) {
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    const label = document.createElement('span');
    label.className = 'shortcut-label';
    label.textContent = action.label;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shortcut-key';
    const cur = action.id in bindings ? bindings[action.id] : (action.def || '');
    btn.innerHTML = cur ? comboHtml(cur) : '<span class="shortcut-none">Not set</span>';
    btn.title = 'Click then press a key combination (Backspace deletes, Escape cancels)';
    btn.addEventListener('click', () => Shortcuts.startRecording(action, btn));
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'shortcut-reset';
    reset.title = 'Reset to default';
    reset.innerHTML = SVG_ICON.reset;
    const isCustom = (action.id in bindings) && bindings[action.id] !== (action.def || '');
    reset.hidden = !isCustom;
    reset.addEventListener('click', () => {
      const b = Shortcuts.loadBindings();
      delete b[action.id];
      Shortcuts.saveBindings(b);
      Shortcuts.rebuild();
      App.renderShortcutList();
    });
    row.append(label, btn, reset);
    return row;
  },

  async wipeAllData() {
    if (!await App.dialogConfirm('Wipe all data?', 'All projects and data will be permanently deleted. This action cannot be undone.')) return;
    if (State.saveTimer) {
      clearTimeout(State.saveTimer);
      State.saveTimer = null;
    }
    State.projectId = null;
    Progress.determinate('Deleting all data...', 'Preparing...');
    let wipeError = null;
    try {
      await Storage.wipeAll((done, total) => {
        Progress.update(total ? `Deleting item ${done}/${total}...` : 'Deleting...', total ? Math.round(done / total * 100) : 100);
      });
    } catch (e) { wipeError = e; }
    try { for (const k of await caches.keys()) await caches.delete(k); } catch (e) { console.error('[wipe] caches clear failed:', e); }
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    } catch (e) { console.error('[wipe] SW unregister failed:', e); }
    Progress.hide();
    if (wipeError) {
      App.flash('Failed to delete all data: ' + (wipeError.message || wipeError) + '\n\nSome data may remain.', true, 'error');
      return;
    }
    location.reload();
  },

  hideBootSplash() {
    if (App.bootHidden || !els.bootSplash) return;
    App.bootHidden = true;
    els.bootSplash.classList.add('hidden');
    setTimeout(() => els.bootSplash.remove(), 400);
  },

  onSwControllerChange() {
    const last = Number(sessionStorage.getItem('swReloadAt')) || 0;
    if (Date.now() - last < 5000) return;
    sessionStorage.setItem('swReloadAt', String(Date.now()));
    location.reload();
  },

  async swFlow() {
    if (!('serviceWorker' in navigator)) return;
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      try { reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }); }
      catch { return; }
    }
    navigator.serviceWorker.addEventListener('controllerchange', App.onSwControllerChange);
    const hasActive = () => !!(navigator.serviceWorker.controller || reg.active);
    if (!hasActive() || !navigator.onLine) return;
    let updating = false;
    reg.addEventListener('updatefound', () => {
      if (!hasActive()) return;
      updating = true;
    });
    try { await reg.update(); }
    catch { return; }
    if (!updating && !reg.waiting && !(reg.installing && hasActive())) {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
      return;
    }
    await new Promise(r => setTimeout(r, 15000));
    navigator.serviceWorker.removeEventListener('controllerchange', App.onSwControllerChange);
  },

  checkStorageAlive() {
    if (!els.dashboardView.classList.contains('open')) return;
    if (App.storageCheckBusy) return;
    App.storageCheckBusy = true;
    const done = () => { App.storageCheckBusy = false; };
    if (App.dashboardFailed) {
      Promise.resolve(App.loadDashboard()).then(done, done);
      return;
    }
    Storage.probe()
      .then(ok => { if (!ok) return App.loadDashboard(); })
      .catch(e => console.error('[storage] probe failed:', e))
      .then(() => App.maybePersistAndCheckQuota())
      .then(done, done);
  },

  async maybePersistAndCheckQuota() {
    await App.ensurePersisted();
    App._storageCheckCount++;
    if (App._storageCheckCount % 8 !== 0) return;
    const est = await navigator.storage.estimate();
    if (!est || !est.quota) return;
    const free = (est.quota || 0) - (est.usage || 0);
    const freeMb = free / (1024 * 1024);
    if (freeMb < CFG.storage.criticalFreeMb) {
      if (!App._storageCriticalShown) {
        App._storageCriticalShown = true;
        App.flash(`Storage critical (${freeMb.toFixed(0)} MB free). Some writes may fail to save. Export your project as a backup.`);
      }
    } else if (freeMb >= CFG.storage.safeFreeMb) {
      App._storageCriticalShown = false;
    }
  },

  ensurePersisted() {
    return navigator.storage.persisted().then(already => already ? null : navigator.storage.persist().catch(() => {}));
  },

  startStorageWatch() {
    App.stopStorageWatch();
    App.storageWatchTimer = setInterval(() => {
      if (document.hidden) return;
      App.checkStorageAlive();
    }, CFG.delay.storageWatchMs);
  },

  stopStorageWatch() {
    clearInterval(App.storageWatchTimer);
    App.storageWatchTimer = null;
  },

  scheduleStorageHeal() {
    if (App.healScheduled) return;
    App.healScheduled = true;
    Storage.probe().then(ok => {
      if (ok) return;
      if (/[?&]heal=1/.test(location.search)) return;
      history.replaceState(null, '', location.pathname + (location.search || '') + (location.search ? '&' : '?') + 'heal=1');
      setTimeout(() => location.reload(), CFG.delay.reloadMs);
    }).catch(e => console.error('[storage] heal probe failed:', e));
  },

  async loadDashboard() {
    const list = els.projectList;
    const content = list.parentElement;
    const countBadge = els.projectCount;

    if (App.dashboardObserver) { App.dashboardObserver.disconnect(); App.dashboardObserver = null; }
    App.dashboardSentinel = null;
    App.dashboardItems = [];
    App.dashboardAllItems = [];
    App.dashboardRendered = 0;
    list.innerHTML = '';

    try {
      const items = await Storage.listProjects();
      App.dashboardFailed = false;
      App.healScheduled = false;
      if (location.search) history.replaceState(null, '', location.pathname);
      App.dashboardAllItems = items;

      countBadge.textContent = items.length;
      countBadge.hidden = false;
      els.heroActions.style.display = items.length ? '' : 'none';
      if (!items.length) {
        content.classList.add('is-empty');
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
            </div>
            <h3 class="empty-state-title">No projects yet</h3>
            <p class="empty-state-desc">Start by creating a new project, or restore from an existing backup file.</p>
            <div class="empty-state-actions">
              <button type="button" class="btn btn-primary btn-sm" data-action="new">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                Create Project
              </button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="restore">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/></svg>
                Restore Project
              </button>
            </div>
          </div>
        `;
        list.querySelector('.empty-state [data-action="new"]').addEventListener('click', () => els.btnNewProject.click());
        list.querySelector('.empty-state [data-action="restore"]').addEventListener('click', () => els.btnRestoreProject.click());
        return;
      }
      content.classList.remove('is-empty');
      App.renderDashboardItems();
      App.revealProject(App.revealId);
      App.revealId = null;
    } catch {
      App.dashboardFailed = true;
      Storage.invalidateRoot();
      App.scheduleStorageHeal();
      countBadge.hidden = true;
      content.classList.remove('is-empty');
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="var(--danger)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <h3 class="empty-state-title">Couldn't access storage</h3>
          <p class="empty-state-desc">The browser denied storage access, usually because site data was just cleared. The list will try to reload automatically; if it still fails, close and reopen the app.</p>
        </div>
      `;
    }
  },

  renderDashboardItems() {
    const list = els.projectList;
    if (App.dashboardObserver) { App.dashboardObserver.disconnect(); App.dashboardObserver = null; }
    App.dashboardSentinel = null;
    App.dashboardRendered = 0;
    list.innerHTML = '';

    const searchInput = els.projectSearch;
    const sortSelect = els.projectSort;
    const clearBtn = els.projectSearchClear;

    const query = (searchInput.value || '').trim().toLowerCase();
    const sortMode = sortSelect.value || 'newest';
    clearBtn.hidden = !query;

    let items = App.dashboardAllItems.slice();

    if (query) {
      items = items.filter(p => (p.name || '').toLowerCase().includes(query));
    }

    items.sort((a, b) => {
      switch (sortMode) {
        case 'oldest':
          return (a.updatedAt || 0) - (b.updatedAt || 0);
        case 'name-asc':
          return (a.name || '').localeCompare(b.name || '', 'en');
        case 'name-desc':
          return (b.name || '').localeCompare(a.name || '', 'en');
        case 'progress-desc': {
          const pa = a.lineCount ? a.translatedCount / a.lineCount : 0;
          const pb = b.lineCount ? b.translatedCount / b.lineCount : 0;
          return pb - pa || (b.updatedAt || 0) - (a.updatedAt || 0);
        }
        case 'progress-asc': {
          const pa = a.lineCount ? a.translatedCount / a.lineCount : 0;
          const pb = b.lineCount ? b.translatedCount / b.lineCount : 0;
          return pa - pb || (b.updatedAt || 0) - (a.updatedAt || 0);
        }
        case 'newest':
        default:
          return (b.updatedAt || 0) - (a.updatedAt || 0);
      }
    });

    App.dashboardItems = items;

    if (!items.length) {
      list.innerHTML = `
        <div class="no-results">
          <div class="no-results-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          </div>
          <h3 class="no-results-title">No matching projects</h3>
          <p class="no-results-desc">${query ? `No projects found with keyword "<strong>${escapeHtml(query)}</strong>". Try another keyword or clear the search filter.` : 'No projects to display.'}</p>
        </div>
      `;
      return;
    }

    const sentinel = document.createElement('div');
    sentinel.className = 'dashboard-sentinel';
    list.appendChild(sentinel);
    App.dashboardSentinel = sentinel;

    App.dashboardObserver = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && App.dashboardRendered < App.dashboardItems.length) {
        App.renderDashboardPage();
      }
    }, { rootMargin: '300px' });
    App.dashboardObserver.observe(sentinel);

    App.renderDashboardPage();
  },

  revealProject(id) {
    const idx = App.dashboardItems.findIndex(p => p.id === id);
    if (idx < 0) return;
    while (App.dashboardRendered <= idx) App.renderDashboardPage();
    els.projectList.children[idx].scrollIntoView({ block: 'center' });
  },

  renderDashboardPage() {
    const list = els.projectList;
    const sentinel = App.dashboardSentinel;
    if (!sentinel) return;

    const start = App.dashboardRendered;
    const end = Math.min(start + CFG.dashboardPageSize, App.dashboardItems.length);
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      frag.appendChild(App.buildProjectCard(App.dashboardItems[i]));
    }
    App.dashboardRendered = end;
    list.insertBefore(frag, sentinel);

    if (App.dashboardRendered >= App.dashboardItems.length) {
      App.dashboardObserver?.disconnect();
      App.dashboardObserver = null;
      sentinel.remove();
      App.dashboardSentinel = null;
    }
  },

  buildProjectCard(p) {
    const card = document.createElement('div');
    card.className = 'project-card';

    const hasData = p.fileCount || p.lineCount;
    let badge = '';
    let typeClass = '';
    if (hasData) {
      if (p.projectType === 'epub') {
        badge = '<span class="badge badge-epub">EPUB</span>';
        typeClass = 'is-epub';
      } else if (p.projectType === 'json') {
        badge = '<span class="badge badge-json">JSON-VNTP</span>';
        typeClass = 'is-json';
      } else if (p.projectType === 'plugin') {
        const pluginMissing = p.pluginId && !AETL.plugins.getMeta(p.pluginId);
        badge = pluginMissing
          ? `<span class="badge badge-plugin is-missing" title="Plugin ${escapeHtml(p.pluginName || p.pluginId)} isn't installed">PLUGIN REQUIRED</span>`
          : '<span class="badge badge-plugin">PLUGIN</span>';
      }
    }
    if (typeClass) card.classList.add(typeClass);

    const pct = p.lineCount ? Math.min(100, Math.floor(p.translatedCount / p.lineCount * 100)) : 0;
    const isComplete = pct >= 100 && p.lineCount > 0;
    const fillClass = isComplete ? 'project-progress-fill is-complete' : 'project-progress-fill';
    const updatedStr = new Date(p.updatedAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    const updatedTime = new Date(p.updatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    card.innerHTML = `
      <div class="project-card-main">
        <div class="project-card-head">
          <h3>${escapeHtml(p.name)}</h3>
          ${badge}
        </div>
        ${p.lineCount > 0 ? `
        <div class="project-progress">
          <div class="project-progress-bar">
            <div class="${fillClass}" style="width:${pct}%"></div>
          </div>
          <div class="project-progress-text">
            <span>${p.translatedCount}/${p.lineCount} lines</span>
            <span class="pct">${pct}%</span>
          </div>
        </div>
        ` : ''}
        <div class="project-meta">
          <div class="project-meta-item">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>${updatedStr} · ${updatedTime}</span>
          </div>
          <div class="project-meta-item">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span>${p.fileCount} file</span>
          </div>
        </div>
      </div>
      <div class="project-actions">
        <button class="btn btn-primary btn-sm btn-open">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
          Open Project
        </button>
        <div class="project-actions-row">
          <button class="btn btn-ghost btn-rename" title="Rename">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Rename
          </button>
          <button class="btn btn-ghost btn-backup" title="Backup">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Backup
          </button>
          <button class="btn btn-ghost btn-delete" title="Delete">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1.4 14.1A2 2 0 0 1 15.6 22H8.4a2 2 0 0 1-2-1.9L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
            Delete
          </button>
        </div>
      </div>
    `;
    card.querySelector('.btn-open').addEventListener('click', async () => {
      try {
        const data = await Storage.loadProject(p.id);
        if (data.projectType === 'plugin' && data.pluginId && !AETL.plugins.getMeta(data.pluginId)) {
          App.flash(`This project requires the plugin "${data.pluginName || data.pluginId}" to be opened.\nInstall the plugin first via Settings → Open Plugin Manager, then reopen this project.`, true, 'info');
          return;
        }
        App.open(p.id, data);
      } catch (e) {
        App.flash(friendlyError(e, "Couldn't open project: "), true, 'error');
        if (e?.storage) App.loadDashboard();
      }
    });
    card.querySelector('.btn-rename').addEventListener('click', async () => {
      const name = await App.dialogPrompt({ title: 'New name:', value: p.name });
      if (!name?.trim() || name === p.name) return;
      try {
        const data = await Storage.loadProject(p.id);
        data.projectName = name.trim();
        await Storage.saveProject(p.id, data);
        await Storage.upsertProjectIndexEntry(Storage.projectIndexEntry(p.id, data, Date.now()));
        App.loadDashboard();
      } catch (e) {
        App.flash(friendlyError(e, "Couldn't rename: "), true, 'error');
        if (e?.storage) App.loadDashboard();
      }
    });
    card.querySelector('.btn-backup').addEventListener('click', async () => {
      App.backup({ id: p.id, name: p.name });
    });
    card.querySelector('.btn-delete').addEventListener('click', async () => {
      if (!await App.dialogConfirm(`Delete "${p.name}"?`, 'This project and all its data will be permanently deleted.')) return;
      try {
        await Storage.deleteProject(p.id);
        App.removeProjectCard(card, p.id);
      } catch (e) {
        App.flash(friendlyError(e, "Couldn't delete: "), true, 'error');
        if (e?.storage) App.loadDashboard();
      }
    });
    return card;
  },

  removeProjectCard(card, id) {
    App.dashboardAllItems = App.dashboardAllItems.filter(x => x.id !== id);
    App.dashboardItems = App.dashboardItems.filter(x => x.id !== id);
    const count = App.dashboardAllItems.length;
    els.projectCount.textContent = count;
    els.projectCount.hidden = count === 0;
    els.heroActions.style.display = count ? '' : 'none';
    if (count === 0) {
      App.loadDashboard();
      return;
    }
    card.remove();
  },

  async backup(p) {
    const result = await withProgress('Backing up project...', 'Reading data...', async () => {
      Progress.determinate('Backing up project', 'Processing...');
      const r = await buildProjectBackup(p.id, p.name, Progress.update);
      download(URL.createObjectURL(r.blob), r.name);
      return r;
    }, e => friendlyError(e, 'Backup failed: '));
    if (result?.warnings?.length) {
      App.flash('Backup completed with notes:\n- ' + result.warnings.join('\n- '), true, 'info');
    }
  },

  async backupAll() {
    const result = await withProgress('Backing up all projects...', 'Counting projects...', async () => {
      Progress.determinate('Backing up all projects', 'Starting...');
      const r = await backupAll(Progress.update);
      download(URL.createObjectURL(r.blob), r.name);
      return r;
    }, e => e.message === 'No Projects to backup yet.' ? e.message : friendlyError(e, 'Backup all projects failed: '));
    if (result?.warnings?.length) {
      App.flash('Backup completed with notes:\n- ' + result.warnings.join('\n- '), true, 'info');
    }
  },

  async restoreProject(e) {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;
    await AETL.plugins.runHooks('beforeRestore', { fileName: uploadedFile.name });
    const result = await withProgress('Restoring project...', 'Loading archive...', async () => {
      Progress.determinate('Restoring project', 'Reading archive...');
      const r = await parseRestore(await uploadedFile.arrayBuffer(), uploadedFile.name.replace(/\.aetl$/i, ''), Progress.update);
      await App.loadDashboard();
      return r;
    }, e => friendlyError(e, 'Corrupt file: '));
    if (result) {
      await AETL.plugins.runHooks('afterRestore', { fileName: uploadedFile.name, ok: result.ok || 1, single: !!result.single });
      if (result.single) App.flash(`Project "${result.name}" restored!`, false, 'success');
      else {
        const failMsg = result.fail
          ? `, ${result.fail} failed:\n- ${result.errors.slice(0, 5).map(e => `${e.name}: ${e.message}`).join('\n- ')}`
          : '';
        App.flash(`${result.ok} projects successfully restored${failMsg}.`, false, 'success');
      }
    }
    e.target.value = '';
  },

  refresh(keep = true, changedKey = null) {
    State.updateCount();
    State.rebuild();
    if (keep) {
      if (changedKey) {
        App.main.invalidateHeight(changedKey);
      } else {
        App.main.invalidateHeights();
      }
    }
    App.main.setItems(State.rows, keep);
    App.updateFileBadge();
    App.updateButtons();
    App.syncBookmarkUI();
    App.scheduleRenderNames();
    App.updateStatusBar();
    els.btnUndo.disabled = State.undoStack.length === 0;
    els.btnRedo.disabled = State.redoStack.length === 0;
    if (Immersive.isOpen()) Immersive.refresh();
  },

  updateButtons() {
    const has = State.lines.length > 0;
    const sel = State.selected.size > 0;
    [els.btnExport, els.btnProofread, els.btnSelectAll, els.pasteArea, els.btnApply, els.rangeFromInput, els.rangeToInput, els.btnSelectRange, els.btnImmersive].forEach(b => { b.disabled = !has; });
    els.btnClearSelection.disabled = !sel;
    els.btnCopyForAi.disabled = !sel;
    const n = State.selected.size;
    els.btnCopyForAi.textContent = n > 0 ? `Copy ${n} Lines` : 'Copy';
  },

  updateStatusBar() {
    const total = State.lines.length;
    const tl = State.translatedCount;
    const pct = total ? Math.floor((tl / total) * 100) : 0;
    els.progressText.textContent = `${tl}/${total} (${pct}%)`;
  },

  updateFileBadge() {
    const bar = els.stickyFileBar;
    const nameEl = els.stickyFileName;
    const rangeEl = els.stickyFileRange;
    const cb = els.stickyFileCheckbox;
    if (!bar || !nameEl || !App.main) return;

    const scrollTop = els.previewViewport.scrollTop;
    const headers = State.headerIdx;

    if (!headers.length) {
      bar.classList.remove('show');
      nameEl.textContent = '';
      rangeEl.textContent = '';
      cb.disabled = true;
      cb.checked = false;
      cb.indeterminate = false;
      delete cb.dataset.file;
      App.lastFile = null;
      App.fileCache = null;
      return;
    }

    let activeHeaderIdx = -1;
    let lo = 0, hi = headers.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const idx = headers[mid];
      const p = App.main.pos[idx];
      const h = App.main.heights[idx];
      if (p + h <= scrollTop) { activeHeaderIdx = idx; lo = mid + 1; }
      else hi = mid - 1;
    }
    const activeFile = activeHeaderIdx >= 0 ? State.rows[activeHeaderIdx].file : null;

    if (activeFile !== App.lastFile) {
      if (activeFile) {
        App._applyFileBadgeContent(activeFile, nameEl, rangeEl, cb);
        bar.classList.add('show');
      } else {
        nameEl.textContent = '';
        rangeEl.textContent = '';
        cb.disabled = true;
        cb.checked = false;
        cb.indeterminate = false;
        delete cb.dataset.file;
        bar.classList.remove('show');
      }
      App.lastFile = activeFile;
      App.fileCache = null;
    }

    if (activeFile) {
      const fileLineCount = (State.fileLines.get(activeFile) || []).length;
      const key = `${activeFile}:${State.selected.size}:${State.translatedCount}:${fileLineCount}`;
      if (!App.fileCache || App.fileCache.key !== key) {
        App.fileCache = { key, ...App.computeFileCbState(activeFile) };
      }
      cb.disabled = App.fileCache.disabled;
      cb.checked = App.fileCache.checked;
      cb.indeterminate = App.fileCache.indeterminate;
    }
  },

  _applyFileBadgeContent(file, nameEl, rangeEl, cb) {
    nameEl.textContent = baseName(file);
    nameEl.title = file;
    const lines = State.fileLines.get(file) || [];
    rangeEl.textContent = lines.length ? `${lines[0].line_num}-${lines[lines.length - 1].line_num}` : '';
    cb.dataset.file = file;
  },

  toggleFileSelection(cb) {
    const file = cb.dataset.file;
    if (!file) return;
    const lines = State.fileLines.get(file) || [];
    lines.forEach(l => {
      if (isTrans(l)) return;
      if (cb.checked) State.selected.add(l.line_num);
      else State.selected.delete(l.line_num);
    });
    App.syncCheckboxes();
  },

  computeFileCbState(file) {
    const lines = State.fileLines.get(file) || [];
    let sel = 0, un = 0;
    lines.forEach(l => { if (!isTrans(l)) { un++; if (State.selected.has(l.line_num)) sel++; } });
    return {
      disabled: un === 0,
      checked: un > 0 && sel === un,
      indeterminate: sel > 0 && sel < un
    };
  },

  createMainRow() {
    const row = document.createElement('div');
    row.className = 'preview-row';
    const cell = document.createElement('div');
    cell.className = 'checkbox-cell';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const content = document.createElement('div');
    content.className = 'text-content';
    const orig = document.createElement('div');
    orig.className = 'original';
    const trans = document.createElement('div');
    trans.className = 'translated';
    content.append(orig, trans);
    cell.append(cb, content);
    const hdr = document.createElement('div');
    hdr.className = 'file-header-inner';
    const hCb = document.createElement('input');
    hCb.type = 'checkbox';
    const hName = document.createElement('span');
    hName.className = 'file-name';
    const hRange = document.createElement('span');
    hRange.className = 'file-range';
    hdr.append(hCb, hName, hRange);
    const bm = document.createElement('button');
    bm.type = 'button';
    bm.className = 'row-bookmark-btn';
    bm.setAttribute('aria-label', 'Toggle bookmark');
    bm.tabIndex = -1;
    bm.innerHTML = SVG_ICON.bookmark;
    const imgBox = document.createElement('div');
    imgBox.className = 'row-image-box';
    const imgSpinner = document.createElement('div');
    imgSpinner.className = 'row-image-spinner';
    const imgEl = document.createElement('img');
    imgEl.className = 'row-image-el';
    imgEl.alt = '';
    const imgLabel = document.createElement('span');
    imgLabel.className = 'row-image-label';
    imgBox.append(imgSpinner, imgEl, imgLabel);
    imgEl.addEventListener('error', () => imgBox.classList.add('img-error'));
    row.append(cell, hdr, bm, imgBox);
    row._cell = cell; row._cb = cb; row._orig = orig; row._trans = trans;
    row._hdr = hdr; row._hCb = hCb; row._hName = hName; row._hRange = hRange;
    row._bm = bm;
    row._imgBox = imgBox; row._imgEl = imgEl; row._imgLabel = imgLabel; row._imgToken = 0;
    AETL.plugins.runHooksSync('lineCreate', row);
    return row;
  },

  updateMainRow(row, data) {
    if (data.type === 'image') {
      row.className = 'preview-row row-image';
      row._cell.style.display = 'none';
      row._hdr.style.display = 'none';
      row._bm.style.display = 'none';
      row._imgBox.style.display = 'flex';
      row._imgBox.classList.remove('img-error');
      const entry = data.img;
      row._imgLabel.textContent = entry.isCover ? 'EPUB Cover' : 'Image';
      row._imgEl.removeAttribute('src');
      row._imgEl.alt = entry.isCover ? 'EPUB Cover' : 'Image in chapter';
      const token = ++row._imgToken;
      const loadMediaPath = entry.mediaPath;
      const cacheKey = loadMediaPath || entry.zipPath;
      const cached = EpubImages.peekUrl(State.projectId, cacheKey);
      if (cached !== undefined) {
        row._imgBox.classList.remove('img-loading');
        if (cached) row._imgEl.src = cached;
        else row._imgBox.classList.add('img-error');
      } else {
        row._imgBox.classList.add('img-loading');
        const promise = loadMediaPath
          ? EpubImages.getUrlFromMediaPath(State.projectId, loadMediaPath)
          : EpubImages.getUrl(State.projectId, entry.zipPath);
        promise.then(url => {
          if (row._imgToken !== token) return;
          row._imgBox.classList.remove('img-loading');
          if (url) row._imgEl.src = url;
          else row._imgBox.classList.add('img-error');
        }).catch(e => {
          console.error('[image] load failed:', e);
          if (row._imgToken !== token) return;
          row._imgBox.classList.remove('img-loading');
          row._imgBox.classList.add('img-error');
        });
      }
      return;
    }
    row._imgBox.style.display = 'none';
    if (data.type === 'header') {
      row.className = 'preview-row file-header';
      row._cell.style.display = 'none';
      row._hdr.style.display = 'flex';
      row._hName.textContent = baseName(data.file);
      row._hName.title = data.file;
      const lines = State.fileLines.get(data.file) || [];
      row._hRange.textContent = lines.length ? `${lines[0].line_num}-${lines[lines.length - 1].line_num}` : '';
      row._hCb.dataset.file = data.file;
      const st = App.computeFileCbState(data.file);
      row._hCb.disabled = st.disabled;
      row._hCb.checked = st.checked;
      row._hCb.indeterminate = st.indeterminate;
      row._bm.style.display = 'none';
    } else {
      const l = data.line;
      let cls = 'preview-row';
      if (isTrans(l)) cls += ' row-translated';
      if (State.selected.has(l.line_num)) cls += ' row-selected';
      if (State.bookmarkSet.has(l.line_num)) cls += ' row-bookmarked';
      row.className = cls;
      row._cell.style.display = 'flex';
      row._hdr.style.display = 'none';
      row._cb.dataset.num = l.line_num;
      row._cb.checked = State.selected.has(l.line_num);
      row._cb.disabled = isTrans(l);
      row._orig.textContent = App.formatLine(l);
      if (isTrans(l)) {
        row._trans.classList.remove('cell-muted');
        const n = l.trans_name || l.name;
        row._trans.textContent = n ? `${l.line_num}. ${n}: ${l.trans_message}` : `${l.line_num}. ${l.trans_message}`;
      } else {
        row._trans.classList.add('cell-muted');
        row._trans.textContent = '——';
      }
      row._bm.style.display = 'inline-flex';
      row._bm.dataset.num = l.line_num;
      const isBm = State.bookmarkSet.has(l.line_num);
      row._bm.setAttribute('aria-pressed', isBm ? 'true' : 'false');
      row._bm.title = isBm ? 'Remove bookmark' : 'Add bookmark';
      AETL.plugins.runHooksSync('lineRender', row, l);
    }
  },

  patchSelectedRow(num) {
    App.main.patch(`l:${num}`, row => {
      const l = State.byNum.get(num);
      if (!l) return;
      const sel = State.selected.has(num);
      row.classList.toggle('row-selected', sel);
      const cb = row._cb;
      if (cb && Number(cb.dataset.num) === num) {
        cb.checked = sel;
        cb.disabled = isTrans(l);
      }
    });
  },

  syncCheckboxes() {
    App.main.forceUpdate();
    App.updateFileBadge();
    App.updateButtons();
  },

  uniqueNames() {
    const set = new Set();
    for (const l of State.lines) if (l.name) set.add(l.name);
    return Array.from(set).sort();
  },

  scheduleRenderNames() {
    App._namesReq = (App._namesReq || 0) + 1;
    if (App._namesScheduled) return;
    App._namesScheduled = true;
    requestIdleCallback(() => {
      App._namesScheduled = false;
      if (!State.namesDirty) return;
      State.namesDirty = false;
      App.renderNames(App._namesReq);
    });
  },

  async renderNames(req) {
    const arr = App.uniqueNames();
    els.nameTotalCount.textContent = arr.length;

    const hasNames = arr.length > 0;
    const gloss = App.buildGlossaryMap();
    const hasGloss = hasNames && arr.some(n => gloss.has(n));
    const hasMissing = hasNames && arr.some(n => !gloss.has(n));
    els.btnCopyAllNames.disabled = !hasNames;
    els.btnCopyNamesPlain.disabled = !hasNames;
    els.btnCopyNamesWithGlossary.disabled = !hasGloss;
    els.btnCopyNamesMissingGlossary.disabled = !hasMissing;

    const body = els.nameTableBody;
    body.replaceChildren();
    const frag = document.createDocumentFragment();
    for (let i = 0; i < arr.length; i++) {
      if (req !== undefined && req !== App._namesReq) return;
      if (i && i % CFG.chunkSize.namesBatch === 0) {
        body.appendChild(frag);
        await yieldToEvent();
      }
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'mono';
      td.textContent = arr[i];
      td.title = 'Click to copy';
      tr.appendChild(td);
      frag.appendChild(tr);
    }
    body.appendChild(frag);
  },

  async copyAllNames(mode) {
    closeDropdowns();
    const arr = App.uniqueNames();
    if (!arr.length) return;
    const gloss = App.buildGlossaryMap();
    let lines, label;
    if (mode === 'plain') {
      lines = arr;
      label = `${arr.length} names copied!`;
    } else if (mode === 'glossary') {
      lines = arr.map(n => `${n}: ${gloss.get(n) || ''}`);
      label = `${arr.length} names + glossary copied!`;
    } else {
      const missing = arr.filter(n => !gloss.has(n));
      lines = missing.map(n => `${n}: `);
      label = `${missing.length} names (not in glossary) copied!`;
    }
    if (!lines.length) { App.flash('No matching names.'); return; }
    try { await clipboard(lines.join('\n')); App.flash(label); }
    catch { App.flash('Clipboard blocked.', true, 'error'); }
  },

  selectRange() {
    const from = parseInt(els.rangeFromInput.value, 10);
    const to = parseInt(els.rangeToInput.value, 10);
    const max = State.lines.length ? State.maxLineNum() : 0;
    if (isNaN(from) || isNaN(to) || from > to || from < 1 || from > max || to > max) return App.flash('Invalid range.', true, 'error');

    State.selected.clear();
    for (let n = from; n <= to; n++) {
      const l = State.byNum.get(n);
      if (l && !isTrans(l)) State.selected.add(n);
    }
    App.syncCheckboxes();
    App.scrollToLine(from);
  },

  buildGlossaryMap() {
    const map = new Map();
    if (State.vndbEnabled && State.vndbGlossary?.length) {
      State.vndbGlossary.forEach(e => map.set(e[0], e[1]));
    }
    return map;
  },

  formatLine(l) {
    const base = l.name ? `${l.line_num}. ${l.name}: ${l.message}` : `${l.line_num}. ${l.message}`;
    return AETL.plugins.runHooksSync('formatLine', base, l);
  },

  formatLineForAi(l) {
    const name = (!State.ignoreName && l.name) ? `${l.name}: ` : '';
    const base = `${l.line_num}. ${name}${l.message}`;
    return AETL.plugins.runHooksSync('formatLineForAi', base, l);
  },

  async copyForAi() {
    const sel = State.lines.filter(l => State.selected.has(l.line_num));
    const ctx = { lines: sel.map(l => l.line_num), count: sel.length };
    await AETL.plugins.runHooks('beforeCopy', ctx);
    const parts = [];
    if (State.promptEnabled && State.prompt.trim()) parts.push(State.prompt.trim());
    parts.push(FIXED_FORMAT_PROMPT);

    const gloss = App.buildGlossaryMap();
    if (gloss.size > 0) {
      const lines = [];
      gloss.forEach((v, k) => lines.push(`${k}: ${v}`));
      parts.push(`VNDB Glossary:\n${lines.join('\n')}`);
    }
    if (State.customEnabled && State.customRaw.trim()) parts.push(`Custom Glossary:\n${State.customRaw.trim()}`);
    if (State.summaryEnabled) {
      if (State.summary && State.summary.trim()) parts.push(`Previous Summary:\n${State.summary.trim()}`);
      if (State.summaryPrompt && State.summaryPrompt.trim()) parts.push(State.summaryPrompt.trim());
    }
    parts.push(sel.map(App.formatLineForAi).join('\n'));
    const text = await AETL.plugins.runCopyHook(parts.join('\n\n'));

    try {
      await clipboard(text);
      App.flash(`Copied ${sel.length} lines.`);
      AETL.plugins.emit('copy', { count: sel.length, lines: sel.map(l => l.line_num) });
      await AETL.plugins.runHooks('afterCopy', { ...ctx, text });
    } catch {
      els.pasteArea.value = text;
      App.flash(`Clipboard blocked. Text moved to the 'Paste AI result' field.`, true, 'info');
    }
  },

  parseAi(raw, byNum) {
    const allLines = raw.split(_NEWLINE_RE);
    const _fenceRe = /^\s*```\w*\s*$/;
    let fenceCount = 0;
    const textLines = [];
    for (let i = 0; i < allLines.length; i++) {
      if (_fenceRe.test(allLines[i])) fenceCount++;
      else textLines.push(allLines[i]);
    }
    if (fenceCount !== 0 && fenceCount !== 2) {
      return { results: [], errors: ['There must be both an opening and closing ``` together, or none at all.'], seen: new Set(), summary: null };
    }
    const text = textLines.join('\n');
    const tagMatch = text.match(/<translate>([\s\S]*?)<\/translate>/i);
    if (!tagMatch) {
      return { results: [], errors: ['<translate>...</translate> tag not found.'], seen: new Set(), summary: null };
    }
    if ((text.match(/<translate>/gi) || []).length > 1) {
      return { results: [], errors: ['More than one <translate>...</translate> tag found.'], seen: new Set(), summary: null };
    }
    const before = text.slice(0, tagMatch.index).trim();
    const after = text.slice(tagMatch.index + tagMatch[0].length).trim();
    const summary = [before, after].filter(Boolean).join('\n\n').trim() || null;
    const lines = tagMatch[1].split(_NEWLINE_RE);

    const results = [];
    const errors = [];
    const seen = new Set();
    const re = /^(\d+)\.\s+(.*)$/;
    const numRe = /^(\d+)/;
    let lastValidNum = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const m = line.match(re);
      if (!m) {
        const leading = line.match(numRe);
        if (leading) {
          errors.push(`Line ${leading[1]}: Invalid format (must be "N. ..." with a space after the period).`);
        } else if (lastValidNum !== null) {
          errors.push(`Line ${lastValidNum}: Continuation line without a number detected in AI text.`);
        }
        continue;
      }
      const num = Number(m[1]);
      const rest = m[2].trim();
      if (!Number.isInteger(num) || num <= 0) { errors.push(`Line ${num}: Invalid ID.`); continue; }
      if (seen.has(num)) { errors.push(`Line ${num}: Duplicate ID.`); continue; }
      seen.add(num);
      lastValidNum = num;

      const orig = byNum ? byNum.get(num) : null;
      let name = null, msg = rest;
      if (orig && orig.name) {
        const ci = rest.indexOf(': ');
        if (ci > 0) { name = rest.substring(0, ci).trim(); msg = rest.substring(ci + 2).trim(); }
        else if (rest.endsWith(':')) { name = rest.substring(0, rest.length - 1).trim(); msg = ''; }
      }
      results.push({ num, name, msg });
    }
    return { results, errors, seen, summary };
  },

  async applyTranslation() {
    if (!State.lines.length) return;
    const raw = await AETL.plugins.runApplyHook(els.pasteArea.value.trim());
    if (!raw) return App.flash('Empty text.', true, 'error');

    const applyCtx = { raw, selected: Array.from(State.selected) };
    await AETL.plugins.runHooks('beforeApply', applyCtx);

    const { results, errors, seen, summary } = App.parseAi(raw, State.byNum);
    if (!results.length) {
      if (errors.length) return App.flash('REJECTED:\n' + errors.slice(0, CFG.warningDisplayMax).join('\n') + (errors.length > CFG.warningDisplayMax ? `\n+${errors.length - CFG.warningDisplayMax} more errors` : ''), true, 'error');
      return App.flash('No valid data.', true, 'error');
    }

    if (results.length !== State.selected.size) errors.push(`Entry count (${results.length}) ≠ selected count (${State.selected.size}).`);
    State.selected.forEach(n => { if (!seen.has(n)) errors.push(`Line ${n}: Skipped by AI.`); });
    seen.forEach(n => { if (!State.selected.has(n)) errors.push(`Line ${n}: ID not selected.`); });

    const updates = [];
    results.forEach(r => {
      const l = State.byNum.get(r.num);
      if (!l) { errors.push(`Line ${r.num}: ID does not exist.`); return; }
      if (State.ignoreName) r.name = null;
      const hasOn = !!(l.name || '').trim();
      const hasTn = !!(r.name || '').trim();
      const hasMsg = !!(l.message || '').trim();
      if (!State.ignoreName && hasOn && !hasTn) errors.push(`Line ${r.num}: Name removed by AI.`);
      else if (!State.ignoreName && !hasOn && hasTn) errors.push(`Line ${r.num}: Narrative but has a name.`);
      else if (!r.msg && hasMsg) errors.push(`Line ${r.num}: Empty message.`);
      else updates.push({ line: l, item: r });
    });

    if (errors.length) return App.flash('REJECTED:\n' + errors.slice(0, CFG.warningDisplayMax).join('\n') + (errors.length > CFG.warningDisplayMax ? `\n+${errors.length - CFG.warningDisplayMax} more errors` : ''), true, 'error');

    pushHistory();
    updates.forEach(({ line, item }) => {
      line.trans_message = item.msg;
      line.is_translated = true;
      line.trans_name = State.ignoreName ? null : (item.name || line.trans_name || null);
      State.selected.delete(line.line_num);
    });

    if (State.summaryEnabled && summary) State.summary = summary;

    els.pasteArea.value = '';
    State.namesDirty = true;
    State.contentVersion++;
    const changedKeys = updates.map(u => `l:${u.line.line_num}`);
    changedKeys.forEach(k => App.main.invalidateHeight(k));
    App.main.setItems(State.rows, true);
    App.updateFileBadge();
    App.updateButtons();
    App.syncBookmarkUI();
    App.scheduleRenderNames();
    State.updateCount();
    App.updateStatusBar();
    els.btnUndo.disabled = State.undoStack.length === 0;
    els.btnRedo.disabled = State.redoStack.length === 0;
    State.queueSave();
    const nums = updates.map(u => u.line.line_num);
    const incMsg = App.applyIncrement(nums);
    App.flash(`${updates.length} lines successfully applied.${incMsg || ''}`);
    AETL.plugins.emit('apply', { count: updates.length, lines: nums });
    await AETL.plugins.runHooks('afterApply', { count: updates.length, lines: nums });
  },

  lastTranslatedNum() {
    let last = 0;
    for (const l of State.lines) if (isTrans(l) && l.line_num > last) last = l.line_num;
    return last;
  },

  nextUntranslatedAfter(num) {
    let next = null;
    for (const l of State.lines) {
      if (!isTrans(l) && l.line_num > num && (next === null || l.line_num < next)) next = l.line_num;
    }
    return next;
  },

  prefillIncrement() {
    const step = Math.max(1, Math.floor(Number(State.incrementStep) || 100));
    const max = State.maxLineNum();
    if (!max) return;
    const from = App.nextUntranslatedAfter(App.lastTranslatedNum());
    if (from === null) {
      els.rangeFromInput.value = '';
      els.rangeToInput.value = '';
      State.selected.clear();
      App.syncCheckboxes();
      return;
    }
    els.rangeFromInput.value = from;
    els.rangeToInput.value = Math.min(from + step - 1, max);
    App.selectRange();
  },

  applyIncrement(applied) {
    if (!State.incrementEnabled || !State.lines.length) return null;
    const step = Math.max(1, Math.floor(Number(State.incrementStep) || 100));
    const max = State.maxLineNum();
    const pf = parseInt(els.rangeFromInput.value, 10);
    const pt = parseInt(els.rangeToInput.value, 10);
    const hasRange = Number.isFinite(pf) && Number.isFinite(pt) && pf >= 1 && pt >= pf;
    let base = 0;
    if (applied.length) base = Math.max(...applied);
    if (hasRange && pt > base) base = pt;
    if (!base) base = App.lastTranslatedNum();
    const from = App.nextUntranslatedAfter(base);
    if (from === null) {
      els.rangeFromInput.value = '';
      els.rangeToInput.value = '';
      State.selected.clear();
      App.syncCheckboxes();
      return ' All lines are covered.';
    }
    els.rangeFromInput.value = from;
    els.rangeToInput.value = Math.min(from + step - 1, max);
    App.selectRange();
    return ` Next range ${from}-${Math.min(from + step - 1, max)} selected.`;
  },

  _swapHistory(dir) {
    const stack = dir === 'undo' ? State.undoStack : State.redoStack;
    if (!stack.length) return;
    const from = stack.pop();
    const oppStack = dir === 'undo' ? State.redoStack : State.undoStack;
    oppStack.push(snapshot());
    trimHistory(oppStack);
    State.lines = from.lines.map(normalizeLine);
    State.selected = new Set(from.selected);
    State.namesDirty = true;
    State.contentVersion++;
    App.refresh(true);
    State.queueSave();
  },
  undo() { App._swapHistory('undo'); },
  redo() { App._swapHistory('redo'); },

  openLineEditor(num) {
    const l = State.byNum.get(num);
    if (!l) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount) sel.removeAllRanges();
    App.activeLine = num;
    AETL.plugins.runHooksSync('lineOpen', num, l);
    els.lineEditorTitle.textContent = `Edit Line ${num}`;
    els.lineOriginalView.value = l.name ? `${l.name}: ${l.message}` : l.message;
    els.lineNameWrap.style.display = l.name ? 'block' : 'none';
    els.lineNameInput.value = l.name ? (l.trans_name || '') : '';
    els.lineNameInput.placeholder = l.name || '';
    els.lineMessageInput.value = (l.trans_message || '').trim();
    els.lineTranslatedCheck.checked = isTrans(l);
    toggleModal(els.lineEditorModal, true);
  },

  saveLineEditor() {
    const l = State.byNum.get(App.activeLine);
    if (!l) return;
    const msg = els.lineMessageInput.value.trim().replace(_NEWLINE_RE, '\\n');
    const hasMsg = !!(l.message || '').trim();
    if (els.lineTranslatedCheck.checked && !msg && hasMsg) return App.flash('Empty message.', true, 'error');
    const before = { trans_message: l.trans_message, trans_name: l.trans_name, is_translated: l.is_translated };

    pushHistory();
    l.trans_message = msg || null;
    l.is_translated = els.lineTranslatedCheck.checked && (!!msg || !hasMsg);
    if (l.name) l.trans_name = els.lineNameInput.value.trim().replace(_NEWLINE_RE, '\\n') || null;

    State.namesDirty = true;
    State.contentVersion++;
    State.adjustCount(before.is_translated, l.is_translated);
    toggleModal(els.lineEditorModal, false);
    App.refreshLine(l.line_num);
    if (els.proofreadModal.classList.contains('open')) App.renderProofread();
    State.queueSave();
    AETL.plugins.runHooksSync('lineSave', l.line_num, l, before);
  },

  refreshLine(num) {
    const key = `l:${num}`;
    if (!App.main.refreshItem(key)) App.main.invalidateHeight(key);
    App.updateFileBadge();
    App.updateButtons();
    App.updateStatusBar();
    App.scheduleRenderNames();
    els.btnUndo.disabled = State.undoStack.length === 0;
    els.btnRedo.disabled = State.redoStack.length === 0;
  },

  highlight(text, re) {
    if (!re) return document.createTextNode(text);
    const frag = document.createDocumentFragment();
    let last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.substring(last, m.index)));
      const mark = document.createElement('mark');
      mark.className = 'highlight';
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.substring(last)));
    return frag;
  },

  syncProofread() {
    PROOFREAD_FIELDS.forEach(({ id, key, type }) => {
      State[key] = type === 'check' ? els[id].checked : els[id].value;
    });
    if (State.projectId) State.queueSave();
  },

  openProofread() {
    PROOFREAD_FIELDS.forEach(({ id, key, type }) => {
      const el = els[id];
      if (type === 'check') el.checked = State[key]; else el.value = State[key];
    });
    toggleModal(els.proofreadModal, true);
    requestAnimationFrame(() => App.renderProofread());
  },

  renderProofread() {
    if (!els.proofreadModal.classList.contains('open')) return;
    const q = els.proofreadSearchInput.value;
    const regex = els.proofreadRegexCheck.checked;
    const exact = els.proofreadExactCheck.checked;
    const caseSensitive = els.proofreadCaseCheck.checked;
    const translatedOnly = els.proofreadTranslatedOnlyCheck.checked;
    const scope = els.proofreadScope.value;

    App.highlightRe = q ? buildRe(q, regex, exact, caseSensitive) : null;

    const matches = proofreadSearch(State.lines, q, regex, exact, caseSensitive, scope, translatedOnly);
    els.proofreadStatus.textContent = `Found ${matches.length} lines.`;
    const sig = `${q}\u0001${regex}\u0002${exact}\u0003${caseSensitive}\u0004${translatedOnly}\u0005${scope}`;
    const sigChanged = sig !== App.lastProofreadSig;
    const contentChanged = State.contentVersion !== App.lastProofreadContentVer;
    App.lastProofreadSig = sig;
    App.lastProofreadContentVer = State.contentVersion;
    if (sigChanged) {
      App.pr.setItems(matches, false);
    } else {
      if (contentChanged) App.pr.invalidateHeights();
      App.pr.setItems(matches, true);
    }
  },

  createPrRow() {
    const row = document.createElement('div');
    row.className = 'preview-row';
    const wrap = document.createElement('div');
    wrap.className = 'text-content';
    const meta = document.createElement('div');
    meta.className = 'file-meta';
    const orig = document.createElement('div');
    orig.className = 'original';
    const trans = document.createElement('div');
    trans.className = 'translated';
    wrap.append(meta, orig, trans);
    row.append(wrap);
    row._wrap = wrap; row._meta = meta; row._orig = orig; row._trans = trans;
    return row;
  },

  updatePrRow(row, d) {
    row._wrap.dataset.num = d.num;
    row._meta.textContent = `File: ${d.file} | Line: ${d.num}`;
    row._orig.replaceChildren();
    row._trans.replaceChildren();

    const onlyTrans = els.proofreadTranslatedOnlyCheck.checked;
    const scope = els.proofreadScope.value;

    const build = (name, msg, hl) => {
      const frag = document.createDocumentFragment();
      if (name) {
        if (hl && (scope === 'all' || scope === 'name')) frag.appendChild(App.highlight(name, App.highlightRe));
        else frag.appendChild(document.createTextNode(name));
        frag.appendChild(document.createTextNode(': '));
      }
      if (hl && (scope === 'all' || scope === 'message')) frag.appendChild(App.highlight(msg, App.highlightRe));
      else frag.appendChild(document.createTextNode(msg));
      return frag;
    };

    row._trans.classList.toggle('cell-muted', !d.isTrans);

    if (onlyTrans) {
      row._orig.textContent = d.origName ? `${d.origName}: ${d.origMsg}` : d.origMsg;
      if (d.isTrans) row._trans.appendChild(build(d.transName, d.transMsg, true));
      else row._trans.textContent = '——';
    } else {
      row._orig.appendChild(build(d.origName, d.origMsg, true));
      if (d.isTrans) row._trans.textContent = d.transName ? `${d.transName}: ${d.transMsg}` : d.transMsg;
      else row._trans.textContent = '——';
    }
  },

  replaceAll() {
    const q = els.proofreadSearchInput.value;
    const repl = els.proofreadReplaceInput.value;
    if (!q) return App.flash('Empty search!', true, 'error');

    const regex = els.proofreadRegexCheck.checked;
    const exact = els.proofreadExactCheck.checked;
    const caseSensitive = els.proofreadCaseCheck.checked;
    const translatedOnly = els.proofreadTranslatedOnlyCheck.checked;
    const scope = els.proofreadScope.value;

    const result = replaceAll(State.lines, q, repl, regex, exact, caseSensitive, scope, translatedOnly);

    if (!result.count) return App.flash('No matches.', true, 'info');

    pushHistory();
    const modMap = new Map(result.modified.map(m => [m.line_num, m]));
    for (const l of State.lines) {
      const m = modMap.get(l.line_num);
      if (m) {
        if (m.message !== undefined) l.message = m.message;
        if (m.trans_message !== undefined) l.trans_message = m.trans_message;
        if (m.name !== undefined) l.name = m.name;
        if (m.trans_name !== undefined) l.trans_name = m.trans_name;
      }
    }
    State.namesDirty = true;
    State.contentVersion++;
    App.refresh(true);
    App.renderProofread();
    State.queueSave();
    App.flash(`Successfully replaced ${result.count} lines.`, false, 'success');
  },

  _toolbarBtnContainer: null,
  _dashboardCardsEl: null,
  _themeEl: null,
  _pluginMenuItems: { import: [], export: [] },

  renderPluginMenuItems() {
    const impDropdown = els.importDropdown;
    const expDropdown = els.exportDropdown;
    for (const btn of App._pluginMenuItems.import) { try { btn.remove(); } catch {} }
    for (const btn of App._pluginMenuItems.export) { try { btn.remove(); } catch {} }
    App._pluginMenuItems.import = [];
    App._pluginMenuItems.export = [];
    for (const name of AETL.plugins.listImporters()) {
      const btn = document.createElement('button');
      btn.className = 'dropdown-item';
      btn.textContent = name;
      btn.addEventListener('click', () => {
        closeDropdowns();
        const importer = AETL.plugins.getImporter(name);
        if (importer?.handler) {
          Promise.resolve(importer.handler({ api: importer.inst?.api, state: PluginHost.state.snapshot() }))
            .catch(e => App.flash('Import failed: ' + (e?.message || e)));
        }
      });
      if (!impDropdown.querySelector('.dropdown-sep')) {
        const sep = document.createElement('div');
        sep.className = 'dropdown-sep';
        impDropdown.appendChild(sep);
      }
      impDropdown.appendChild(btn);
      App._pluginMenuItems.import.push(btn);
    }
    for (const name of AETL.plugins.listExporters()) {
      const btn = document.createElement('button');
      btn.className = 'dropdown-item';
      btn.textContent = name;
      btn.addEventListener('click', () => {
        closeDropdowns();
        const exporter = AETL.plugins.getExporter(name);
        if (exporter?.handler) {
          Promise.resolve(exporter.handler({ api: exporter.inst?.api, state: PluginHost.state.snapshot(), lines: State.lines.map(AETL.plugins.toPluginLine) }))
            .catch(e => App.flash('Export failed: ' + (e?.message || e)));
        }
      });
      if (!expDropdown.querySelector('.dropdown-sep')) {
        const sep = document.createElement('div');
        sep.className = 'dropdown-sep';
        expDropdown.appendChild(sep);
      }
      expDropdown.appendChild(btn);
      App._pluginMenuItems.export.push(btn);
    }
  },

  _ensureToolbarBtnContainer() {
    if (App._toolbarBtnContainer) return App._toolbarBtnContainer;
    const group = document.querySelector('.toolbar-group');
    if (!group) return null;
    const wrap = document.createElement('div');
    wrap.className = 'toolbar-plugin-btns';
    group.appendChild(wrap);
    App._toolbarBtnContainer = wrap;
    return wrap;
  },

  addToolbarButton(label, onClick, opts = {}) {
    const container = App._ensureToolbarBtnContainer();
    if (!container) return null;
    const btn = document.createElement('button');
    btn.className = 'btn ' + (opts.className || 'btn-ghost');
    btn.type = 'button';
    btn.title = String(opts.title || label || '');
    btn.setAttribute('aria-label', String(opts.title || label || ''));
    btn.textContent = String(label ?? '');
    btn.addEventListener('click', () => {
      try { onClick && onClick(); } catch (e) { App.flash(String(e?.message || e)); }
    });
    container.appendChild(btn);
    return btn;
  },

  removeToolbarButton(btn) {
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
  },

  createModal(title, bodyHtml, opts = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'backdrop aetl-plugin-modal';
    const actionsHtml = opts.actions || '';
    overlay.innerHTML = `
      <div class="modal ${opts.wide ? 'modal-wide' : ''} ${opts.xl ? 'modal-xl' : ''}" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>${escapeHtml(String(title ?? ''))}</h3></div>
        <div class="modal-body">${typeof bodyHtml === 'string' ? bodyHtml : ''}</div>
        ${actionsHtml ? `<div class="modal-actions">${actionsHtml}</div>` : '<div class="modal-actions"><span class="grow"></span><button type="button" class="btn btn-ghost aetl-plugin-modal-close">Close</button></div>'}
      </div>`;
    if (typeof bodyHtml === 'object' && bodyHtml && bodyHtml.nodeType) {
      overlay.querySelector('.modal-body').replaceChildren(bodyHtml);
    }
    document.body.appendChild(overlay);
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('open')));
    overlay.querySelector('.aetl-plugin-modal-close')?.addEventListener('click', () => App.closeModal(overlay));
    overlay.addEventListener('click', e => { if (e.target === overlay) App.closeModal(overlay); });
    return overlay;
  },

  closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    setTimeout(() => { try { modal.remove(); } catch {} }, 360);
  },

  _ensureDashboardCardsEl() {
    if (App._dashboardCardsEl) return App._dashboardCardsEl;
    const content = els.projectList.parentElement;
    if (!content) return null;
    const wrap = document.createElement('div');
    wrap.className = 'plugin-dashboard-cards';
    content.insertBefore(wrap, content.firstChild);
    App._dashboardCardsEl = wrap;
    return wrap;
  },

  addDashboardCard(cardEl) {
    const container = App._ensureDashboardCardsEl();
    if (!container || !cardEl) return null;
    container.appendChild(cardEl);
    return cardEl;
  },

  removeDashboardCard(cardEl) {
    if (cardEl && cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
  },

  setTheme(vars) {
    if (!isPlainObject(vars)) return;
    if (!App._themeEl) {
      App._themeEl = document.createElement('style');
      App._themeEl.id = 'aetl-plugin-theme';
      document.head.appendChild(App._themeEl);
    }
    const decls = [];
    for (const [k, v] of Object.entries(vars)) {
      decls.push(`  ${k.startsWith('--') ? k : '--' + k}: ${v};`);
    }
    App._themeEl.textContent = `:root {\n${decls.join('\n')}\n}`;
  },

  injectStyle(css, id) {
    const existing = id ? document.getElementById('aetl-plugin-style-' + id) : null;
    if (existing) { existing.textContent = css; return existing; }
    const el = document.createElement('style');
    if (id) el.id = 'aetl-plugin-style-' + id;
    el.textContent = css;
    document.head.appendChild(el);
    return el;
  },

  dialogPrompt(title, def) {
    const opts = (typeof title === 'string')
      ? { title, value: def ?? '' }
      : title;
    return AETL.dialogs.prompt(opts);
  },

  async dialogConfirm(title, body) {
    return AETL.dialogs.confirm({
      title,
      bodyHtml: body ? `<p class="m-0">${escapeHtml(body).replace(/\n/g, '<br>')}</p>` : '',
      confirmLabel: 'OK',
      cancelLabel: 'Cancel'
    });
  },

  async dialogAlert(title, body) {
    const msg = body ? `${title}\n\n${body}` : title;
    App.flash(msg, true, 'info');
  },

  updateLineExternal(num, changes) {
    const l = State.byNum.get(num);
    if (!l || !isPlainObject(changes)) return false;
    pushHistory();
    if ('message' in changes) l.message = String(changes.message ?? '');
    if ('name' in changes) l.name = changes.name == null ? null : stripNewlines(changes.name);
    if ('trans_message' in changes) l.trans_message = changes.trans_message == null ? null : String(changes.trans_message);
    if ('trans_name' in changes) l.trans_name = changes.trans_name == null ? null : stripNewlines(changes.trans_name);
    if ('is_translated' in changes) l.is_translated = !!changes.is_translated;
    State.namesDirty = true;
    State.contentVersion++;
    App.refresh(true);
    State.queueSave();
    return true;
  },

  addLineExternal(line) {
    if (!isPlainObject(line) || !line.message) return null;
    const num = State.nextLineNum();
    const newLine = {
      line_num: num,
      file: String(line.file || State.files[0] || 'plugin'),
      name: line.name == null ? null : stripNewlines(line.name),
      message: String(line.message).replace(_NEWLINE_RE, '\\n').trim(),
      trans_name: null,
      trans_message: null,
      is_translated: false,
      _n: 1
    };
    pushHistory();
    State.lines.push(newLine);
    if (!State.files.includes(newLine.file)) State.files.push(newLine.file);
    State.namesDirty = true;
    State.contentVersion++;
    App.refresh(true);
    State.queueSave();
    return num;
  },

  removeLineExternal(num) {
    const l = State.byNum.get(num);
    if (!l) return false;
    pushHistory();
    State.lines = State.lines.filter(x => x.line_num !== num);
    State.selected.delete(num);
    State.bookmarks = State.bookmarks.filter(b => b !== num);
    State.bookmarkSet.delete(num);
    State.namesDirty = true;
    State.contentVersion++;
    App.refresh(true);
    State.queueSave();
    return true;
  },

  markTranslatedExternal(num, transMsg, transName) {
    const l = State.byNum.get(num);
    if (!l) return false;
    pushHistory();
    l.trans_message = String(transMsg ?? '').replace(_NEWLINE_RE, '\\n').trim() || null;
    l.is_translated = true;
    if (transName != null) l.trans_name = stripNewlines(transName);
    State.namesDirty = true;
    State.contentVersion++;
    App.refresh(true);
    State.queueSave();
    return true;
  }
};

