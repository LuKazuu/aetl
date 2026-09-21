// AETL - Bookmark DOM helpers
'use strict';

function buildBookmarkItemEl(num, prefix) {
  const l = State.byNum.get(num);
  if (!l) return null;
  const item = document.createElement('div');
  item.className = `${prefix}-item`;
  item.dataset.num = num;
  const numEl = document.createElement('span');
  numEl.className = `${prefix}-item-num`;
  numEl.textContent = num;
  const meta = document.createElement('div');
  meta.className = `${prefix}-item-meta`;
  const fileEl = document.createElement('span');
  fileEl.className = `${prefix}-item-file`;
  fileEl.textContent = baseName(l.file);
  fileEl.title = l.file;
  const textEl = document.createElement('span');
  textEl.className = `${prefix}-item-text`;
  const preview = l.message || (l.name ? `${l.name}: ` : '');
  textEl.textContent = preview || '(empty)';
  textEl.title = preview;
  meta.append(fileEl, textEl);
  if (isTrans(l) && l.trans_message) {
    const transEl = document.createElement('span');
    transEl.className = `${prefix}-item-trans`;
    transEl.textContent = l.trans_message;
    transEl.title = l.trans_message;
    meta.append(transEl);
  }
  const del = document.createElement('button');
  del.type = 'button';
  del.className = `${prefix}-item-del`;
  del.setAttribute('aria-label', `Delete bookmark for line ${num}`);
  del.tabIndex = -1;
  del.innerHTML = SVG_ICON.close;
  item.append(numEl, meta, del);
  return item;
}

function renderBookmarkListInto(list, prefix) {
  list.replaceChildren();
  const nums = [...State.bookmarks].sort((a, b) => a - b);
  if (!nums.length) return;
  const frag = document.createDocumentFragment();
  for (const num of nums) {
    const item = buildBookmarkItemEl(num, prefix);
    if (item) frag.appendChild(item);
  }
  list.appendChild(frag);
}

function addBookmarkItemTo(list, num, prefix) {
  if (list.querySelector(`.${prefix}-item[data-num="${num}"]`)) return;
  const item = buildBookmarkItemEl(num, prefix);
  if (!item) return;
  let anchor = null;
  for (const el of list.children) {
    if (Number(el.dataset.num) > num) { anchor = el; break; }
  }
  list.insertBefore(item, anchor);
}

function removeBookmarkItemFrom(list, num, prefix) {
  const item = list.querySelector(`.${prefix}-item[data-num="${num}"]`);
  if (!item) return;
  item.remove();
}
