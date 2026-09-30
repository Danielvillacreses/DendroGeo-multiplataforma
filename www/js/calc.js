// Cálculos dendrométricos y geodésicos (funciones puras, sin dependencias)

export const ALTURA_PECHO_M = 1.3;

/** DAP (cm) a partir de la circunferencia CAP (cm). */
export const dapDesdeCap = (cap) => (cap > 0 ? cap / Math.PI : null);
export const capDesdeDap = (dap) => (dap > 0 ? dap * Math.PI : null);

/** Área basal (m²) de un árbol con DAP en cm. */
export const areaBasal = (dap) => (dap > 0 ? (Math.PI / 4) * (dap / 100) ** 2 : null);

/** Volumen (m³) = AB · h · factor de forma. */
export function volumen(dap, altura, ff = 0.5) {
  const ab = areaBasal(dap);
  return ab && altura > 0 ? ab * altura * ff : null;
}

/** Área de copa (m²) a partir de dos diámetros perpendiculares (m). */
export function areaCopa(ns, eo) {
  const a = Number(ns) || 0, b = Number(eo) || 0;
  const d = a && b ? (a + b) / 2 : a || b;
  return d > 0 ? (Math.PI / 4) * d * d : null;
}

/**
 * Biomasa aérea (kg) — Chave et al. (2014), ecuación pantropical 4:
 * AGB = 0.0673 · (ρ · D² · H)^0.976   con D en cm, H en m, ρ en g/cm³
 */
export function biomasa(dap, altura, densidad = 0.6) {
  if (!(dap > 0 && altura > 0 && densidad > 0)) return null;
  return 0.0673 * Math.pow(densidad * dap * dap * altura, 0.976);
}

export const FRACCION_CARBONO = 0.47; // IPCC 2006
export const carbono = (agbKg) => (agbKg == null ? null : agbKg * FRACCION_CARBONO);
export const co2e = (cKg) => (cKg == null ? null : (cKg * 44) / 12);

/** Todas las variables derivadas de una medición. */
export function derivados(m, { densidad = 0.6, ff = 0.5 } = {}) {
  const dap = Number(m.dap_cm) || null;
  const h = Number(m.altura_total_m) || null;
  const hc = Number(m.altura_comercial_m) || null;
  const agb = biomasa(dap, h, densidad);
  const c = carbono(agb);
  return {
    ab: areaBasal(dap),
    vol: volumen(dap, h, ff),
    volCom: volumen(dap, hc, ff),
    copa: areaCopa(m.copa_ns_m, m.copa_eo_m),
    agb, c, co2: co2e(c),
    esbeltez: dap && h ? (h * 100) / dap : null, // h/d (m/m)
  };
}

