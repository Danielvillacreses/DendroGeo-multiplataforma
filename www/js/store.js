// Almacenamiento local (IndexedDB) con respaldo en memoria.
// Cada registro lleva: modificado_cliente (ISO) y _pend (1 = falta subir a la nube).

const DB_NAME = 'dendrogeo';
const DB_VER = 1;
export const TABLAS = ['proyectos', 'parcelas', 'especies', 'arboles', 'mediciones', 'fotos'];
const STORES = [...TABLAS, 'blobs', 'meta'];

let db = null;
const memoria = Object.fromEntries(STORES.map((s) => [s, new Map()]));
export let persistente = false;

export async function abrir() {
  try {
    if (!('indexedDB' in window)) throw new Error('sin IndexedDB');
    db = await new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) {
          r.result.createObjectStore(s, { keyPath: s === 'meta' || s === 'blobs' ? 'k' : 'id' });
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      setTimeout(() => rej(new Error('IndexedDB no responde')), 4000);
    });
    persistente = true;
    // Pedir almacenamiento persistente para que el navegador no borre datos de campo
    try { await navigator.storage?.persist?.(); } catch {}
  } catch (e) {
    console.warn('Usando almacenamiento en memoria:', e.message);
    db = null;
    persistente = false;
  }
}

function tx(store, modo, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(store, modo);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
    t.onerror = () => rej(t.error);
  });
}

export async function todos(store) {
  if (!db) return [...memoria[store].values()].map((r) => ({ ...r }));
  return tx(store, 'readonly', (s) => s.getAll());
}

export async function uno(store, id) {
  if (!db) { const r = memoria[store].get(id); return r ? { ...r } : undefined; }
  return tx(store, 'readonly', (s) => s.get(id));
}

export async function guardarVarios(store, recs) {
  if (!recs.length) return;
  if (!db) { for (const r of recs) memoria[store].set(r.id ?? r.k, { ...r }); return; }
  await tx(store, 'readwrite', (s) => { for (const r of recs) s.put(r); });
}

export const nuevoId = () =>
  crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });

/** Guarda un cambio hecho en el dispositivo (queda pendiente de subir). */
export async function guardar(store, rec) {
  const r = { ...rec, id: rec.id || nuevoId(), modificado_cliente: new Date().toISOString(), _pend: 1 };
  if (r.deleted == null) r.deleted = false;
  await guardarVarios(store, [r]);
  emitir();
  return r;
}

/** Borrado lógico (se sincroniza como deleted = true). */
export async function borrar(store, id) {
  const r = await uno(store, id);
  if (r) await guardar(store, { ...r, deleted: true });
}

export async function meta(k, v) {
  if (v === undefined) {
    const r = db ? await tx('meta', 'readonly', (s) => s.get(k)) : memoria.meta.get(k);
    return r?.v;
  }
  await guardarVarios('meta', [{ k, v }]);
}

export async function guardarBlob(k, blob) { await guardarVarios('blobs', [{ k, blob }]); }
export async function leerBlob(k) {
  const r = db ? await tx('blobs', 'readonly', (s) => s.get(k)) : memoria.blobs.get(k);
  return r?.blob;
}

export async function vaciarTodo() {
  for (const s of STORES) {
    if (db) await tx(s, 'readwrite', (st) => st.clear()); else memoria[s].clear();
  }
  emitir();
}

// Aviso de cambios para refrescar la interfaz
const oyentes = new Set();
export const alCambiar = (fn) => oyentes.add(fn);
export function emitir() { for (const fn of oyentes) try { fn(); } catch (e) { console.error(e); } }
