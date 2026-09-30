// Sincronización con Supabase: subir cambios pendientes y bajar cambios de otros usuarios.
// Estrategia: "última escritura gana" usando modificado_cliente; cursor = updated_at del servidor.

import * as store from './store.js';
import { CONFIG } from './config.js';

const ORDEN = ['especies', 'proyectos', 'parcelas', 'arboles', 'mediciones', 'fotos'];
const NO_SUBIR = new Set(['geom', 'area_basal_m2', 'area_copa_m2', 'updated_at', 'created_at']);
const BUCKET = 'fotos-arboles';

let cliente = null;
let sesion = null;
let enCurso = null;
let temporizador = null;

export const estado = {
  configurado: false,
  online: navigator.onLine,
  usuario: null,
  sincronizando: false,
  ultima: null,
  error: null,
  pendientes: 0,
};

const oyentes = new Set();
export const alEstado = (fn) => oyentes.add(fn);
const avisar = () => oyentes.forEach((fn) => { try { fn(estado); } catch {} });

function leerConfig() {
  let url = CONFIG.SUPABASE_URL, key = CONFIG.SUPABASE_ANON_KEY;
  try {
    const guardada = JSON.parse(localStorage.getItem('dg-nube') || 'null');
    if (guardada?.url && guardada?.key) ({ url, key } = guardada);
  } catch {}
  return url && key ? { url, key } : null;
}

export function guardarConfig(url, key) {
  try {
    if (url && key) localStorage.setItem('dg-nube', JSON.stringify({ url: url.trim(), key: key.trim() }));
    else localStorage.removeItem('dg-nube');
  } catch {}
  return iniciar();
}

export function configActual() { return leerConfig(); }

