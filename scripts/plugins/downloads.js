// AETL - Network download progress UI
'use strict';

const Downloads = {
  _el: null,
  _hostEl: null,
  _bytesEl: null,
  _fillEl: null,
  _timer: null,
  _active: false,
  _refcount: 0,

  _ensure() {
    if (Downloads._el) return;
    const el = document.createElement('div');
    el.className = 'net-progress';
    el.innerHTML = '<div class="np-row"><div class="np-spin"></div><div class="np-text"><div class="np-host"></div><div class="np-bytes"></div></div></div><div class="np-bar"><div class="np-fill"></div></div>';
    document.body.appendChild(el);
    Downloads._el = el;
    Downloads._hostEl = el.querySelector('.np-host');
    Downloads._bytesEl = el.querySelector('.np-bytes');
    Downloads._fillEl = el.querySelector('.np-fill');
  },

  start(hostname, total) {
    Downloads._ensure();
    const wasIdle = Downloads._refcount === 0;
    Downloads._refcount++;
    if (Downloads._timer) clearTimeout(Downloads._timer);
    Downloads._timer = setTimeout(() => {
      Downloads._timer = null;
      Downloads._active = true;
      if (wasIdle || !Downloads._hostEl.textContent) {
        Downloads._hostEl.textContent = hostname || 'downloading';
      }
      Downloads._bytesEl.textContent = total ? '0 / ' + humanBytes(total) : '0 B';
      Downloads._fillEl.style.width = total ? '0%' : '35%';
      Downloads._fillEl.classList.toggle('determinate', !!total);
      Downloads._el.classList.add('open');
    }, 350);
  },

  progress(received, total) {
    if (!Downloads._active) return;
    if (total) {
      Downloads._bytesEl.textContent = humanBytes(received) + ' / ' + humanBytes(total);
      Downloads._fillEl.style.width = Math.min(100, (received / total) * 100) + '%';
    } else {
      Downloads._bytesEl.textContent = humanBytes(received);
    }
  },

  end() {
    if (Downloads._refcount > 0) Downloads._refcount--;
    if (Downloads._refcount > 0) return;
    if (Downloads._timer) { clearTimeout(Downloads._timer); Downloads._timer = null; }
    if (!Downloads._active) return;
    Downloads._active = false;
    if (Downloads._el) Downloads._el.classList.remove('open');
  }
};
