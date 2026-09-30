// Fondo claro u oscuro, elegido por el usuario y recordado en el equipo.
// Mientras no elija, la app sigue la apariencia del teléfono o computadora.

const CLAVE = 'dg-tema';

export function temaGuardado() {
  try { const t = localStorage.getItem(CLAVE); return t === 'oscuro' || t === 'claro' ? t : null; } catch { return null; }
}

export function temaActual() {
  return temaGuardado() || (matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro');
}

function pintarSistema(tema) {
  // color de la barra del navegador / de la app instalada
  requestAnimationFrame(() => {
    const fondo = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', fondo || (tema === 'oscuro' ? '#141c17' : '#ffffff')));
  });
  // barra de estado en Android / iOS (texto claro sobre fondo oscuro y viceversa)
  try {
    const SystemBars = window.capacitorExports?.SystemBars;
    if (window.Capacitor?.isNativePlatform?.() && SystemBars) SystemBars.setStyle({ style: tema === 'oscuro' ? 'DARK' : 'LIGHT' }).catch(() => {});
  } catch {}
}

export function aplicarTema(tema, guardar = true) {
  const t = tema === 'oscuro' ? 'oscuro' : 'claro';
  document.documentElement.setAttribute('data-theme', t === 'oscuro' ? 'dark' : 'light');
  if (guardar) { try { localStorage.setItem(CLAVE, t); } catch {} }
  pintarSistema(t);
  window.dispatchEvent(new CustomEvent('dg-tema', { detail: t }));
}

export function alternarTema() { aplicarTema(temaActual() === 'oscuro' ? 'claro' : 'oscuro'); }

export function iniciarTema() {
  const g = temaGuardado();
  if (g) aplicarTema(g, false); else pintarSistema(temaActual());
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (!temaGuardado()) { pintarSistema(temaActual()); window.dispatchEvent(new CustomEvent('dg-tema', { detail: temaActual() })); }
  });
}
