// AETL - Progress / busy overlay controller
'use strict';

const Progress = {
  _onCancel: null,
  _open(title, msg, determinate, onCancel) {
    els.busyTitle.textContent = title;
    els.busyMsg.textContent = msg;
    els.busyBarFill.classList.toggle('determinate', determinate);
    els.busyBarFill.style.width = determinate ? '0%' : '';
    Progress._onCancel = typeof onCancel === 'function' ? onCancel : null;
    els.busyActions.hidden = !Progress._onCancel;
    els.busyCancel.disabled = false;
    els.busyOverlay.classList.add('open');
  },
  show(title, msg = '') { Progress._open(title, msg, false); },
  determinate(title, msg = '') { Progress._open(title, msg, true); },
  cancellableDeterminate(title, msg, onCancel) { Progress._open(title, msg, true, onCancel); },
  update(msg, pct) {
    if (msg !== undefined && typeof msg === 'string') els.busyMsg.textContent = msg;
    if (pct !== undefined && els.busyBarFill.classList.contains('determinate')) {
      els.busyBarFill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    }
  },
  disableCancel() {
    Progress._onCancel = null;
    els.busyActions.hidden = true;
  },
  cancel() {
    const cb = Progress._onCancel;
    Progress.disableCancel();
    if (typeof cb === 'function') {
      try { cb(); } catch (e) { console.error('[progress] onCancel error:', e); }
    }
  },
  hide() {
    Progress.disableCancel();
    els.busyCancel.disabled = false;
    els.busyOverlay.classList.remove('open');
  }
};

