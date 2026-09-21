// AETL - Network, clipboard, progress & storage-error helpers
'use strict';

function download(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), CFG.delay.revokeUrlMs);
}

function clipboard(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); return Promise.resolve(); }
  catch (e) { return Promise.reject(e); }
  finally { document.body.removeChild(ta); }
}

function debounce(fn, ms = CFG.debounceDefaultMs) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function withBusyCursor(fn) {
  document.body.style.cursor = 'wait';
  return Promise.resolve(fn()).finally(() => { document.body.style.cursor = 'default'; });
}

async function withProgress(title, initialMsg, fn, failMsg) {
  Progress.show(title, initialMsg || '');
  let err = null;
  let result;
  await withBusyCursor(async () => {
    try { result = await fn(); }
    catch (e) { err = e; }
  });
  Progress.hide();
  if (err) {
    const msg = err?.storage ? err.message : (failMsg ? failMsg(err) : err.message);
    App.flash(msg, true, 'error');
    if (err?.storage) App.loadDashboard();
    return undefined;
  }
  return result;
}

function isStorageError(e) {
  const n = e?.name;
  return n === 'NotFoundError' || n === 'SecurityError' || n === 'NotReadableError' ||
    n === 'InvalidStateError' || n === 'InvalidModificationError' ||
    n === 'NoModificationAllowedError' || n === 'DataError';
}

function storageFailure(e, noun) {
  const err = new Error();
  err.storage = true;
  const n = e?.name;
  if (n === 'NotFoundError') {
    err.message = (noun ? 'File ' + noun : 'Data') + ' not found in storage. It may have been deleted or site data was cleared. The list will be reloaded.';
  } else if (n === 'NoModificationAllowedError') {
    err.message = 'File is being used by another process. Wait a moment and try again.';
  } else {
    err.message = 'Storage is currently inaccessible. Close and reopen the app, then try again.';
  }
  return err;
}

function friendlyError(e, prefix) {
  if (e?.storage) return e.message;
  if (isStorageError(e)) return storageFailure(e).message;
  return prefix + (e?.message || e);
}
