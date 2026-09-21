// AETL - HTTP/HTTPS fetch runner with progress
'use strict';

const NetRunner = {
  async fetch(rawUrl, opts, inst) {
    const o = isPlainObject(opts) ? opts : {};
    let u;
    try { u = new URL(String(rawUrl)); }
    catch { throw new Error('Invalid URL.'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error(`Unsupported URL scheme: ${u.protocol} (only http: and https: are allowed).`);
    }
    const method = (typeof o.method === 'string' ? o.method : 'GET').toUpperCase();
    const headers = isPlainObject(o.headers) ? { ...o.headers } : {};
    const body = o.body == null ? null
      : typeof o.body === 'string' ? o.body
      : o.body instanceof Uint8Array ? o.body
      : o.body instanceof ArrayBuffer ? new Uint8Array(o.body)
      : isPlainObject(o.body) ? JSON.stringify(o.body) : null;
    const as = o.as === 'bytes' ? 'bytes' : 'text';
    const silent = !!o.silent;
    const ctrl = new AbortController();
    if (inst) inst.aborts.add(ctrl);
    let res;
    try {
      res = await fetch(u.href, { method, headers, body, signal: ctrl.signal, redirect: 'follow' });
    } catch (err) {
      if (inst) inst.aborts.delete(ctrl);
      throw new Error('Request failed: ' + (err?.name === 'AbortError' ? 'aborted' : (err?.message || String(err))));
    }
    const headersOut = {};
    res.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      headersOut[lk] = headersOut[lk] != null ? headersOut[lk] + ', ' + v : v;
    });
    const clRaw = res.headers.get('content-length');
    const total = clRaw != null && Number.isFinite(+clRaw) ? +clRaw : null;
    const showProgress = !silent && (total == null || total >= 100 * 1024);
    if (showProgress) Downloads.start(u.hostname, total);
    let received = 0;
    let buf;
    try {
      const reader = res.body?.getReader();
      if (reader) {
        const chunks = [];
        while (true) {
          const r = await reader.read();
          if (r.done) break;
          if (r.value) {
            chunks.push(r.value);
            received += r.value.length;
            if (showProgress) Downloads.progress(received, total);
          }
        }
        buf = new Uint8Array(received);
        let off = 0;
        for (const c of chunks) { buf.set(c, off); off += c.length; }
      } else {
        buf = new Uint8Array(await res.arrayBuffer());
      }
    } catch (err) {
      ctrl.abort();
      if (showProgress) Downloads.end();
      throw new Error('Stream interrupted: ' + (err?.message || String(err)));
    } finally {
      if (inst) inst.aborts.delete(ctrl);
    }
    if (showProgress) Downloads.end();
    if (as === 'bytes') {
      return { ok: res.ok, status: res.status, statusText: res.statusText, url: res.url, headers: headersOut, body: buf };
    }
    return { ok: res.ok, status: res.status, statusText: res.statusText, url: res.url, headers: headersOut, body: new TextDecoder('utf-8').decode(buf) };
  }
};
