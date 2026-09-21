// AETL - App theme controller
'use strict';

const Theme = {
  current: APP_THEME_DEFAULT,
  metaColor: null,
  metaScheme: null,
  _resizeObs: null,
  _resizeTimer: 0,

  async init() {
    Theme.metaColor = document.querySelector('meta[name="theme-color"]');
    Theme.metaScheme = document.querySelector('meta[name="color-scheme"]');
    const raw = await Storage.readTheme();
    if (isPlainObject(raw) && APP_THEMES.includes(raw.theme)) Theme.current = raw.theme;
    Theme.apply();
    Theme.bind();
  },

  bind() {
    els.appThemeGroup.addEventListener('click', e => {
      const btn = e.target.closest('[data-theme]');
      if (btn) Theme.set(btn.dataset.theme);
    });
    if (typeof ResizeObserver !== 'undefined') {
      Theme._resizeObs = new ResizeObserver(() => {
        clearTimeout(Theme._resizeTimer);
        Theme._resizeTimer = setTimeout(() => Theme.positionThumb(), 80);
      });
      Theme._resizeObs.observe(els.appThemeGroup);
    }
  },

  positionThumb() {
    const group = els.appThemeGroup;
    if (!group) return;
    const thumb = group.querySelector('.theme-seg-thumb');
    const active = group.querySelector('.theme-seg-btn.active');
    if (!thumb || !active) return;
    thumb.style.left = `${active.offsetLeft}px`;
    thumb.style.width = `${active.offsetWidth}px`;
  },

  apply() {
    const t = Theme.current;
    document.documentElement.dataset.theme = t;
    if (els.appThemeGroup) {
      els.appThemeGroup.querySelectorAll('[data-theme]').forEach(b => b.classList.toggle('active', b.dataset.theme === t));
      Theme.positionThumb();
    }
    if (Theme.metaColor) Theme.metaColor.setAttribute('content', t === 'sepia' ? '#f4eddc' : t === 'light' ? '#fbfbfd' : '#000000');
    if (Theme.metaScheme) Theme.metaScheme.setAttribute('content', t === 'dark' ? 'dark' : 'light');
  },

  set(theme) {
    if (!APP_THEMES.includes(theme) || theme === Theme.current) return;
    Theme.current = theme;
    Storage.writeTheme({ theme }).catch(e => console.error('[theme] save failed:', e));
    Theme.apply();
  }
};
