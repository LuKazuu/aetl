// AETL - Immersive reading mode
'use strict';

const Immersive = {
  scroller: null,
  prefs: { ...READER.defaults },
  barEl: null,

  async init() {
    Immersive.barEl = document.querySelector('.immersive-bar');
    Immersive.scroller = new Scroller(
      els.immersiveViewport, els.immersiveContainer,
      Immersive.createRow, Immersive.updateRow, Immersive.identityOf, CFG.reader
    );
    Immersive.bind();
    Immersive.loadPrefs(await Storage.readReaderPrefs());
    Immersive.applyPrefs();
  },

  bind() {
    els.btnImmersiveMode.addEventListener('click', () => Immersive.setMode(Immersive.prefs.mode === 'translation' ? 'original' : 'translation'));
    els.btnImmersiveClose.addEventListener('click', () => Immersive.close());
    els.btnImmersiveStyle.addEventListener('click', () => Immersive.setStylePanel(!Immersive.stylePanelOpen()));
    els.btnImmersiveFontDown.addEventListener('click', () => Immersive.setFont(Immersive.prefs.fontSize - 1, 'down'));
    els.btnImmersiveFontUp.addEventListener('click', () => Immersive.setFont(Immersive.prefs.fontSize + 1, 'up'));
    els.immersiveWidthGroup.addEventListener('click', e => {
      const btn = e.target.closest('[data-width]');
      if (btn) Immersive.setWidth(btn.dataset.width);
    });
    els.immersiveThemeGroup.addEventListener('click', e => {
      const btn = e.target.closest('[data-theme]');
      if (btn) Immersive.setTheme(btn.dataset.theme);
    });
    els.btnHideImmersiveHeader.addEventListener('click', () => Immersive.setHeaderHidden(true));
    els.btnShowImmersiveHeader.addEventListener('click', () => Immersive.setHeaderHidden(false));
    els.btnImmersiveBookmarks.addEventListener('click', () => Immersive.setBookmarkPanel(!Immersive.bookmarkPanelOpen()));
    els.immersiveBookmarkList.addEventListener('click', e => {
      const del = e.target.closest('.immersive-bookmark-item-del');
      if (del) {
        e.stopPropagation();
        const num = Number(del.closest('.immersive-bookmark-item')?.dataset.num);
        if (num) App.toggleBookmark(num, false);
        return;
      }
      const item = e.target.closest('.immersive-bookmark-item');
      if (!item) return;
      const num = Number(item.dataset.num);
      if (num) Immersive.scrollToLine(num);
    });
    els.immersiveContainer.addEventListener('click', e => {
      const bm = e.target.closest('.immersive-bookmark-toggle');
      if (bm) {
        const num = Number(bm.dataset.num);
        if (num) App.toggleBookmark(num);
        return;
      }
      const img = e.target.closest('.immersive-image');
      if (img?.src) App.openImageLightbox(img.src);
    });
    els.immersiveContainer.addEventListener('animationend', () => els.immersiveContainer.classList.remove('is-switching'));
    els.immersiveView.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (Immersive.stylePanelOpen()) { e.stopPropagation(); Immersive.setStylePanel(false); return; }
      if (Immersive.bookmarkPanelOpen()) { e.stopPropagation(); Immersive.setBookmarkPanel(false); }
    }, true);
    document.addEventListener('click', e => {
      if (Immersive.stylePanelOpen() && !e.target.closest('#immersiveStylePanel') && !e.target.closest('#btnImmersiveStyle')) {
        Immersive.setStylePanel(false);
      }
      if (Immersive.bookmarkPanelOpen() && !e.target.closest('#immersiveBookmarkPanel') && !e.target.closest('#btnImmersiveBookmarks')) {
        Immersive.setBookmarkPanel(false);
      }
    });
    window.addEventListener('resize', () => {
      Immersive.positionSegThumb(els.immersiveWidthGroup);
      Immersive.positionSegThumb(els.immersiveThemeGroup);
    });
  },

  isOpen() {
    return els.immersiveView.classList.contains('open');
  },

  open() {
    if (Immersive.isOpen() || !State.lines.length) return;
    els.immersiveTitle.textContent = State.projectName || '';
    Immersive.setStylePanel(false);
    Immersive.setBookmarkPanel(false);
    Immersive.setHeaderHidden(false);
    Immersive.updateBookmarkCount();
    toggleModal(els.immersiveView, true);
    Immersive.refresh(false);
    Immersive.scroller.scrollToIndex(State.lastBookmarkIndex(), null, true);
    els.immersiveViewport.focus({ preventScroll: true });
  },

  close() {
    if (!Immersive.isOpen()) return;
    Immersive.setStylePanel(false);
    Immersive.setBookmarkPanel(false);
    Immersive.setHeaderHidden(false);
    toggleModal(els.immersiveView, false);
    Immersive.scroller.setItems([], true);
  },

  stylePanelOpen() {
    return els.immersiveStylePanel.classList.contains('show');
  },

  setStylePanel(show) {
    els.immersiveStylePanel.classList.toggle('show', !!show);
    if (show) {
      Immersive.setBookmarkPanel(false);
      requestAnimationFrame(() => {
        Immersive.positionSegThumb(els.immersiveWidthGroup);
        Immersive.positionSegThumb(els.immersiveThemeGroup);
      });
    }
  },

  bookmarkPanelOpen() {
    return els.immersiveBookmarkPanel.classList.contains('show');
  },

  setBookmarkPanel(show) {
    els.immersiveBookmarkPanel.classList.toggle('show', !!show);
    els.btnImmersiveBookmarks.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) {
      Immersive.setStylePanel(false);
      Immersive.renderBookmarkList();
    }
  },

  setHeaderHidden(hidden) {
    const bar = Immersive.barEl;
    if (!bar || hidden === bar.classList.contains('hidden')) return;
    if (hidden) {
      bar.style.setProperty('--im-bar-h', bar.offsetHeight + 'px');
      Immersive.setStylePanel(false);
      Immersive.setBookmarkPanel(false);
    }
    bar.classList.toggle('hidden', hidden);
    els.btnShowImmersiveHeader.classList.toggle('visible', hidden);
  },

  refresh(keepPosition = true) {
    const scroller = Immersive.scroller;
    const anchor = keepPosition ? Immersive.captureAnchor() : null;
    scroller.setItems(State.rows, true);
    if (anchor) Immersive.anchorTo(anchor);
    else {
      scroller.setScrollTop(0);
      scroller.forceUpdate();
    }
  },

  _reflowRaf: 0,

  reflow() {
    if (!Immersive.isOpen()) return;
    if (Immersive._reflowRaf) cancelAnimationFrame(Immersive._reflowRaf);
    const scroller = Immersive.scroller;
    const anchor = Immersive.captureAnchor();
    scroller.heightByKey.clear();
    scroller.measuredKeys.clear();
    scroller.measuredCount = 0;
    const items = scroller.items;
    const n = items.length;
    if (scroller.heights.length !== n) scroller.heights = new Array(n);
    for (let i = 0; i < n; i++) scroller.heights[i] = scroller._estHeight(items[i]);
    scroller._updatePos();
    if (!anchor) { scroller.forceUpdate(); return; }
    const anchorId = anchor.id;
    let index = -1;
    for (let i = 0; i < items.length; i++) {
      if (Immersive.identityOf(items[i]) === anchorId) { index = i; break; }
    }
    if (index < 0) { scroller.forceUpdate(); return; }
    scroller.setScrollTop(scroller.pos[index] + anchor.offset);
    scroller.forceUpdate();
    for (let i = 0; i < scroller.slots.length; i++) {
      if (scroller.slots[i] === -1) scroller._park(scroller.els[i]);
    }
    Immersive._reflowRaf = requestAnimationFrame(() => {
      Immersive._reflowRaf = 0;
      const slot = scroller.slotByKey.get(scroller.keys[index]);
      if (slot !== undefined) {
        const drift = scroller.els[slot].getBoundingClientRect().top - scroller.vp.getBoundingClientRect().top + anchor.offset;
        if (Math.abs(drift) > 0.5) {
          scroller.setScrollTop(scroller.vp.scrollTop + drift);
          scroller.render();
          for (let i = 0; i < scroller.slots.length; i++) {
            if (scroller.slots[i] === -1) scroller._park(scroller.els[i]);
          }
        }
      }
    });
  },

  captureAnchor() {
    const scroller = Immersive.scroller;
    const index = scroller.firstVisibleIndex();
    if (index < 0) return null;
    return {
      id: Immersive.identityOf(scroller.items[index]),
      offset: Math.max(0, scroller.scrollTop - scroller.pos[index])
    };
  },

  anchorTo(anchor, tries = 3) {
    const scroller = Immersive.scroller;
    const index = anchor ? scroller.items.findIndex(it => Immersive.identityOf(it) === anchor.id) : -1;
    if (index < 0) return;
    scroller.setScrollTop(scroller.pos[index] + anchor.offset);
    scroller.forceUpdate();
    const slot = scroller.slotByKey.get(scroller.keys[index]);
    if (slot !== undefined) {
      const drift = scroller.els[slot].getBoundingClientRect().top - scroller.vp.getBoundingClientRect().top + anchor.offset;
      if (Math.abs(drift) > 0.5) scroller.setScrollTop(scroller.vp.scrollTop + drift);
    }
    if (tries > 0) requestAnimationFrame(() => Immersive.anchorTo(anchor, tries - 1));
  },

  identityOf(item) {
    if (item.type === 'header') return `h:${item.file}`;
    if (item.type === 'image') {
      const im = item.img;
      return `i:${im.isCover ? 'cover' : im.file || ''}:${im.zipPath || im.mediaPath}:${im.insertAfter ?? 'c'}`;
    }
    return `l:${item.line.line_num}`;
  },

  createRow() {
    const row = document.createElement('div');
    row.className = 'immersive-row';

    const divider = document.createElement('div');
    divider.className = 'immersive-divider';
    const dividerName = document.createElement('span');
    divider.append(dividerName);

    const figure = document.createElement('figure');
    figure.className = 'immersive-figure';
    const img = document.createElement('img');
    img.className = 'immersive-image';
    img.alt = '';
    img.decoding = 'async';
    figure.append(img);

    const block = document.createElement('div');
    block.className = 'immersive-block';
    const body = document.createElement('div');
    body.className = 'immersive-block-body';
    const name = document.createElement('span');
    name.className = 'immersive-name';
    const text = document.createElement('p');
    text.className = 'immersive-text';
    body.append(name, text);

    const bm = document.createElement('button');
    bm.type = 'button';
    bm.className = 'immersive-bookmark-toggle';
    bm.setAttribute('aria-label', 'Toggle bookmark');
    bm.innerHTML = SVG_ICON.bookmark;

    block.append(body, bm);
    row.append(divider, figure, block);
    row._divider = divider;
    row._dividerName = dividerName;
    row._figure = figure;
    row._img = img;
    row._block = block;
    row._bm = bm;
    row._name = name;
    row._text = text;
    row._imgToken = 0;
    return row;
  },

  updateRow(row, item) {
    row._divider.hidden = true;
    row._figure.hidden = true;
    row._block.hidden = true;
    row._imgToken++;

    if (item.type === 'header') {
      row._dividerName.textContent = baseName(item.file);
      row._divider.hidden = false;
      return;
    }
    if (item.type === 'image') {
      row._figure.hidden = false;
      Immersive.loadImage(row, item);
      return;
    }

    const l = item.line;
    const translated = Immersive.prefs.mode === 'translation' && isTrans(l);
    const name = translated ? (l.trans_name || l.name) : l.name;
    row._name.textContent = name || '';
    row._name.hidden = !name;
    row._text.textContent = translated ? l.trans_message : l.message;
    row._block.classList.toggle('is-untranslated', Immersive.prefs.mode === 'translation' && !translated);
    row._block.hidden = false;

    const isBm = State.bookmarkSet.has(l.line_num);
    row._bm.classList.toggle('is-active', isBm);
    row._bm.dataset.num = l.line_num;
    row._bm.setAttribute('aria-pressed', isBm ? 'true' : 'false');
    row._bm.title = isBm ? 'Remove bookmark' : 'Add bookmark';
  },

  loadImage(row, item) {
    const entry = item.img;
    const cached = EpubImages.peekUrl(State.projectId, entry.mediaPath || entry.zipPath);
    if (cached && row._img.getAttribute('src') === cached) return;

    const key = Immersive.identityOf(item);
    const token = ++row._imgToken;
    row._img.removeAttribute('src');
    row._figure.classList.remove('is-error');

    const show = url => {
      if (row._imgToken !== token) return;
      row._figure.classList.remove('is-loading');
      if (!url) {
        row._figure.classList.add('is-error');
        Immersive.scroller.refreshItem(key);
        return;
      }
      row._img.onload = () => {
        row._img.onload = null;
        row._img.onerror = null;
        if (row._imgToken === token) Immersive.scroller.refreshItem(key);
      };
      row._img.onerror = () => {
        row._img.onerror = null;
        if (row._imgToken !== token) return;
        row._img.removeAttribute('src');
        row._figure.classList.add('is-error');
        Immersive.scroller.refreshItem(key);
      };
      row._img.src = url;
    };

    if (cached !== undefined) { show(cached); return; }
    row._figure.classList.add('is-loading');
    const promise = entry.mediaPath
      ? EpubImages.getUrlFromMediaPath(State.projectId, entry.mediaPath)
      : EpubImages.getUrl(State.projectId, entry.zipPath);
    promise.then(show).catch(e => { console.error('[reader] image failed:', e); show(null); });
  },

  loadPrefs(raw) {
    if (!isPlainObject(raw)) return;
    const p = Immersive.prefs;
    if (READER.modes.includes(raw.mode)) p.mode = raw.mode;
    if (READER.widths.includes(raw.width)) p.width = raw.width;
    if (READER.themes.includes(raw.theme)) p.theme = raw.theme;
    const size = Number(raw.fontSize);
    if (Number.isFinite(size)) p.fontSize = Math.min(READER.font.max, Math.max(READER.font.min, Math.round(size)));
  },

  save() {
    Storage.writeReaderPrefs({ ...Immersive.prefs }).catch(e => console.error('[reader] save failed:', e));
  },

  applyPrefs() {
    const p = Immersive.prefs;
    const view = els.immersiveView;
    READER.widths.forEach(w => view.classList.toggle(`is-${w}`, p.width === w));
    READER.themes.forEach(t => view.classList.toggle(`theme-${t}`, p.theme === t));
    view.style.setProperty('--im-size', `${p.fontSize}px`);
    els.immersiveFontValue.textContent = String(p.fontSize);
    els.immersiveWidthGroup.querySelectorAll('[data-width]').forEach(b => b.classList.toggle('active', b.dataset.width === p.width));
    els.immersiveThemeGroup.querySelectorAll('[data-theme]').forEach(b => b.classList.toggle('active', b.dataset.theme === p.theme));
    Immersive.positionSegThumb(els.immersiveWidthGroup);
    Immersive.positionSegThumb(els.immersiveThemeGroup);
    Immersive.applyMode();
  },

  positionSegThumb(group) {
    const thumb = group.querySelector('.immersive-seg-thumb');
    const active = group.querySelector('.immersive-seg-btn.active');
    if (!thumb || !active) return;
    thumb.style.left = `${active.offsetLeft}px`;
    thumb.style.width = `${active.offsetWidth}px`;
  },

  applyMode() {
    const translated = Immersive.prefs.mode === 'translation';
    els.btnImmersiveMode.setAttribute('aria-pressed', translated ? 'true' : 'false');
    els.btnImmersiveMode.title = translated ? 'Translation (click for original)' : 'Original (click for translation)';
  },

  setMode(mode) {
    if (!READER.modes.includes(mode) || mode === Immersive.prefs.mode) return;
    Immersive.prefs.mode = mode;
    Immersive.save();
    Immersive.applyMode();
    if (!Immersive.isOpen()) return;
    Immersive.refresh();
    const container = els.immersiveContainer;
    container.classList.remove('is-switching');
    void container.offsetWidth;
    container.classList.add('is-switching');
  },

  setFont(size, dir) {
    const clamped = Math.min(READER.font.max, Math.max(READER.font.min, Math.round(size)));
    if (clamped === Immersive.prefs.fontSize) return;
    Immersive.prefs.fontSize = clamped;
    Immersive.save();
    Immersive.applyPrefs();
    Immersive.reflow();
    const span = els.immersiveFontValue;
    span.classList.remove('is-up', 'is-down');
    void span.offsetWidth;
    span.classList.add(dir === 'up' ? 'is-up' : 'is-down');
  },

  setWidth(width) {
    if (!READER.widths.includes(width) || width === Immersive.prefs.width) return;
    Immersive.prefs.width = width;
    Immersive.save();
    Immersive.applyPrefs();
    Immersive.reflow();
  },

  setTheme(theme) {
    if (!READER.themes.includes(theme) || theme === Immersive.prefs.theme) return;
    Immersive.prefs.theme = theme;
    Immersive.save();
    Immersive.applyPrefs();
  },

  syncBookmark(num, added) {
    if (!Immersive.isOpen()) return;
    Immersive.scroller.patch(Immersive.identityOf({ type: 'line', line: { line_num: num } }), row => {
      if (!row._bm) return;
      row._bm.classList.toggle('is-active', added);
      row._bm.setAttribute('aria-pressed', added ? 'true' : 'false');
      row._bm.title = added ? 'Remove bookmark' : 'Add bookmark';
    });
    if (Immersive.bookmarkPanelOpen()) {
      if (added) Immersive.addBookmarkItem(num);
      else Immersive.removeBookmarkItem(num);
    }
  },

  syncAllBookmarks() {
    if (!Immersive.isOpen()) return;
    Immersive.updateBookmarkCount();
    Immersive.scroller.forceUpdate();
    if (Immersive.bookmarkPanelOpen()) Immersive.renderBookmarkList();
  },

  updateBookmarkCount() {
    els.immersiveBookmarkCount.textContent = `(${State.bookmarks.length})`;
  },

  renderBookmarkList() { renderBookmarkListInto(els.immersiveBookmarkList, 'immersive-bookmark'); },

  addBookmarkItem(num) { addBookmarkItemTo(els.immersiveBookmarkList, num, 'immersive-bookmark'); },

  removeBookmarkItem(num) { removeBookmarkItemFrom(els.immersiveBookmarkList, num, 'immersive-bookmark'); },

  scrollToLine(num) {
    const idx = State.indexOfLine(num);
    if (idx === -1) return;
    Immersive.scroller.scrollToIndex(idx);
    Immersive.setBookmarkPanel(false);
  }
};

