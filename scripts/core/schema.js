// AETL - Schemas: settings fields, proofread fields, state schema
'use strict';

const SETTINGS_FIELDS = [
  { id: 'settingsIgnoreNameCheck',    key: 'ignoreName',       type: 'check',  def: false, group: 'basic' },
  { id: 'settingsPromptCheck',        key: 'promptEnabled',    type: 'check',  def: true,  group: 'basic' },
  { id: 'settingsJumpToContextCheck', key: 'jumpToContext',    type: 'check',  def: false, group: 'basic' },
  { id: 'settingsHideToolsCheck',     key: 'hideTools',        type: 'check',  def: false, group: 'basic' },
  { id: 'settingsToolsPosMobile',     key: 'toolsPosMobile',   type: 'value',  def: 'bottom', group: 'layout' },
  { id: 'settingsToolsPosDesktop',    key: 'toolsPosDesktop',  type: 'value',  def: 'right',  group: 'layout' },
  { id: 'settingsIncrementCheck',     key: 'incrementEnabled', type: 'check',  def: false, group: 'increment' },
  { id: 'settingsIncrementStepInput', key: 'incrementStep',    type: 'number', def: 100,   group: 'increment' },
  { id: 'settingsPromptInput',        key: 'prompt',           type: 'value', def: DEFAULT_PROMPT, group: 'prompt' },
  { id: 'settingsEpubTagsInput',      key: 'epubTags',         type: 'value', def: 'p',   group: 'epub' }
];

const PROOFREAD_FIELDS = [
  { id: 'proofreadScope',               key: 'prScope',          type: 'value', def: 'all'   },
  { id: 'proofreadRegexCheck',          key: 'prRegex',          type: 'check', def: false   },
  { id: 'proofreadCaseCheck',           key: 'prCase',           type: 'check', def: false   },
  { id: 'proofreadExactCheck',          key: 'prExact',          type: 'check', def: false   },
  { id: 'proofreadTranslatedOnlyCheck', key: 'prTranslatedOnly', type: 'check', def: false   }
];

const STATE_SCHEMA = [
  { key: 'projectName',        def: '' },
  { key: 'projectType',        def: 'uninitialized',        coerce: true },
  { key: 'pluginId',           def: null,                   coerce: true },
  { key: 'pluginName',         def: null,                   coerce: true },
  { key: 'pluginData',         def: null,                   coerce: true },
  { key: 'epubTags',           def: 'p',                    coerce: true },
  { key: 'epubSourceId',       def: null,                   coerce: true },
  { key: 'prompt',             def: DEFAULT_PROMPT,         coerce: true, store: 'prompt_header' },
  { key: 'ignoreName',         def: false,                  store: 'ignoreNameTranslation' },
  { key: 'promptEnabled',      def: true },
  { key: 'summaryEnabled',   def: false },
  { key: 'summaryPrompt',    def: DEFAULT_SUMMARY_PROMPT, coerce: true },
  { key: 'summary',          def: '' },
  { key: 'vndbEnabled',        def: false },
  { key: 'vndbId',             def: '' },
  { key: 'vndbGlossary',       def: [],                     coerce: true },
  { key: 'customEnabled',      def: false },
  { key: 'customRaw',          def: '' },
  { key: 'jumpToContext',      def: false },
  { key: 'hideTools',          def: false },
  { key: 'toolsPosMobile',     def: 'bottom',               coerce: true },
  { key: 'toolsPosDesktop',    def: 'right',                coerce: true },
  { key: 'incrementEnabled',   def: false },
  { key: 'incrementStep',      def: 100,                    coerce: true },
  { key: 'pluginSettings',    def: {},                     coerce: true },
  { key: 'prScope',            def: 'all',                  coerce: true, store: 'proofreadScope' },
  { key: 'prRegex',            def: false,                  store: 'proofreadRegex' },
  { key: 'prCase',             def: false,                  store: 'proofreadCaseSensitive' },
  { key: 'prExact',            def: false,                  store: 'proofreadExactMatch' },
  { key: 'prTranslatedOnly',   def: false,                  store: 'proofreadTranslatedOnly' },
  { key: 'bookmarks',          def: [],                     coerce: true },
  { key: 'images',             def: [],                     coerce: true }
];
