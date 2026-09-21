// AETL - Element cache (els)
'use strict';

const els = {};

function cacheEls() {
  const ids = [
    'globalToast',
    'dashboardView', 'workspaceView', 'projectList',
    'projectCount', 'projectSearch', 'projectSearchClear', 'projectSort', 'projectSortBox', 'projectSortTrigger', 'projectSortMenu', 'projectSortLabel',
    'btnNewProject', 'btnRestoreProject', 'btnDashboardSettings', 'btnDashboardSettingsClose',
    'btnBackupAll', 'btnWipeAllData',
    'btnBackToDashboard', 'projectNameDisplay', 'dynamicToolbarWrap',
    'workspaceToolbar', 'btnToggleHeader', 'btnShowHeader',
    'btnToolsDrawer', 'btnToolsDrawerClose', 'toolsScrim',
    'btnImportMain', 'importDropdown',
    'btnImportFile', 'btnImportFolder', 'btnImportZip',
    'btnImportTranslation', 'btnImportUntranslated', 'btnImportOriginal',
    'importFileInput', 'importFolderInput', 'importZipInput',
    'importTranslationInput', 'importUntranslatedInput', 'importOriginalInput',
    'restoreProjectInput',
    'btnExport', 'exportDropdown', 'btnExportProject', 'btnExportTranslation', 'btnExportUntranslated', 'btnExportOriginal',
    'btnProofread', 'btnGlossary', 'btnContext', 'btnSettings', 'btnImmersive',
    'immersiveView', 'immersiveViewport', 'immersiveContainer', 'immersiveTitle',
    'btnShowImmersiveHeader', 'btnHideImmersiveHeader',
    'btnImmersiveMode', 'btnImmersiveStyle', 'immersiveStylePanel', 'btnImmersiveClose',
    'btnImmersiveFontDown', 'immersiveFontValue', 'btnImmersiveFontUp', 'immersiveWidthGroup', 'immersiveThemeGroup',
    'btnImmersiveBookmarks', 'immersiveBookmarkPanel', 'immersiveBookmarkCount', 'immersiveBookmarkList',
    'previewViewport', 'previewContainer', 'stickyFileBar', 'stickyFileName', 'stickyFileRange', 'stickyFileCheckbox',
    'progressText',
    'rangeFromInput', 'rangeToInput', 'btnSelectRange', 'btnClearSelection', 'btnSelectAll', 'btnCopyForAi',
    'pasteArea', 'btnUndo', 'btnApply', 'btnRedo',
    'nameTotalCount', 'nameTableBody',
    'btnCopyAllNames', 'copyNamesDropdown',
    'btnCopyNamesPlain', 'btnCopyNamesWithGlossary', 'btnCopyNamesMissingGlossary',
    'settingsModal', 'btnSettingsBasicReset', 'settingsIgnoreNameCheck', 'settingsPromptCheck',
    'settingsJumpToContextCheck', 'settingsHideToolsCheck',
    'btnSettingsLayoutReset', 'settingsToolsPosMobile', 'settingsToolsPosDesktop',
    'btnSettingsIncrementReset', 'settingsIncrementCheck', 'incrementStepWrap', 'settingsIncrementStepInput',
    'btnSettingsPromptReset', 'settingsPromptInput', 'btnSettingsEpubReset', 'settingsEpubTagsInput',
    'btnSettingsCancel', 'btnSettingsSave',
    'glossaryModal', 'btnGlossaryVndbReset', 'glossaryVndbCheck', 'glossaryVndbWrap',
    'glossaryVndbIdInput', 'btnGlossaryVndbFetch', 'glossaryVndbStatus', 'glossaryVndbPreviewArea',
    'btnGlossaryCustomReset', 'glossaryCustomCheck', 'glossaryCustomWrap', 'glossaryCustomInput',
    'btnGlossaryCancel', 'btnGlossarySave',
    'contextModal', 'btnSummaryReset', 'summaryEnabledCheck', 'summaryWrap',
    'summaryPromptInput', 'summaryStoredInput', 'btnSummaryPromptReset', 'btnSummaryStoredReset', 'btnContextCancel', 'btnContextSave',
    'lineEditorModal', 'lineEditorTitle', 'lineOriginalView', 'lineNameWrap',
    'lineNameInput', 'lineMessageInput', 'lineTranslatedCheck', 'btnLineCancel', 'btnLineSave',
    'proofreadModal', 'proofreadSearchInput', 'proofreadScope', 'proofreadRegexCheck',
    'proofreadCaseCheck', 'proofreadExactCheck', 'proofreadTranslatedOnlyCheck',
    'btnProofreadReset', 'proofreadReplaceInput', 'btnProofreadReplaceAll',
    'proofreadStatus', 'proofreadContainer', 'btnProofreadClose',
    'dashboardSettingsModal', 'shortcutModal', 'shortcutStatus', 'shortcutList', 'btnShortcutsOpen', 'btnShortcutsClose', 'btnShortcutsResetAll',
    'btnOpenPlugins',
    'pluginPanels',
    'opfsExplorerModal', 'btnOpfsExplorerOpen', 'btnOpfsExplorerClose',
    'opfsList', 'opfsEmpty', 'opfsEmptyText', 'opfsCrumbs', 'opfsLoading', 'btnOpfsRefresh',
    'busyOverlay', 'busyTitle', 'busyMsg', 'busyBarFill', 'busyActions', 'busyCancel',
    'bootSplash',
    'btnBookmarks', 'bookmarkPanel',
    'bookmarkPanelCount', 'bookmarkList', 'btnBookmarkClear',
    'imageLightbox', 'imageLightboxImg'
  ];
  for (const id of ids) els[id] = $(id);
  els.split = document.querySelector('.split');
  els.heroActions = document.querySelector('.hero .actions');
}

