// AETL - Promise-based confirm/prompt/info dialogs
'use strict';

const Dialogs = {
  _active: null,
  _seq: 0,

  _create({ title, bodyHtml, confirmLabel, cancelLabel, danger, wide, hideCancel }) {
    return new Promise(resolve => {
      if (Dialogs._active) { resolve(null); return; }
      const overlay = document.createElement('div');
      overlay.className = 'backdrop aetl-dialog';
      overlay.innerHTML = `
        <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
          <div class="modal-head"><h3>${esc(title)}</h3></div>
          <div class="modal-body aetl-dialog-body">${bodyHtml}</div>
          <div class="modal-actions">
            ${hideCancel ? '' : `<button type="button" class="btn btn-ghost aetl-dialog-cancel">${esc(cancelLabel || 'Cancel')}</button>`}
            <span class="grow"></span>
            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} aetl-dialog-ok">${esc(confirmLabel || 'OK')}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      Dialogs._active = overlay;

      let settled = false;
      const finish = val => {
        if (settled) return;
        settled = true;
        Dialogs._active = null;
        overlay.classList.remove('open');
        resolve(val);
        // Remove after close transition finishes (modal slide-down is 350ms).
        setTimeout(() => { try { overlay.remove(); } catch {} }, 360);
      };

      overlay.querySelector('.aetl-dialog-cancel')?.addEventListener('click', () => finish(null));
      overlay.querySelector('.aetl-dialog-ok').addEventListener('click', () => finish(true));
      // Backdrop click and Escape both cancel.
      overlay.addEventListener('click', e => { if (e.target === overlay) finish(null); });
      overlay.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
      });

      // Two rAFs so the entrance transition runs cleanly.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        overlay.classList.add('open');
        const focusEl = danger && !hideCancel
          ? overlay.querySelector('.aetl-dialog-cancel')
          : overlay.querySelector('.aetl-dialog-ok');
        focusEl?.focus({ preventScroll: true });
      }));
    });
  },

  confirm(opts) { return Dialogs._create({ ...opts, danger: !!opts.danger }); },

  info(title, bodyHtml) {
    return Dialogs._create({ title, bodyHtml, confirmLabel: 'Close', danger: false, hideCancel: true });
  },

  prompt({ title, bodyHtml = '', value = '', placeholder = '', confirmLabel, cancelLabel }) {
    return new Promise(resolve => {
      const id = 'aetl-prompt-input-' + (++Dialogs._seq);
      const inputHtml = `<input id="${id}" class="input w-full" type="text" autocomplete="off" />`;
      const fullBody = `${bodyHtml ? `<p class="hint m-0 mb-2">${bodyHtml}</p>` : ''}${inputHtml}`;
      Dialogs._create({
        title,
        bodyHtml: fullBody,
        confirmLabel: confirmLabel || 'OK',
        cancelLabel: cancelLabel || 'Cancel',
        danger: false,
        wide: false
      }).then(ok => {
        if (!ok) { resolve(null); return; }
        const input = document.getElementById(id);
        resolve(input ? input.value : '');
      });
      requestAnimationFrame(() => {
        const overlay = Dialogs._active;
        if (!overlay) return;
        const input = overlay.querySelector('#' + id);
        if (!input) return;
        input.value = String(value ?? '');
        if (placeholder) input.placeholder = placeholder;
        input.focus();
        input.select();
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            overlay.querySelector('.aetl-dialog-ok')?.click();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            overlay.querySelector('.aetl-dialog-cancel')?.click();
          }
        });
      });
    });
  }
};

AETL.dialogs = Dialogs;
