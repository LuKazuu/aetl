// AETL - Main State machine + Scroller virtual list
'use strict';

const State = {
  projectId: null,
  files: [],
  lines: [],
  rows: [],
  byNum: new Map(),
  fileLines: new Map(),
  headerIdx: [],
  selected: new Set(),
  bookmarkSet: new Set(),
  undoStack: [],
  redoStack: [],
  saveTimer: null,
  contentVersion: 0,
  translatedCount: 0,
  namesDirty: true
};

for (const f of STATE_SCHEMA) State[f.key] = f.def;

State.toData = () => {
  const data = {
    version: VERSION,
    imported_files: State.files,
    lines: State.lines.map(lineToStorage)
  };
  for (const f of STATE_SCHEMA) {
    data[f.store || f.key] = State[f.key];
  }
  return data;
};

State.maxLineNum = () => State.lines.reduce((m, l) => Math.max(m, l.line_num), 0);
State.nextLineNum = () => State.lines.length ? State.maxLineNum() + 1 : 1;
State.indexOfLine = num => State.rows.findIndex(r => r.type === 'line' && r.line.line_num === num);
State.lastBookmarkIndex = () => {
  const num = State.bookmarks.at(-1);
  return num === undefined ? -1 : State.indexOfLine(num);
};

State.loadFromData = (data) => {
  State.files = data.imported_files || [];
  State.lines = (data.lines || []).map(lineFromStorage);
  for (const f of STATE_SCHEMA) {
    const v = data[f.store || f.key];
    const d = schemaDefault(f);
    State[f.key] = f.coerce ? (v || d) : (v ?? d);
  }
  if (!State.projectName) State.projectName = 'Unknown';
};

State.resetTransient = () => {
  State.projectId = null;
  State.files = [];
  State.lines = [];
  State.rows = [];
  State.headerIdx = [];
  State.byNum.clear();
  State.fileLines.clear();
  State.selected.clear();
  State.undoStack = [];
  State.redoStack = [];
  State.translatedCount = 0;
  State.namesDirty = true;
  for (const f of STATE_SCHEMA) State[f.key] = schemaDefault(f);
};

State.updateCount = () => {
  State.translatedCount = 0;
  const lines = State.lines;
  for (let i = 0, n = lines.length; i < n; i++) if (lines[i].is_translated) State.translatedCount++;
};

State.adjustCount = (was, now) => {
  State.translatedCount += (now ? 1 : 0) - (was ? 1 : 0);
};

State.rebuild = () => {
  State.byNum.clear();
  State.fileLines.clear();
  State.rows = [];
  State.headerIdx = [];
  const files = State.files;
  const grouped = new Array(files.length);
  const fileIdx = new Map();
  for (let i = 0; i < files.length; i++) {
    fileIdx.set(files[i], i);
    grouped[i] = [];
  }
  const lines = State.lines;
  for (let i = 0, n = lines.length; i < n; i++) {
    const l = lines[i];
    State.byNum.set(l.line_num, l);
    const gi = fileIdx.get(l.file);
    if (gi !== undefined) grouped[gi].push(l);
  }

  const coverImages = [];
  const imagesByFile = new Map();
  for (const im of (State.images || [])) {
    if (im.isCover) { coverImages.push(im); continue; }
    let arr = imagesByFile.get(im.file);
    if (!arr) { arr = []; imagesByFile.set(im.file, arr); }
    arr.push(im);
  }
  for (const arr of imagesByFile.values()) {
    arr.sort((a, b) => (a.insertAfter ?? -1) - (b.insertAfter ?? -1));
  }

  for (const im of coverImages) State.rows.push({ type: 'image', img: im });

  for (let i = 0; i < files.length; i++) {
    const fileLines = grouped[i];
    const fileImages = imagesByFile.get(files[i]) || [];
    if (!fileLines.length && !fileImages.length) continue;
    State.fileLines.set(files[i], fileLines);
    State.headerIdx.push(State.rows.length);
    State.rows.push({ type: 'header', file: files[i] });
    let imgPtr = 0;
    while (imgPtr < fileImages.length && fileImages[imgPtr].insertAfter == null) {
      State.rows.push({ type: 'image', img: fileImages[imgPtr] });
      imgPtr++;
    }
    for (let j = 0, m = fileLines.length; j < m; j++) {
      State.rows.push({ type: 'line', line: fileLines[j] });
      while (imgPtr < fileImages.length && fileImages[imgPtr].insertAfter === fileLines[j].line_num) {
        State.rows.push({ type: 'image', img: fileImages[imgPtr] });
        imgPtr++;
      }
    }
    while (imgPtr < fileImages.length) {
      State.rows.push({ type: 'image', img: fileImages[imgPtr] });
      imgPtr++;
    }
  }
  if (State.bookmarks.length) {
    State.bookmarks = State.bookmarks.filter(n => State.byNum.has(n));
  }
  State.bookmarkSet = new Set(State.bookmarks);
};