/** Años entre dos fechas ISO (YYYY-MM-DD). */
export function aniosEntre(a, b) {
  return (new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / (365.25 * 864e5);
}

/** Incremento periódico anual entre dos mediciones ordenadas. */
export function ipa(anterior, actual, campo = 'dap_cm') {
  const t = aniosEntre(anterior.fecha, actual.fecha);
  const v0 = Number(anterior[campo]), v1 = Number(actual[campo]);
  if (!(t > 0.08) || !(v0 > 0) || !(v1 > 0)) return null;
  return (v1 - v0) / t;
}

/** Clase diamétrica (límite inferior) con amplitud en cm. */
export const claseDiametrica = (dap, amplitud = 10) => Math.floor(dap / amplitud) * amplitud;

/** Controles de calidad de campo; devuelve lista de avisos en texto. */
export function controlCalidad(m, anterior) {
  const avisos = [];
  const dap = Number(m.dap_cm), h = Number(m.altura_total_m), hc = Number(m.altura_comercial_m);
  if (h && hc && hc > h) avisos.push('La altura comercial supera a la altura total.');
  if (dap && h && h * 100 / dap > 150) avisos.push(`Esbeltez muy alta (h/d = ${Math.round(h * 100 / dap)}). Revise DAP y altura.`);
  if (dap > 300) avisos.push('DAP mayor a 300 cm: confirme la medida.');
  if (h > 70) avisos.push('Altura mayor a 70 m: confirme la medida.');
  if (anterior && anterior.dap_cm && dap) {
    const cambio = (dap - anterior.dap_cm) / anterior.dap_cm;
    if (cambio < -0.03) avisos.push(`El DAP bajó ${Math.abs(cambio * 100).toFixed(1)} % respecto a la medición anterior. Verifique la altura de 1,30 m y la cinta.`);
    const t = aniosEntre(anterior.fecha, m.fecha);
    if (t > 0 && (dap - anterior.dap_cm) / t > 6) avisos.push('Incremento diamétrico mayor a 6 cm/año: poco probable, verifique.');
  }
  return avisos;
}

// ---------------------------------------------------------------------
// Geodesia
// ---------------------------------------------------------------------

/** Desplazamiento en metros entre dos puntos cercanos (aproximación local). */
export function offsetMetros(lat0, lon0, lat, lon) {
  const rad = Math.PI / 180;
  return {
    dx: (lon - lon0) * 111320 * Math.cos(lat0 * rad),
    dy: (lat - lat0) * 110574,
  };
}

export function distanciaM(a, b) {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Promedia lecturas GPS. Cada muestra: {lat, lon, acc, alt, t(ms)}.
 * - descarta lecturas con precisión peor que max(objetivo, 1,5 × la mejor)
 * - media ponderada por 1/acc²
 * - precisión estimada conservadora: las lecturas GPS consecutivas están
 *   correlacionadas (~5 s), así que se usa un número efectivo de muestras.
 */
export function promediarGPS(muestras, objetivo = 5) {
  if (!muestras.length) return null;
  const mejor = Math.min(...muestras.map((s) => s.acc));
  const limite = Math.max(objetivo, mejor * 1.5);
  const usadas = muestras.filter((s) => s.acc <= limite);
  let sw = 0, la = 0, lo = 0, al = 0, swAlt = 0;
  for (const s of usadas) {
    const w = 1 / (s.acc * s.acc);
    sw += w; la += s.lat * w; lo += s.lon * w;
    if (s.alt != null) { al += s.alt * w; swAlt += w; }
  }
  const lat = la / sw, lon = lo / sw;
  // dispersión RMS de las lecturas alrededor de la media (m)
  let ss = 0;
  for (const s of usadas) {
    const { dx, dy } = offsetMetros(lat, lon, s.lat, s.lon);
    ss += dx * dx + dy * dy;
  }
  const dispersion = Math.sqrt(ss / usadas.length);
  const dur = usadas.length > 1 ? (usadas[usadas.length - 1].t - usadas[0].t) / 1000 : 0;
  const nEf = Math.max(1, Math.min(usadas.length, 1 + dur / 5));
  const accMedia = Math.sqrt(usadas.length / sw); // media armónica cuadrática
  const precision = Math.max(accMedia / Math.sqrt(nEf), dispersion / Math.sqrt(nEf), mejor * 0.5);
  return {
    lat, lon,
    alt: swAlt ? al / swAlt : null,
    precision,
    dispersion,
    mejor,
    n: usadas.length,
    descartadas: muestras.length - usadas.length,
  };
}

/** Geográficas WGS84 → UTM (Transverse Mercator, fórmulas de Snyder). */
export function aUTM(lat, lon) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2), rad = Math.PI / 180;
  const zona = Math.floor((lon + 180) / 6) + 1;
  const lon0 = ((zona - 1) * 6 - 180 + 3) * rad;
  const φ = lat * rad, λ = lon * rad;
  const N = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
  const T = Math.tan(φ) ** 2, C = ep2 * Math.cos(φ) ** 2, A = Math.cos(φ) * (λ - lon0);
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * φ
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * φ)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * φ)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * φ));
  const x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let y = k0 * (M + N * Math.tan(φ) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
    + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  if (lat < 0) y += 10000000;
  return { zona, hemisferio: lat < 0 ? 'S' : 'N', este: x, norte: y };
}
