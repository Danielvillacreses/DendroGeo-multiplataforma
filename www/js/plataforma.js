// Capa de plataforma: el mismo código corre en el navegador, en Android (APK) y en iOS.
// En las apps nativas usa los plugins de Capacitor (GPS nativo, archivos, compartir);
// en el navegador usa las API web equivalentes.

const Cap = window.Capacitor;
export const NATIVA = !!Cap?.isNativePlatform?.();
export const SO = Cap?.getPlatform?.() || 'web'; // 'android' | 'ios' | 'web'

const plugin = (nombre) => (NATIVA && Cap.registerPlugin ? Cap.registerPlugin(nombre) : null);
const Geolocation = plugin('Geolocation');
const Filesystem = plugin('Filesystem');
const Share = plugin('Share');

export const hayGPS = () => NATIVA || 'geolocation' in navigator;

function mensajeError(err) {
  const t = String(err?.message || err || '');
  if (err?.code === 1 || /denied|permission|not authorized|autoriz/i.test(t)) {
    return { tipo: 'permiso', texto: NATIVA
      ? 'El permiso de ubicación está desactivado. Actívelo en Ajustes del teléfono → Apps → DendroGeo → Ubicación (“Precisa” / “Mientras se usa”).'
      : 'El permiso de ubicación está bloqueado. Actívelo para este sitio en el navegador, o ingrese las coordenadas a mano.' };
  }
  if (err?.code === 3 || /timeout|tiempo/i.test(t)) return { tipo: 'tiempo', texto: 'El GPS no respondió a tiempo. Salga a cielo abierto y vuelva a intentar.' };
  if (/disabled|services|desactiv/i.test(t)) return { tipo: 'apagado', texto: 'La ubicación del teléfono está apagada. Actívela y vuelva a intentar.' };
  return { tipo: 'otro', texto: 'No se pudo obtener la posición: ' + t };
}

const aLectura = (p) => ({
  lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy || 50,
  alt: p.coords.altitude ?? null, t: p.timestamp || Date.now(),
});

/**
 * Observa la posición con máxima precisión. Llama a alLeer(lectura) por cada lectura
 * y a alFallar({tipo, texto}) si hay un error. Devuelve una función para detener.
 */
export async function observarPosicion(alLeer, alFallar) {
  const opciones = { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 };
  if (NATIVA) {
    try {
      let perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted') perm = await Geolocation.requestPermissions({ permissions: ['location'] });
      if (perm.location === 'denied') { alFallar(mensajeError({ code: 1 })); return () => {}; }
      const id = await Geolocation.watchPosition(opciones, (pos, err) => {
        if (err) alFallar(mensajeError(err));
        else if (pos) alLeer(aLectura(pos));
      });
      return () => { Geolocation.clearWatch({ id }).catch(() => {}); };
    } catch (e) { alFallar(mensajeError(e)); return () => {}; }
  }
  if (!('geolocation' in navigator)) {
    alFallar({ tipo: 'otro', texto: 'Este navegador no ofrece geolocalización. Ingrese las coordenadas o ajústelas en el mapa.' });
    return () => {};
  }
  const id = navigator.geolocation.watchPosition((p) => alLeer(aLectura(p)), (e) => alFallar(mensajeError(e)), opciones);
  return () => navigator.geolocation.clearWatch(id);
}

/** Una sola lectura rápida (para "Mi ubicación" en el mapa). */
export async function posicionActual() {
  const opciones = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 };
  try {
    const p = NATIVA ? await Geolocation.getCurrentPosition(opciones)
      : await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, opciones));
    return aLectura(p);
  } catch (e) { throw new Error(mensajeError(e).texto); }
}

/**
 * Entrega un archivo al usuario. En el navegador lo descarga; en Android/iOS lo guarda
 * y abre el menú de compartir (Drive, WhatsApp, correo, Archivos…).
 */
export async function entregarArchivo(nombre, texto, mime) {
  if (NATIVA) {
    const { uri } = await Filesystem.writeFile({ path: nombre, data: texto, directory: 'CACHE', encoding: 'utf8' });
    await Share.share({ title: nombre, dialogTitle: 'Guardar o enviar ' + nombre, url: uri });
    return 'compartido';
  }
  const blob = new Blob([texto], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'descargado';
}

/** El service worker solo hace falta en la versión web (la app nativa ya trae sus archivos). */
export async function registrarModoSinConexion() {
  if (NATIVA || !('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  // Cuando se publica una versión nueva, se recarga una sola vez para usarla de inmediato
  // (si el usuario está escribiendo, se espera a que la app pase a segundo plano).
  const habiaVersion = !!navigator.serviceWorker.controller;
  let recargada = false;
  const recargar = () => {
    if (recargada) return;
    if (document.activeElement?.matches?.('input, textarea, select') && !document.hidden) {
      document.addEventListener('visibilitychange', recargar, { once: true }); return;
    }
    recargada = true; location.reload();
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (habiaVersion) recargar(); });
  try {
    const reg = await navigator.serviceWorker.register('sw.js');
    reg.update().catch(() => {});
  } catch (e) { console.info('Service worker no disponible aquí:', e.message); }
}

// Marca la plataforma en <html> para ajustes de estilo (p. ej. barra de estado en iOS)
document.documentElement.dataset.plataforma = SO;