State.persist = async (opts = {}) => {
  const id = State.projectId;
  if (!id) return;
  try {
    const data = State.toData();
    if (!data.updatedAt) data.updatedAt = Date.now();
    if (window.AETL?.plugins) await AETL.plugins.runHooks('beforeSave', data);
    const json = await serializeProjectJson(data);
    await Storage.saveProjectJson(id, json);
    await Storage.upsertProjectIndexEntry(Storage.projectIndexEntry(id, data, data.updatedAt));
    if (!opts.silent) App.flashSaved();
    if (window.AETL?.plugins) await AETL.plugins.runHooks('afterSave', data);
  } catch (e) {
    if (e?.storage) { App.flash("Couldn't save: " + e.message, true); }
    else { console.error('[autosave]', e); }
  }
};

State.queueSave = () => {
  if (!State.projectId) return;
  clearTimeout(State.saveTimer);
  State.saveTimer = setTimeout(() => State.persist(), 500);
};

class Scroller {
  constructor(viewport, container, create, update, keyOf, layout = CFG.scroller) {
    this.vp = viewport;
    this.container = container;
    this.create = create;
    this.update = update;
    this.keyOf = keyOf || ((item, i) => i);
    this.items = [];
    this.keys = [];
    this.heights = [];
    this.pos = [];
    this.els = [];
    this.slots = [];
    this.dirtySlots = [];
    this.slotByKey = new Map();
    this.heightByKey = new Map();
    this.measuredKeys = new Set();
    this.defaultH = layout.defaultH;
    this.gap = layout.gap;
    this.topPad = layout.topPad;
    this.botPad = layout.botPad;
    this.headerH = layout.headerH;
    this.overscan = layout.overscan;
    this.recyclePos = layout.recyclePos;
    this.defaultVH = layout.defaultViewportH;
    this.scrollTop = 0;
    this.totalH = 0;
    this.scheduled = false;
    this.avgHeight = 0;
    this.measuredCount = 0;
    this.lastVpWidth = viewport.clientWidth;
    this._scrollToken = 0;
    this._animating = false;

    viewport.addEventListener('scroll', () => {
      this.scrollTop = viewport.scrollTop;
      this.schedule();
    }, { passive: true });

    new ResizeObserver(() => this._onResize()).observe(viewport);
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.render();
    });
  }

  setItems(items, keep = false) {
    const prevScroll = keep ? this.vp.scrollTop : 0;
    const n = items.length;
    if (keep && items === this.items && this.keys.length === n) {
      const maxScroll = Math.max(0, this.totalH - this.vp.clientHeight);
      this.vp.scrollTop = Math.min(prevScroll, maxScroll);
      this.scrollTop = this.vp.scrollTop;
      this.invalidate();
      this.render();
      return;
    }
    if (!keep) this._resetHeights();
    if (this.keys.length !== n) this.keys = new Array(n);
    if (this.heights.length !== n) this.heights = new Array(n);
    if (this.pos.length !== n) this.pos = new Array(n);
    this.items = items;
    const keys = this.keys;
    for (let i = 0; i < n; i++) keys[i] = this.keyOf(items[i], i);
    for (let i = 0; i < n; i++) {
      const cached = this.heightByKey.get(keys[i]);
      this.heights[i] = cached !== undefined ? cached : this._estHeight(items[i]);
    }
    this._updatePos();
    const maxScroll = Math.max(0, this.totalH - this.vp.clientHeight);
    this.vp.scrollTop = keep ? Math.min(prevScroll, maxScroll) : 0;
    this.scrollTop = this.vp.scrollTop;
    this.invalidate();
    this.render();
  }

  invalidateHeights() {
    this._resetHeights();
    const n = this.items.length;
    if (this.heights.length !== n) this.heights = new Array(n);
    const items = this.items, heights = this.heights;
    for (let i = 0; i < n; i++) heights[i] = this._estHeight(items[i]);
    this._updatePos();
    const maxScroll = Math.max(0, this.totalH - this.vp.clientHeight);
    if (this.scrollTop > maxScroll) {
      this.vp.scrollTop = maxScroll;
      this.scrollTop = maxScroll;
    }
    this.invalidate();
  }

  invalidateHeight(key) {
    this.heightByKey.delete(key);
  }

  invalidate() {
    this.slots.fill(-1);
    this.slotByKey.clear();
  }

  patch(key, fn) {
    const slot = this.slotByKey.get(key);
    if (slot === undefined) return false;
    const di = this.slots[slot];
    if (di < 0) return false;
    fn(this.els[slot], this.items[di], di);
    return true;
  }

  refreshItem(key) {
    const slot = this.slotByKey.get(key);
    if (slot === undefined) return false;
    const di = this.slots[slot];
    if (di < 0) return false;
    this.update(this.els[slot], this.items[di], di);
    const delta = this._measureSlot(slot, di);
    if (delta) {
      this._updatePosFrom(di);
      if (this.pos[di] < this.scrollTop) {
        this.vp.scrollTop += delta;
        this.scrollTop = this.vp.scrollTop;
      }
    }
    this._positionAll();
    return true;
  }

  firstVisibleIndex() {
    if (!this.items.length) return -1;
    return this._findStart(this.scrollTop);
  }

  setScrollTop(px) {
    this.vp.scrollTop = Math.max(0, px);
    this.scrollTop = this.vp.scrollTop;
  }

  scrollToIndex(idx, onDone, instant = false) {
    if (idx < 0 || idx >= this.items.length) return;
    const token = ++this._scrollToken;
    const vh = this.vp.clientHeight || this.defaultVH;
    const targetTop = () => {
      const h = this.heights[idx] || this.defaultH;
      return Math.max(0, (this.pos[idx] || 0) - (vh / 2) + (h / 2));
    };
    const finish = () => {
      if (token !== this._scrollToken) return;
      this._animating = false;
      this.scrollTop = this.vp.scrollTop;
      this.render();
      const final = targetTop();
      if (Math.abs(this.vp.scrollTop - final) > 1) {
        this.setScrollTop(final);
        this.render();
      }
      if (token === this._scrollToken) onDone?.();
    };
    if (instant) {
      this._animating = true;
      for (let i = 0; i < 3; i++) {
        this.setScrollTop(targetTop());
        this.render();
      }
      finish();
      return;
    }
    const start = this.vp.scrollTop;
    if (Math.abs(targetTop() - start) < 3) { finish(); return; }
    this._animating = true;
    const duration = 200;
    const startTime = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 3);
    const step = now => {
      if (token !== this._scrollToken) return;
      const t = Math.min(1, (now - startTime) / duration);
      const target = targetTop();
      this.setScrollTop(start + (target - start) * ease(t));
      this.render();
      if (t < 1) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
  }

  forceUpdate() {
    this.invalidate();
    this.render();
  }

  render() {
    for (let pass = 0; pass < 2; pass++) {
      if (!this._renderPass()) return;
    }
    this.schedule();
  }

  _estHeight(it) {
    if (it?.type === 'header') return this.headerH;
    return this.avgHeight > 0 ? this.avgHeight : this.defaultH;
  }

  _resetHeights() {
    this.heightByKey.clear();
    this.measuredKeys.clear();
    this.avgHeight = 0;
    this.measuredCount = 0;
  }

  _onResize() {
    const w = this.vp.clientWidth;
    const changed = this.lastVpWidth > 0 && w > 0 && w !== this.lastVpWidth;
    this.lastVpWidth = w;
    if (changed) this.invalidateHeights();
    this.schedule();
  }

  _updatePos() {
    const pos = this.pos;
    const heights = this.heights;
    let cur = this.topPad;
    for (let i = 0; i < pos.length; i++) {
      pos[i] = cur;
      cur += heights[i];
    }
    this.totalH = cur + this.botPad;
    this.container.style.height = `${this.totalH}px`;
  }

  _updatePosFrom(startIdx) {
    const pos = this.pos;
    const heights = this.heights;
    const n = pos.length;
    if (startIdx < 0) startIdx = 0;
    if (startIdx >= n) {
      const last = n > 0 ? pos[n - 1] + heights[n - 1] : this.topPad;
      this.totalH = last + this.botPad;
      this.container.style.height = `${this.totalH}px`;
      return;
    }
    let cur = startIdx > 0 ? pos[startIdx - 1] + heights[startIdx - 1] : this.topPad;
    for (let i = startIdx; i < n; i++) {
      pos[i] = cur;
      cur += heights[i];
    }
    this.totalH = cur + this.botPad;
    this.container.style.height = `${this.totalH}px`;
  }

  _findStart(scrollTop) {
    const pos = this.pos;
    const heights = this.heights;
    let lo = 0, hi = pos.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pos[mid] + heights[mid] <= scrollTop) lo = mid + 1;
      else hi = mid;
    }
    return pos.length ? lo : 0;
  }

  _findEnd(start, vh) {
    const heights = this.heights;
    let i = start, acc = 0;
    while (i < heights.length && acc < vh) {
      acc += heights[i];
      i++;
    }
    return i;
  }

  _renderPass() {
    if (!this.items.length) {
      this._releaseAll();
      return false;
    }
    const vh = this.vp.clientHeight || this.defaultVH;
    const scrollTop = this.scrollTop = this.vp.scrollTop;
    const vStart = this._findStart(scrollTop);
    const vEnd = this._findEnd(vStart, vh);
    const rStart = Math.max(0, vStart - this.overscan);
    const rEnd = Math.min(this.items.length, vEnd + this.overscan);
    this._ensurePool(rEnd - rStart);
    this._assign(rStart, rEnd);
    const heightsChanged = this._measure();
    this._position(rStart, rEnd);
    const covered = rEnd >= this.items.length
      || this.pos[rEnd - 1] + this.heights[rEnd - 1] >= scrollTop + vh;
    if (!covered) return true;
    return heightsChanged && this.pos[rStart] > scrollTop + 1;
  }

  _ensurePool(need) {
    while (this.els.length < need) {
      const el = this.create();
      this._park(el);
      this.els.push(el);
      this.slots.push(-1);
      this.container.appendChild(el);
    }
  }

  _assign(rStart, rEnd) {
    const need = rEnd - rStart;
    for (let i = 0; i < need; i++) {
      const di = rStart + i;
      if (this.slots[i] === di) continue;
      if (this.slots[i] !== -1) {
        const oldKey = this.keys[this.slots[i]];
        if (this.slotByKey.get(oldKey) === i) this.slotByKey.delete(oldKey);
      }
      this.slots[i] = di;
      this.slotByKey.set(this.keys[di], i);
      this.update(this.els[i], this.items[di], di);
      this.dirtySlots.push(i);
    }
    for (let i = need; i < this.slots.length; i++) {
      if (this.slots[i] === -1) continue;
      const oldKey = this.keys[this.slots[i]];
      if (this.slotByKey.get(oldKey) === i) this.slotByKey.delete(oldKey);
      this.slots[i] = -1;
      this._park(this.els[i]);
    }
  }

  _measure() {
    if (!this.dirtySlots.length) return false;
    let changed = false;
    let adjust = 0;
    let firstChangedIdx = -1;
    for (const slot of this.dirtySlots) {
      const di = this.slots[slot];
      const delta = this._measureSlot(slot, di);
      if (!delta) continue;
      changed = true;
      if (firstChangedIdx === -1 || di < firstChangedIdx) firstChangedIdx = di;
      if (this.pos[di] < this.scrollTop) adjust += delta;
    }
    this.dirtySlots.length = 0;
    if (changed) {
      this._updatePosFrom(firstChangedIdx);
      if (adjust && !this._animating) {
        this.vp.scrollTop += adjust;
        this.scrollTop = this.vp.scrollTop;
      }
    }
    return changed;
  }

  _measureSlot(slot, di) {
    const el = this.els[slot];
    const h = el.offsetHeight;
    if (!h) return 0;
    const isHeader = this.items[di]?.type === 'header';
    const total = isHeader ? h : h + this.gap;
    const prev = this.heights[di];
    const delta = total - prev;
    if (Math.abs(delta) <= 1) return 0;
    if (!isHeader) {
      const key = this.keys[di];
      if (this.measuredKeys.has(key)) {
        if (this.measuredCount > 0) this.avgHeight += (total - prev) / this.measuredCount;
      } else {
        this.avgHeight = (this.avgHeight * this.measuredCount + total) / (this.measuredCount + 1);
        this.measuredCount++;
        this.measuredKeys.add(key);
      }
    }
    this.heights[di] = total;
    this.heightByKey.set(this.keys[di], total);
    return delta;
  }

  _position(rStart, rEnd) {
    for (let i = 0; i < rEnd - rStart; i++) {
      this._positionSlot(i, rStart + i);
    }
  }

  _positionAll() {
    for (let i = 0; i < this.slots.length; i++) {
      const di = this.slots[i];
      if (di >= 0) this._positionSlot(i, di);
    }
  }

  _park(el) {
    const t = `translateY(${this.recyclePos}px)`;
    if (el._aetlT !== t) {
      el.style.transform = t;
      el._aetlT = t;
    }
  }

  _positionSlot(slot, di) {
    const el = this.els[slot];
    const y = Math.round(this.pos[di]);
    const t = `translateY(${y}px)`;
    if (el._aetlT !== t) {
      el.style.transform = t;
      el._aetlT = t;
    }
  }

  _releaseAll() {
    for (let i = 0; i < this.els.length; i++) {
      this._park(this.els[i]);
      this.slots[i] = -1;
    }
    this.slotByKey.clear();
    this.container.style.height = '0px';
    this.totalH = 0;
  }
}