export async function iniciar() {
  const cfg = leerConfig();
  cliente = null; sesion = null;
  estado.configurado = !!cfg; estado.usuario = null; estado.error = null;
  if (cfg && window.supabase?.createClient) {
    try {
      cliente = window.supabase.createClient(cfg.url, cfg.key, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      const { data } = await cliente.auth.getSession();
      sesion = data.session;
      estado.usuario = sesion?.user?.email ?? null;
      cliente.auth.onAuthStateChange((_e, s) => {
        sesion = s; estado.usuario = s?.user?.email ?? null; avisar();
        if (s) programar(500);
      });
    } catch (e) {
      estado.error = 'No se pudo conectar con la nube: ' + e.message;
    }
  } else if (cfg) {
    estado.error = 'No se cargó la librería de Supabase. Abra la app con conexión una vez.';
  }
  await contarPendientes();
  estado.ultima = await store.meta('ultima_sync');
  avisar();
  if (sesion) programar(1000);
}

// --- Autenticación -------------------------------------------------------
export async function entrar(email, clave) {
  if (!cliente) throw new Error('Configure primero la conexión a la nube.');
  const { error } = await cliente.auth.signInWithPassword({ email, password: clave });
  if (error) throw new Error(traducir(error.message));
}
export async function registrar(email, clave) {
  if (!cliente) throw new Error('Configure primero la conexión a la nube.');
  const { data, error } = await cliente.auth.signUp({ email, password: clave });
  if (error) throw new Error(traducir(error.message));
  return !data.session; // true = debe confirmar el correo
}
export async function salir() { await cliente?.auth.signOut(); sesion = null; estado.usuario = null; avisar(); }

function traducir(m) {
  if (/Invalid login/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/Email not confirmed/i.test(m)) return 'Confirme su correo antes de ingresar.';
  if (/already registered/i.test(m)) return 'Ese correo ya tiene cuenta. Use “Ingresar”.';
  if (/Password should be/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
  return m;
}

// --- Pendientes ----------------------------------------------------------
async function proyectosDemo() {
  return new Set((await store.todos('proyectos')).filter((p) => p._demo).map((p) => p.id));
}

export async function contarPendientes() {
  const demo = await proyectosDemo();
  let n = 0;
  for (const t of ORDEN) {
    const recs = await store.todos(t);
    n += recs.filter((r) => r._pend && !r._demo && !demo.has(r.proyecto_id) && !(t === 'proyectos' && demo.has(r.id))).length;
  }
  estado.pendientes = n;
  return n;
}

const limpiar = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_') && !NO_SUBIR.has(k)));

// --- Ciclo de sincronización ----------------------------------------------
export function programar(ms = 3000) {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => sincronizar().catch(() => {}), ms);
}

export function sincronizar() {
  if (enCurso) return enCurso;
  estado.online = navigator.onLine;
  if (!cliente || !sesion || !estado.online) {
    return contarPendientes().then(() => { avisar(); return false; });
  }
  enCurso = (async () => {
    estado.sincronizando = true; estado.error = null; avisar();
    try {
      await subir();
      await bajar();
      estado.ultima = new Date().toISOString();
      await store.meta('ultima_sync', estado.ultima);
      return true;
    } catch (e) {
      estado.error = e.message || String(e);
      return false;
    } finally {
      estado.sincronizando = false;
      await contarPendientes();
      avisar();
      store.emitir();
      enCurso = null;
    }
  })();
  return enCurso;
}

async function subir() {
  const demo = await proyectosDemo();
  for (const t of ORDEN) {
    const pend = (await store.todos(t)).filter((r) =>
      r._pend && !r._demo && !demo.has(r.proyecto_id) && !(t === 'proyectos' && demo.has(r.id)));
    if (!pend.length) continue;

    if (t === 'fotos') {
      for (const f of pend) {
        if (!f.deleted) {
          const blob = await store.leerBlob(f.id);
          if (blob) {
            const { error } = await cliente.storage.from(BUCKET)
              .upload(f.storage_path, blob, { upsert: true, contentType: 'image/jpeg' });
            if (error && !/exists/i.test(error.message)) throw new Error('Foto: ' + error.message);
          }
        }
        const { error } = await cliente.from('fotos').upsert(limpiar(f), { onConflict: 'id' });
        if (error) throw new Error('fotos: ' + error.message);
        await store.guardarVarios('fotos', [{ ...f, _pend: 0 }]);
      }
      continue;
    }

    for (let i = 0; i < pend.length; i += 200) {
      const lote = pend.slice(i, i + 200);
      const { error } = await cliente.from(t).upsert(lote.map(limpiar), { onConflict: 'id' });
      if (error) throw new Error(`${t}: ${error.message}`);
      // marcar como subidos solo si no cambiaron mientras tanto
      const actuales = await Promise.all(lote.map((r) => store.uno(t, r.id)));
      await store.guardarVarios(t, actuales
        .filter((a, k) => a && a.modificado_cliente === lote[k].modificado_cliente)
        .map((a) => ({ ...a, _pend: 0 })));
    }
  }
}

async function bajar() {
  const cursor = (await store.meta('cursor')) || '1970-01-01T00:00:00Z';
  // margen de 2 min para transacciones que confirmaron tarde (upsert es idempotente)
  const desde = new Date(new Date(cursor).getTime() - 120000).toISOString();
  let maximo = cursor;
  for (const t of ORDEN) {
    let desdeT = desde;
    for (;;) {
      const { data, error } = await cliente.from(t).select('*')
        .gt('updated_at', desdeT).order('updated_at', { ascending: true }).limit(1000);
      if (error) throw new Error(`${t}: ${error.message}`);
      if (!data.length) break;
      const locales = await Promise.all(data.map((r) => store.uno(t, r.id)));
      const aplicar = data.filter((r, k) => {
        const l = locales[k];
        // no pisar un cambio local más reciente que todavía no se subió
        return !(l && l._pend && l.modificado_cliente > r.modificado_cliente);
      }).map((r) => ({ ...r, _pend: 0 }));
      await store.guardarVarios(t, aplicar);
      const ult = data[data.length - 1].updated_at;
      if (ult > maximo) maximo = ult;
      if (data.length < 1000) break;
      desdeT = ult;
    }
  }
  await store.meta('cursor', maximo);
}

/** URL temporal de una foto que no está en el dispositivo. */
export async function urlFoto(f) {
  const local = await store.leerBlob(f.id);
  if (local) return URL.createObjectURL(local);
  if (!cliente || !sesion || !navigator.onLine) return null;
  const { data } = await cliente.storage.from(BUCKET).createSignedUrl(f.storage_path, 3600);
  return data?.signedUrl ?? null;
}

// --- Disparadores automáticos -------------------------------------------
window.addEventListener('online', () => { estado.online = true; avisar(); programar(800); });
window.addEventListener('offline', () => { estado.online = false; avisar(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) programar(1500); });
setInterval(() => programar(0), 60000); // sube pendientes y trae cambios de otros equipos
store.alCambiar(() => { contarPendientes().then(avisar); });
