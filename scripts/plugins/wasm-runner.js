// AETL - WebAssembly module cache & instantiate
'use strict';

const WasmRunner = {
  _moduleCache: new Map(),

  async moduleFor(bytes) {
    const key = fnv1a(bytes) + ':' + bytes.length;
    const cached = WasmRunner._moduleCache.get(key);
    if (cached) {
      WasmRunner._moduleCache.delete(key);
      WasmRunner._moduleCache.set(key, cached);
      return cached;
    }
    let mod;
    try { mod = await WebAssembly.compile(bytes); }
    catch (e) { throw new Error('WASM module compilation failed: ' + (e?.message || e)); }
    WasmRunner._moduleCache.set(key, mod);
    return mod;
  },

  async instantiate(source, imports) {
    const bytes = source instanceof Uint8Array ? source
      : source instanceof ArrayBuffer ? new Uint8Array(source)
      : null;
    if (!bytes) throw new Error('WASM source must be Uint8Array or ArrayBuffer (get it from api.asset()).');
    const mod = await WasmRunner.moduleFor(bytes);
    const result = await WebAssembly.instantiate(mod, imports || {});
    return result;
  }
};
