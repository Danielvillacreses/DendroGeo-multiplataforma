// DendroGeo — interfaz de la aplicación (campo + plataforma web)
import * as store from './store.js';
import * as sync from './sync.js';
import * as C from './calc.js';
import { asegurarEspecies, cargarDemo, borrarDemo } from './demo.js';
import * as P from './plataforma.js';
import { crearCinta } from './cinta.js';
import * as T from './tema.js';

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 1) => (n == null || !isFinite(n) ? '—' : Number(n).toLocaleString('es-EC', { minimumFractionDigits: d, maximumFractionDigits: d }));
const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const hoy = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const fechaLarga = (f) => (f ? new Date(f + 'T12:00:00').toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const pref = {
  get(k, d) { try { const v = localStorage.getItem('dg-' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('dg-' + k, JSON.stringify(v)); } catch {} },
};
const main = $('#main');
const ESTADOS = [['bueno', 'Bueno'], ['regular', 'Regular'], ['malo', 'Malo'], ['muerto', 'Muerto']];
const VIGOR = [[1, 'Alto'], [2, 'Medio'], [3, 'Bajo']];
const FENOLOGIA = [['vegetativo', 'Vegetativo'], ['floracion', 'Floración'], ['fructificacion', 'Fructificación'], ['defoliado', 'Defoliado']];
const DANOS = [['insectos', 'Insectos'], ['hongos', 'Hongos'], ['mecanico', 'Daño mecánico'], ['fuego', 'Fuego'], ['anillado', 'Anillado'], ['epifitas', 'Epífitas/lianas'], ['inclinado', 'Inclinado']];

let toastT;
function toast(msg, ms = 3200) {
  $('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastT); toastT = setTimeout(() => t.remove(), ms);
}

// Botón que pide un segundo toque para confirmar (los diálogos del navegador no siempre están disponibles)
function confirmar(btn, texto, accion) {
  if (btn.dataset.armado) { accion(); return; }
  const orig = btn.textContent;
  btn.dataset.armado = '1'; btn.textContent = texto;
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armado; btn.textContent = orig; } }, 3500);
}

// ---------------------------------------------------------------------
// Datos en memoria (índices)
// ---------------------------------------------------------------------
const D = { proyectos: [], parcelas: [], especies: [], arboles: [], mediciones: [], fotos: [] };
const I = { proy: new Map(), par: new Map(), esp: new Map(), arb: new Map(), meds: new Map(), fotos: new Map() };

async function cargarDatos() {
  for (const t of store.TABLAS) D[t] = (await store.todos(t)).filter((r) => !r.deleted);
  D.especies.sort((a, b) => a.nombre_comun.localeCompare(b.nombre_comun, 'es'));
  D.proyectos.sort((a, b) => (a._demo ? 1 : 0) - (b._demo ? 1 : 0) || a.nombre.localeCompare(b.nombre, 'es'));
  D.parcelas.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
  D.arboles.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
  I.proy = new Map(D.proyectos.map((x) => [x.id, x]));
  I.par = new Map(D.parcelas.map((x) => [x.id, x]));
  I.esp = new Map(D.especies.map((x) => [x.id, x]));
  I.arb = new Map(D.arboles.map((x) => [x.id, x]));
  I.meds = new Map(); I.fotos = new Map();
  for (const m of D.mediciones) { if (!I.meds.has(m.arbol_id)) I.meds.set(m.arbol_id, []); I.meds.get(m.arbol_id).push(m); }
  for (const l of I.meds.values()) l.sort((a, b) => a.fecha.localeCompare(b.fecha));
  for (const f of D.fotos) { if (!I.fotos.has(f.arbol_id)) I.fotos.set(f.arbol_id, []); I.fotos.get(f.arbol_id).push(f); }
}
const ultimaMed = (id) => { const l = I.meds.get(id); return l?.[l.length - 1]; };
const especieDe = (a) => I.esp.get(a?.especie_id);
const ffDe = (proyId) => Number(I.proy.get(proyId)?.factor_forma) || 0.5;
const densDe = (a) => Number(especieDe(a)?.densidad_madera) || 0.6;
const esDemo = () => !sync.estado.configurado;

// ---------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------
let vista = 'registrar';
let mapa = null, miniMapa = null;

function ir(v, opciones = {}) {
  vista = v;
  if (location.hash.slice(1) !== v) history.replaceState(null, '', '#' + v);
  $$('#tabs button').forEach((b) => b.setAttribute('aria-current', b.dataset.v === v ? 'page' : 'false'));
  if (mapa) { mapa.remove(); mapa = null; }
  if (miniMapa) { miniMapa.remove(); miniMapa = null; }
  main.onclick = null;
  if (gps.activo) detenerGPS(false);
  main.scrollTop = 0;
  ({ registrar: vRegistrar, mapa: vMapa, arboles: vArboles, panel: vPanel, ajustes: vAjustes }[v] || vRegistrar)(opciones);
}
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) ir(b.dataset.v); });
// Fondo claro / oscuro
function pintarBotonTema() {
  const b = $('#tema-btn'); if (!b) return;
  b.setAttribute('aria-label', T.temaActual() === 'oscuro' ? 'Cambiar a fondo claro' : 'Cambiar a fondo oscuro');
}
$('#tema-btn').addEventListener('click', () => { T.alternarTema(); toast(T.temaActual() === 'oscuro' ? 'Fondo oscuro activado.' : 'Fondo claro activado.', 1800); });
window.addEventListener('dg-tema', () => {
  pintarBotonTema();
  if (vista === 'mapa') vMapa();
  if (vista === 'ajustes') $$('[data-tema]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tema === T.temaActual())));
});
$('#sync-pill').addEventListener('click', () => {
  if (sync.estado.configurado && sync.estado.usuario) { sync.sincronizar().then((ok) => ok && toast('Datos sincronizados con la nube.')); }
  else ir('ajustes');
});

// ---------------------------------------------------------------------
// Estado de sincronización (barra superior)
// ---------------------------------------------------------------------
function pintarSync(e = sync.estado) {
  const pill = $('#sync-pill'), txt = $('#sync-text');
  let s = 'ok', t = 'Sincronizado';
  if (!e.configurado) { s = 'off'; t = 'Sin nube'; }
  else if (!e.usuario) { s = 'err'; t = 'Inicie sesión'; }
  else if (e.sincronizando) { s = 'run'; t = 'Sincronizando'; }
  else if (!e.online) { s = e.pendientes ? 'pend' : 'off'; t = e.pendientes ? `Sin conexión · ${e.pendientes}` : 'Sin conexión'; }
  else if (e.error) { s = 'err'; t = 'Error de sync'; }
  else if (e.pendientes) { s = 'pend'; t = `${e.pendientes} por subir`; }
  pill.dataset.s = s; txt.textContent = t;
  pill.title = e.error || (e.ultima ? 'Última sincronización: ' + new Date(e.ultima).toLocaleString('es-EC') : '');
  if (vista === 'ajustes') { const box = $('#estado-sync'); if (box) box.innerHTML = htmlEstadoSync(); }
}
sync.alEstado(pintarSync);

// ---------------------------------------------------------------------
// Capas de mapa (con aviso si no cargan: sin conexión o bloqueadas)
// ---------------------------------------------------------------------
function capasBase(m, nota) {
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imágenes © Esri' });
  const elegida = pref.get('capa', 'sat') === 'osm' ? osm : sat;
  elegida.addTo(m);
  L.control.layers({ 'Satélite': sat, 'Calles (OSM)': osm }, null, { position: 'topright' }).addTo(m);
  m.on('baselayerchange', (e) => pref.set('capa', e.layer === osm ? 'osm' : 'sat'));
  let avisado = false;
  const fallo = () => {
    if (avisado) return; avisado = true;
    m.getContainer().classList.add('sin-teselas');
    if (nota) { nota.hidden = false; nota.textContent = 'El mapa base no está disponible (sin conexión o bloqueado). Los puntos y sus coordenadas se muestran igual.'; }
  };
  osm.on('tileerror', fallo); sat.on('tileerror', fallo);
}

// ---------------------------------------------------------------------
// VISTA: Registrar
// ---------------------------------------------------------------------
let F = null; // borrador del formulario
const gps = { watch: null, muestras: [], inicio: 0, timer: null, activo: false, error: null };

function borradorNuevo(base = {}) {
  const proyecto_id = base.proyecto_id || pref.get('proyecto', null) || D.proyectos[0]?.id || '';
  const guardada = pref.get('parcela', null);
  const parcela_id = base.parcela_id ?? (guardada && I.par.get(guardada)?.proyecto_id === proyecto_id ? guardada
    : D.parcelas.find((p) => p.proyecto_id === proyecto_id)?.id || '');
  return {
    arbol_id: null, proyecto_id, parcela_id, codigo: '', codigoAuto: true,
    especieTxt: '', espNueva: { cient: '', dens: 0.6 }, editar: null, actualizarPos: false,
    ubic: null, entrada: pref.get('entrada', 'dap'), tocado: false, precargado: {},
    med: { fecha: hoy(), cap_cm: null, dap_cm: null, altura_total_m: null, altura_comercial_m: null, copa_ns_m: null, copa_eo_m: null,
      estado_sanitario: 'bueno', vigor: 1, fenologia: 'vegetativo', danos: [], observaciones: '', tecnico: pref.get('tecnico', '') },
    fotos: [],
  };
}
const modo = () => (F?.arbol_id ? 'remedir' : 'nuevo');
const etiquetaEsp = (e) => (e.nombre_cientifico ? `${e.nombre_comun} — ${e.nombre_cientifico}` : e.nombre_comun);
const arbolPorCodigo = (cod) => { const c = (cod || '').trim().toLowerCase(); return c ? D.arboles.find((a) => a.proyecto_id === F.proyecto_id && a.codigo.toLowerCase() === c) : null; };

function siguienteCodigo(proyecto_id, parcela_id) {
  const par = I.par.get(parcela_id);
  const pref0 = par ? par.codigo + '-' : 'A-';
  let max = 0;
  for (const a of D.arboles) if (a.proyecto_id === proyecto_id && a.codigo.startsWith(pref0)) {
    const n = parseInt(a.codigo.slice(pref0.length), 10); if (n > max) max = n;
  }
  return pref0 + String(max + 1).padStart(3, '0');
}

// Especies usadas: primero las elegidas últimamente, luego las más frecuentes del proyecto
function especiesRecientes() {
  const cuenta = new Map();
  for (const a of D.arboles) if (a.proyecto_id === F.proyecto_id && a.especie_id) cuenta.set(a.especie_id, (cuenta.get(a.especie_id) || 0) + 1);
  const ids = [...pref.get('esp_recientes', []), ...[...cuenta.entries()].sort((p, q) => q[1] - p[1]).map(([id]) => id)];
  return [...new Set(ids)].map((id) => I.esp.get(id)).filter(Boolean).slice(0, 8);
}
function tecnicosConocidos() {
  return [...new Set([...pref.get('tecnicos', []), ...D.mediciones.map((m) => m.tecnico).filter(Boolean)])].slice(0, 30);
}

function cargarArbol(a) {
  F.arbol_id = a.id; F.codigo = a.codigo; F.codigoAuto = false;
  F.proyecto_id = a.proyecto_id; F.parcela_id = a.parcela_id || '';
  const e = especieDe(a); F.especieTxt = e ? etiquetaEsp(e) : '';
  F.editar = null; F.actualizarPos = false;
  precargarRemedicion();
}
function soltarArbol() {
  // vuelve a "árbol nuevo" y quita los valores que se habían copiado de la medición anterior
  for (const [k, v] of Object.entries(F.precargado)) if (F.med[k] === v) F.med[k] = null;
  F.precargado = {}; F.arbol_id = null; F.actualizarPos = false;
}
function precargarRemedicion() {
  const m = ultimaMed(F.arbol_id);
  if (!m) return;
  F.precargado = {};
  for (const k of ['altura_total_m', 'altura_comercial_m', 'copa_ns_m', 'copa_eo_m']) {
    if (F.med[k] == null && m[k] != null) { F.med[k] = Number(m[k]); F.precargado[k] = F.med[k]; }
  }
  if (!F.tocado) Object.assign(F.med, {
    estado_sanitario: m.estado_sanitario || 'bueno', vigor: m.vigor || 1, fenologia: m.fenologia || 'vegetativo', danos: [...(m.danos || [])],
  });
}

function opciones(lista, sel, etiqueta, vacio) {
  return (vacio ? `<option value="">${esc(vacio)}</option>` : '') +
    lista.map((x) => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(etiqueta(x))}</option>`).join('');
}
const chips = (nombre, lista, sel, multi = false) =>
  `<div class="chips" data-chips="${nombre}" ${multi ? 'data-multi="1"' : ''}>` +
  lista.map(([v, t]) => `<button type="button" class="chip" data-val="${esc(v)}" aria-pressed="${multi ? sel.includes(v) : String(sel) === String(v)}">${nombre === 'estado_sanitario' ? `<span class="sw" style="background:var(--${{ bueno: 'ok', regular: 'warn', malo: 'bad', muerto: 'dead' }[v]})"></span>` : ''}${esc(t)}</button>`).join('') + '</div>';

// Medidas con cinta: rango, precisión y escala de cada una
const MEDIDAS = {
  dap_cm: { etq: 'DAP', sub: 'diámetro a 1,30 m', unidad: 'cm', max: 300, ppu: 48, inicial: 20 },
  cap_cm: { etq: 'CAP', sub: 'circunferencia a 1,30 m', unidad: 'cm', max: 950, ppu: 40, inicial: 60 },
  altura_total_m: { etq: 'Altura total', sub: 'de la base al ápice', unidad: 'm', max: 70, ppu: 72, inicial: 10 },
  altura_comercial_m: { etq: 'Altura comercial', sub: 'hasta la primera rama o defecto', unidad: 'm', max: 70, ppu: 72, inicial: 5 },
  copa_ns_m: { etq: 'Copa norte–sur', sub: 'diámetro de copa', unidad: 'm', max: 50, ppu: 72, inicial: 5 },
  copa_eo_m: { etq: 'Copa este–oeste', sub: 'diámetro de copa', unidad: 'm', max: 50, ppu: 72, inicial: 5 },
};
let cintas = {};
const medidaHTML = (k) => {
  const c = MEDIDAS[k];
  return `<div class="medida">
    <div class="medida-head">
      <label class="field" for="m-${k}"><span>${c.etq} <em>(${c.sub})</em></span></label>
      <div class="unit"><input id="m-${k}" data-med="${k}" type="number" inputmode="decimal" step="0.1" min="0" max="${c.max}" value="${F.med[k] ?? ''}" placeholder="—"><i>${c.unidad}</i></div>
    </div>
    <div class="cinta-host" data-cinta="${k}"></div>
    ${k === 'dap_cm' || k === 'cap_cm' ? '<p class="hint" id="conv"></p>' : ''}
  </div>`;
};

function panelProyecto(nuevo) {
  const p = nuevo ? { nombre: '', factor_forma: 0.5 } : I.proy.get(F.proyecto_id) || {};
  return `<div class="panel-edicion" data-panel="proy">
    <b>${nuevo ? 'Nuevo proyecto' : 'Editar proyecto'}</b>
    <div class="grid2">
      <label class="field"><span>Nombre</span><input id="pe-nombre" value="${esc(p.nombre)}" placeholder="Ej. Reforestación microcuenca"></label>
      <label class="field"><span>Factor de forma</span><input id="pe-ff" type="number" step="0.01" min="0.2" max="1" value="${p.factor_forma ?? 0.5}"></label>
    </div>
    <div class="row"><button type="button" class="btn ghost sm" data-accion="cancelar">Cancelar</button><button type="button" class="btn primary sm" data-accion="guardar-proy" data-nuevo="${nuevo ? 1 : ''}">${nuevo ? 'Crear proyecto' : 'Guardar cambios'}</button></div>
  </div>`;
}
function panelParcela(nuevo) {
  const p = nuevo ? { codigo: '', nombre: '', area_m2: '' } : I.par.get(F.parcela_id) || {};
  return `<div class="panel-edicion" data-panel="par">
    <b>${nuevo ? 'Nueva parcela' : 'Editar parcela'}</b>
    <div class="grid3">
      <label class="field"><span>Código</span><input id="pa-cod" class="mono" value="${esc(p.codigo)}" placeholder="P03"></label>
      <label class="field"><span>Nombre</span><input id="pa-nom" value="${esc(p.nombre || '')}" placeholder="Ribera del estero"></label>
      <label class="field"><span>Área</span><div class="unit"><input id="pa-area" type="number" min="0" step="any" value="${p.area_m2 ?? ''}" placeholder="1000"><i>m²</i></div></label>
    </div>
    <div class="row"><button type="button" class="btn ghost sm" data-accion="cancelar">Cancelar</button><button type="button" class="btn primary sm" data-accion="guardar-par" data-nuevo="${nuevo ? 1 : ''}">${nuevo ? 'Crear parcela' : 'Guardar cambios'}</button></div>
  </div>`;
}
function panelEspecie() {
  const e = especieElegida() || {};
  return `<div class="panel-edicion" data-panel="esp">
    <b>Editar especie del catálogo</b>
    <div class="grid2">
      <label class="field"><span>Nombre común</span><input id="es-com" value="${esc(e.nombre_comun || '')}"></label>
      <label class="field"><span>Nombre científico</span><input id="es-cie" value="${esc(e.nombre_cientifico || '')}"></label>
      <label class="field"><span>Familia</span><input id="es-fam" value="${esc(e.familia || '')}"></label>
      <label class="field"><span>Densidad de madera</span><div class="unit"><input id="es-den" type="number" step="0.01" min="0.1" max="1.4" value="${e.densidad_madera ?? 0.6}"><i>g/cm³</i></div></label>
    </div>
    <p class="small muted">El cambio se aplica a todos los árboles de esta especie.</p>
    <div class="row"><button type="button" class="btn ghost sm" data-accion="cancelar">Cancelar</button><button type="button" class="btn primary sm" data-accion="guardar-esp">Guardar especie</button></div>
  </div>`;
}
function panelCodigo() {
  const a = I.arb.get(F.arbol_id) || {};
  return `<div class="panel-edicion" data-panel="cod">
    <b>Corregir el código de placa</b>
    <label class="field"><span>Código correcto</span><input id="co-cod" class="mono" value="${esc(a.codigo || '')}"></label>
    <p class="small muted">Se conserva todo el historial del árbol; solo cambia su código.</p>
    <div class="row"><button type="button" class="btn ghost sm" data-accion="cancelar">Cancelar</button><button type="button" class="btn primary sm" data-accion="guardar-cod">Cambiar código</button></div>
  </div>`;
}

function htmlEstadoCodigo() {
  const a = F.arbol_id ? I.arb.get(F.arbol_id) : null;
  if (a) {
    const n = I.meds.get(a.id)?.length || 0, m = ultimaMed(a.id);
    return `<div class="estado-codigo existe" id="estado-cod"><span class="tag">${esc(a.codigo)}</span>
      <span>Árbol ya registrado · ${esc(especieDe(a)?.nombre_comun || 'sin especie')} · ${n} ${n === 1 ? 'medición' : 'mediciones'}${m ? `, la última el ${fechaLarga(m.fecha)} (DAP ${fmt(m.dap_cm)} cm)` : ''}. Se agregará una nueva medición.</span>
      <button type="button" class="linkbtn" data-editar="cod">Corregir código</button>
      <button type="button" class="linkbtn" data-accion="otro">Registrar otro árbol</button></div>`;
  }
  const posible = arbolPorCodigo(F.codigo);
  if (posible) return `<div class="estado-codigo existe" id="estado-cod"><span>El código <b class="mono">${esc(posible.codigo)}</b> ya está registrado. Cargando sus datos…</span></div>`;
  return `<div class="estado-codigo" id="estado-cod">${F.codigo ? `<span>Código libre: se registrará un <b>árbol nuevo</b>.</span>` : '<span>Escriba el código de la placa o elija un árbol ya registrado de la lista.</span>'}</div>`;
}

function htmlEspNueva() {
  const t = (F.especieTxt || '').trim();
  if (!t || especieElegida()) return '';
  return `<div class="panel-edicion" id="esp-nueva">
    <span class="small"><b>“${esc(t.split(' — ')[0])}”</b> no está en el catálogo. Se agregará al guardar y quedará disponible para los próximos registros.</span>
    <div class="grid2">
      <label class="field"><span>Nombre científico <em>(opcional)</em></span><input id="en-cie" value="${esc(F.espNueva.cient)}" placeholder="Género especie"></label>
      <label class="field"><span>Densidad de madera</span><div class="unit"><input id="en-den" type="number" step="0.01" min="0.1" max="1.4" value="${F.espNueva.dens}"><i>g/cm³</i></div></label>
    </div>
  </div>`;
}

function vRegistrar(op = {}) {
  Object.values(cintas).forEach((c) => c.destruir()); cintas = {};
  if (op.arbol_id) {
    const a = I.arb.get(op.arbol_id);
    F = borradorNuevo({ proyecto_id: a.proyecto_id, parcela_id: a.parcela_id || '' });
    cargarArbol(a);
  }
  if (!F) F = borradorNuevo();
  if (!F.arbol_id && F.codigoAuto) F.codigo = siguienteCodigo(F.proyecto_id, F.parcela_id);
  const a = F.arbol_id ? I.arb.get(F.arbol_id) : null;
  const proy = I.proy.get(F.proyecto_id);
  const parcelas = D.parcelas.filter((p) => p.proyecto_id === F.proyecto_id);
  const recientes = especiesRecientes();
  const esp = especieElegida();

  main.innerHTML = `<section class="view" aria-labelledby="t-reg">
    <div class="card-head">
      <div><p class="eyebrow">Trabajo de campo</p><h1 id="t-reg">Registrar árbol</h1></div>
      ${a ? '<span class="pill tape">Remedición</span>' : '<span class="pill">Árbol nuevo</span>'}
    </div>
    ${!D.proyectos.length ? `<div class="alerta info">Todavía no hay proyectos. Cree el primero con el botón <b>+ Nuevo</b> junto a Proyecto.</div>` : ''}
    ${proy?._demo ? `<div class="alerta info small">Está usando el proyecto de ejemplo: sus registros quedan en este equipo pero no se suben a la nube. Cree su propio proyecto con <b>+ Nuevo</b>.</div>` : ''}

    <div class="split">
      <div style="display:grid;gap:16px;min-width:0">
        <div class="card" id="card-id">
          <h2>Identificación</h2>

          <div class="field"><span>Proyecto</span>
            <div class="combo"><select id="f-proy" aria-label="Proyecto">${D.proyectos.length ? opciones(D.proyectos, F.proyecto_id, (p) => p.nombre) : '<option value="">Sin proyectos</option>'}</select>
              <div class="acciones"><button type="button" class="icono-btn" data-editar="proy-nuevo" aria-expanded="${F.editar === 'proy-nuevo'}">+ Nuevo</button>
              <button type="button" class="icono-btn" data-editar="proy" aria-expanded="${F.editar === 'proy'}" ${proy ? '' : 'disabled'}>Editar</button></div></div>
          </div>
          ${F.editar === 'proy-nuevo' ? panelProyecto(true) : F.editar === 'proy' ? panelProyecto(false) : ''}

          <div class="field"><span>Parcela</span>
            <div class="combo"><select id="f-par" aria-label="Parcela">${opciones(parcelas, F.parcela_id, (p) => `${p.codigo}${p.nombre ? ' · ' + p.nombre : ''}${p.area_m2 ? ` (${fmt(p.area_m2, 0)} m²)` : ''}`, 'Sin parcela')}</select>
              <div class="acciones"><button type="button" class="icono-btn" data-editar="par-nueva" aria-expanded="${F.editar === 'par-nueva'}" ${proy ? '' : 'disabled'}>+ Nueva</button>
              <button type="button" class="icono-btn" data-editar="par" aria-expanded="${F.editar === 'par'}" ${F.parcela_id ? '' : 'disabled'}>Editar</button></div></div>
          </div>
          ${F.editar === 'par-nueva' ? panelParcela(true) : F.editar === 'par' ? panelParcela(false) : ''}

          <div class="field"><span>Código de placa <em>(escriba uno nuevo o elija uno registrado)</em></span>
            <div class="combo"><input id="f-cod" list="dl-arb" value="${esc(F.codigo)}" autocomplete="off" class="mono" placeholder="P01-001">
              <div class="acciones"><button type="button" class="icono-btn" data-accion="siguiente" title="Siguiente código libre de la parcela">Siguiente</button>
              <button type="button" class="icono-btn" data-accion="cercanos" title="Árboles registrados cerca de su posición">Cerca de mí</button></div></div>
          </div>
          <datalist id="dl-arb">${D.arboles.filter((x) => x.proyecto_id === F.proyecto_id).map((x) => `<option value="${esc(x.codigo)}">${esc(especieDe(x)?.nombre_comun || '')}${I.par.get(x.parcela_id) ? ' · ' + esc(I.par.get(x.parcela_id).codigo) : ''}</option>`).join('')}</datalist>
          ${htmlEstadoCodigo()}
          ${F.editar === 'cod' ? panelCodigo() : ''}
          <div id="cercanos"></div>

          <div class="field"><span>Especie <em>(elija del catálogo o escriba una nueva)</em></span>
            <div class="combo"><input id="f-esp" list="dl-esp" value="${esc(F.especieTxt)}" autocomplete="off" placeholder="Ej. Guayacán">
              <div class="acciones"><button type="button" class="icono-btn" data-editar="esp" aria-expanded="${F.editar === 'esp'}" ${esp ? '' : 'disabled'}>Editar</button></div></div>
          </div>
          <datalist id="dl-esp">${D.especies.map((e) => `<option value="${esc(etiquetaEsp(e))}">`).join('')}</datalist>
          ${recientes.length ? `<div class="recientes"><span class="small muted">Usadas:</span>${recientes.map((e) => `<button type="button" class="chip" data-esp="${esc(e.id)}" aria-pressed="${esp?.id === e.id}">${esc(e.nombre_comun)}</button>`).join('')}</div>` : ''}
          <div id="esp-nueva-box">${htmlEspNueva()}</div>
          ${F.editar === 'esp' && esp ? panelEspecie() : ''}
        </div>

        <div class="card gps" id="card-gps">${htmlGPS()}</div>

        <div class="card">
          <div class="card-head"><h2>Medición</h2>
            <label class="field" style="width:170px"><span>Fecha</span><input id="m-fecha" type="date" value="${F.med.fecha}" max="${hoy()}"></label></div>
          <div class="row"><span class="small muted">Diámetro medido como</span>
            <div class="seg" role="group" aria-label="Medir diámetro como">
              <button type="button" data-entrada="dap" aria-pressed="${F.entrada === 'dap'}">DAP</button>
              <button type="button" data-entrada="cap" aria-pressed="${F.entrada === 'cap'}">CAP</button>
            </div></div>
          <p class="small muted">Deslice cada cinta con el dedo, use − / + para ajustar de 0,1 en 0,1, o escriba el valor.</p>
          <div class="medidas">
            ${medidaHTML(F.entrada === 'dap' ? 'dap_cm' : 'cap_cm')}
            ${medidaHTML('altura_total_m')}
            ${medidaHTML('altura_comercial_m')}
            ${medidaHTML('copa_ns_m')}
            ${medidaHTML('copa_eo_m')}
          </div>
          <div class="field"><span>Estado sanitario</span>${chips('estado_sanitario', ESTADOS, F.med.estado_sanitario)}</div>
          <div class="grid2">
            <div class="field"><span>Vigor</span>${chips('vigor', VIGOR, F.med.vigor)}</div>
            <div class="field"><span>Fenología</span>${chips('fenologia', FENOLOGIA, F.med.fenologia)}</div>
          </div>
          <div class="field"><span>Daños observados</span>${chips('danos', DANOS, F.med.danos, true)}</div>
          <label class="field"><span>Observaciones</span><textarea id="m-obs" placeholder="Bifurcado bajo 1,30 m, medido en el fuste principal…">${esc(F.med.observaciones)}</textarea></label>
          <label class="field"><span>Técnico responsable</span><input id="m-tec" list="dl-tec" value="${esc(F.med.tecnico)}" autocomplete="off"></label>
          <datalist id="dl-tec">${tecnicosConocidos().map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
        </div>
      </div>

      <div style="display:grid;gap:16px;min-width:0;align-content:start">
        <div class="card" aria-live="polite">
          <div class="card-head"><h2>Resultados</h2><span class="small muted">se calculan al medir</span></div>
          <div id="resultados"></div>
          <div id="avisos" style="display:grid;gap:8px"></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Fotos</h2><span class="small muted">se comprimen a 1600 px</span></div>
          <div class="fotos" id="fotos-box"></div>
          <input type="file" id="f-foto" accept="image/*" capture="environment" multiple hidden>
        </div>
      </div>
    </div>
    <div class="savebar">
      <button type="button" class="btn ghost" id="b-limpiar">Limpiar</button>
      <button type="button" class="btn primary" id="b-guardar">${a ? 'Guardar medición' : 'Guardar árbol'}</button>
    </div>
  </section>`;

  enlazarRegistrar();
  montarCintas();
  pintarResultados();
  pintarFotos();
  if (F.mostrarMapa) montarMiniMapa();
  if (F.foco) { const el = $('#' + F.foco); F.foco = null; el?.focus(); }
}

function montarCintas() {
  const previa = F.arbol_id ? ultimaMed(F.arbol_id) : null;
  $$('[data-cinta]').forEach((host) => {
    const k = host.dataset.cinta, c = MEDIDAS[k];
    const input = $('#m-' + k);
    cintas[k] = crearCinta(host, {
      min: 0, max: c.max, paso: 0.1, unidad: c.unidad, pxPorUnidad: c.ppu, etiqueta: c.etq,
      valor: F.med[k], inicial: Number(previa?.[k]) || c.inicial,
      alCambiar: (v) => { input.value = v.toFixed(1); fijarMedida(k, v); },
    });
    input.addEventListener('input', () => { const v = num(input.value); fijarMedida(k, v); cintas[k].set(v); });
  });
}

let resultadosPend = 0;
function fijarMedida(k, v) {
  F.med[k] = v;
  delete F.precargado[k];
  if (k === 'dap_cm') F.med.cap_cm = v ? +C.capDesdeDap(v).toFixed(1) : null;
  if (k === 'cap_cm') F.med.dap_cm = v ? +C.dapDesdeCap(v).toFixed(2) : null;
  cancelAnimationFrame(resultadosPend);
  resultadosPend = requestAnimationFrame(pintarResultados);
}

function resumenArbol(a) {
  const m = ultimaMed(a.id), e = especieDe(a), n = I.meds.get(a.id)?.length || 0;
  return `<div class="card" style="background:var(--surface-2);border:0;gap:8px">
    <div class="row"><span class="tag">${esc(a.codigo)}</span><b>${esc(e?.nombre_comun || 'Especie sin definir')}</b><i class="muted small">${esc(e?.nombre_cientifico || '')}</i></div>
    <div class="kv">
      <div><small>Última medición</small><b>${fechaLarga(m?.fecha)}</b></div>
      <div><small>DAP</small><b>${fmt(m?.dap_cm)} cm</b></div>
      <div><small>Altura total</small><b>${fmt(m?.altura_total_m)} m</b></div>
      <div><small>Mediciones</small><b>${n}</b></div>
    </div></div>`;
}

// ---- GPS ----
function htmlGPS() {
  const u = F.ubic;
  const a = F.arbol_id ? I.arb.get(F.arbol_id) : null;
  const objetivo = pref.get('gps_obj', 5), seg = pref.get('gps_seg', 30);
  const p = u?.precision;
  const escala = 20;
  const ancho = p ? Math.min(100, (p / escala) * 100) : 0;
  const color = !p ? 'var(--muted)' : p <= objetivo ? 'var(--ok)' : p <= objetivo * 2 ? 'var(--warn)' : 'var(--bad)';
  const utm = u ? C.aUTM(u.lat, u.lon) : null;
  const prog = gps.activo ? Math.min(100, ((Date.now() - gps.inicio) / (seg * 10))) : 0;
  const dist = a && u ? C.distanciaM(a, u) : null;
  return `
    <div class="card-head"><h2>${modo() === 'nuevo' ? 'Ubicación' : 'Verificar posición'}</h2>
      <span class="small muted">objetivo ≤ ${objetivo} m · ${seg} s de promedio</span></div>
    ${a ? `<p class="small muted">Posición registrada: <span class="mono">${a.lat.toFixed(6)}, ${a.lon.toFixed(6)}</span> (±${fmt(a.precision_m)} m). Capture aquí para comprobar que está en el árbol correcto.</p>` : ''}
    <div class="coords">
      <div class="big">${u ? `${u.lat.toFixed(6)}°, ${u.lon.toFixed(6)}°` : '—°, —°'}</div>
      <div class="mono muted">${utm ? `UTM ${utm.zona}${utm.hemisferio} · E ${fmt(utm.este, 1)} · N ${fmt(utm.norte, 1)}` : 'UTM —'}${u?.alt != null ? ` · ${fmt(u.alt, 0)} m s.n.m.` : ''}</div>
    </div>
    <div class="gauge">
      <div class="gauge-bar" role="img" aria-label="Precisión estimada ${p ? fmt(p) + ' metros' : 'sin dato'}"><b style="width:${ancho}%;background:${color}"></b><i style="left:${(objetivo / escala) * 100}%"></i></div>
      <div class="gauge-scale"><span>0 m</span><span>objetivo ${objetivo} m</span><span>${escala} m</span></div>
    </div>
    <div class="gps-stats">
      <div class="stat"><small>Precisión</small><b>${p ? '±' + fmt(p) : '—'}</b></div>
      <div class="stat"><small>Lecturas</small><b>${u?.n ?? (gps.activo ? gps.muestras.length : '—')}</b></div>
      <div class="stat"><small>${dist != null ? 'Al árbol' : 'Dispersión'}</small><b>${dist != null ? fmt(dist) + ' m' : u?.dispersion != null ? fmt(u.dispersion) + ' m' : '—'}</b></div>
    </div>
    ${gps.activo ? `<div class="gauge-bar" aria-label="Progreso de captura"><b style="width:${prog}%;background:var(--tape)"></b></div>` : ''}
    ${gps.error ? `<div class="alerta bad small">${esc(gps.error)}</div>` : ''}
    ${u?.metodo && u.metodo !== 'gps' ? `<p class="small muted">Posición ${u.metodo === 'mapa' ? 'ajustada en el mapa' : u.metodo === 'simulada' ? 'simulada (demostración)' : 'ingresada a mano'}.</p>` : ''}
    <div class="row">
      ${gps.activo
        ? `<button type="button" class="btn tape" id="b-gps-fin">Usar lectura (${gps.muestras.length})</button><button type="button" class="btn ghost" id="b-gps-cancel">Cancelar</button>`
        : `<button type="button" class="btn tape" id="b-gps">${u ? 'Volver a capturar' : 'Capturar posición GPS'}</button>`}
      ${modo() === 'nuevo' ? `<button type="button" class="btn ghost sm" id="b-mapa-aj">${F.mostrarMapa ? 'Ocultar mapa' : 'Ajustar en mapa'}</button>
      <button type="button" class="btn ghost sm" id="b-manual">Ingresar coordenadas</button>` : ''}
      ${gps.error && esDemo() && !P.NATIVA ? `<button type="button" class="btn ghost sm" id="b-simular">Simular lectura (demo)</button>` : ''}
    </div>
    ${a && u && u.metodo === 'gps' ? `<label class="check"><input type="checkbox" id="u-act" ${F.actualizarPos ? 'checked' : ''}> Reemplazar la posición registrada por esta lectura${a.precision_m != null && u.precision < a.precision_m ? ' (es más precisa)' : ''}</label>` : ''}
    ${F.mostrarManual ? `<div class="grid2">
      <label class="field"><span>Latitud</span><input id="u-lat" type="number" step="any" inputmode="decimal" value="${u?.lat ?? ''}" placeholder="-1.557000"></label>
      <label class="field"><span>Longitud</span><input id="u-lon" type="number" step="any" inputmode="decimal" value="${u?.lon ?? ''}" placeholder="-80.424000"></label>
    </div><button type="button" class="btn sm" id="b-manual-ok">Usar estas coordenadas</button>` : ''}
    ${F.mostrarMapa ? `<div class="minimap" id="minimap"></div><p class="small muted">Arrastre el marcador hasta el fuste del árbol.</p>` : ''}`;
}

function pintarGPS() {
  const box = $('#card-gps'); if (!box) return;
  box.innerHTML = htmlGPS();
  enlazarGPS();
  if (F.mostrarMapa) montarMiniMapa();
}

function enlazarGPS() {
  $('#b-gps')?.addEventListener('click', iniciarGPS);
  $('#b-gps-fin')?.addEventListener('click', () => detenerGPS(true));
  $('#b-gps-cancel')?.addEventListener('click', () => { detenerGPS(false); });
  $('#b-simular')?.addEventListener('click', simularGPS);
  $('#u-act')?.addEventListener('change', (e) => { F.actualizarPos = e.target.checked; });
  $('#b-mapa-aj')?.addEventListener('click', () => { F.mostrarMapa = !F.mostrarMapa; if (!F.mostrarMapa && miniMapa) { miniMapa.remove(); miniMapa = null; } pintarGPS(); });
  $('#b-manual')?.addEventListener('click', () => { F.mostrarManual = !F.mostrarManual; pintarGPS(); });
  $('#b-manual-ok')?.addEventListener('click', () => {
    const lat = num($('#u-lat').value), lon = num($('#u-lon').value);
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) { toast('Revise las coordenadas: latitud entre −90 y 90, longitud entre −180 y 180.'); return; }
    F.ubic = { lat, lon, alt: null, precision: null, n: 0, metodo: 'manual' };
    F.mostrarManual = false; pintarGPS();
  });
}

function iniciarGPS() {
  gps.error = null;
  if (!P.hayGPS()) { gps.error = 'Este equipo no ofrece geolocalización. Ingrese las coordenadas o ajústelas en el mapa.'; pintarGPS(); return; }
  if (miniMapa) { miniMapa.remove(); miniMapa = null; }
  F.mostrarMapa = false;
  gps.muestras = []; gps.inicio = Date.now(); gps.activo = true;
  const sesion = (gps.sesion = (gps.sesion || 0) + 1);
  const seg = pref.get('gps_seg', 30);
  P.observarPosicion((l) => {
    if (!gps.activo || sesion !== gps.sesion) return;
    gps.muestras.push(l);
    F.ubic = { ...C.promediarGPS(gps.muestras, pref.get('gps_obj', 5)), metodo: 'gps' };
  }, (err) => {
    if (sesion !== gps.sesion) return;
    // un error aislado no detiene la captura si ya hay lecturas buenas
    if (gps.muestras.length && err.tipo === 'tiempo') return;
    detenerGPS(false);
    gps.error = err.texto;
    pintarGPS();
  }).then((detener) => {
    if (gps.activo && sesion === gps.sesion) gps.watch = detener; else detener();
  });
  clearInterval(gps.timer);
  gps.timer = setInterval(() => {
    if (!gps.activo) return clearInterval(gps.timer);
    if (Date.now() - gps.inicio >= seg * 1000) detenerGPS(true); else pintarGPS();
  }, 500);
  pintarGPS();
}

function detenerGPS(usar) {
  if (typeof gps.watch === 'function') gps.watch();
  gps.watch = null; gps.activo = false; clearInterval(gps.timer);
  if (usar && gps.muestras.length) {
    F.ubic = { ...C.promediarGPS(gps.muestras, pref.get('gps_obj', 5)), metodo: 'gps' };
    toast(`Posición promediada con ${F.ubic.n} ${F.ubic.n === 1 ? 'lectura' : 'lecturas'} · ±${fmt(F.ubic.precision)} m`);
  } else if (usar) { gps.error = 'No llegó ninguna lectura. Salga a cielo abierto y vuelva a intentar.'; }
  pintarGPS();
}

function centroReferencia() {
  const lista = D.arboles.filter((a) => a.parcela_id === F.parcela_id || (!F.parcela_id && a.proyecto_id === F.proyecto_id));
  const src = lista.length ? lista : D.arboles;
  if (!src.length) return { lat: -1.8312, lon: -78.1834 };
  return { lat: src.reduce((s, a) => s + a.lat, 0) / src.length, lon: src.reduce((s, a) => s + a.lon, 0) / src.length };
}

function simularGPS() {
  const c = centroReferencia();
  const base = { lat: c.lat + (Math.random() - 0.5) * 0.0004, lon: c.lon + (Math.random() - 0.5) * 0.0004 };
  const t0 = Date.now();
  gps.muestras = Array.from({ length: 24 }, (_, i) => ({
    lat: base.lat + (Math.random() - 0.5) * 0.00005, lon: base.lon + (Math.random() - 0.5) * 0.00005,
    acc: 3 + Math.random() * 6, alt: 110 + Math.random() * 4, t: t0 + i * 1250,
  }));
  gps.error = null;
  F.ubic = { ...C.promediarGPS(gps.muestras, pref.get('gps_obj', 5)), metodo: 'simulada' };
  pintarGPS();
}

function montarMiniMapa() {
  const el = $('#minimap'); if (!el || !window.L) return;
  if (miniMapa) { miniMapa.remove(); miniMapa = null; }
  const c = F.ubic || centroReferencia();
  miniMapa = L.map(el, { zoomControl: true, attributionControl: true }).setView([c.lat, c.lon], 19);
  capasBase(miniMapa, null);
  for (const a of D.arboles.filter((x) => x.proyecto_id === F.proyecto_id)) {
    L.circleMarker([a.lat, a.lon], { radius: 4, color: '#fff', weight: 1, fillColor: '#56655b', fillOpacity: .9 }).bindTooltip(a.codigo).addTo(miniMapa);
  }
  const mk = L.marker([c.lat, c.lon], { draggable: true }).addTo(miniMapa);
  mk.on('dragend', () => {
    const p = mk.getLatLng();
    F.ubic = { lat: +p.lat.toFixed(7), lon: +p.lng.toFixed(7), alt: F.ubic?.alt ?? null, precision: null, n: 0, metodo: 'mapa' };
    const box = $('#card-gps .coords'); if (box) { const tmp = document.createElement('div'); tmp.innerHTML = htmlGPS(); box.replaceWith(tmp.querySelector('.coords')); }
  });
  setTimeout(() => miniMapa?.invalidateSize(), 50);
}

// ---- Formulario ----
let autoCarga = 0;
function enlazarRegistrar() {
  main.onclick = clicRegistrar;
  $('#f-proy')?.addEventListener('change', (e) => {
    if (!e.target.value) return;
    F.proyecto_id = e.target.value; pref.set('proyecto', F.proyecto_id);
    F.parcela_id = D.parcelas.find((p) => p.proyecto_id === F.proyecto_id)?.id || '';
    if (F.arbol_id) soltarArbol();
    F.codigoAuto = true; F.editar = null; vRegistrar();
  });
  $('#f-par')?.addEventListener('change', (e) => {
    F.parcela_id = e.target.value; pref.set('parcela', F.parcela_id);
    if (!F.arbol_id && F.codigoAuto) { F.codigo = siguienteCodigo(F.proyecto_id, F.parcela_id); $('#f-cod').value = F.codigo; $('#estado-cod').outerHTML = htmlEstadoCodigo(); }
    if (F.editar === 'par') { F.editar = null; vRegistrar(); }
    else $('[data-editar="par"]').disabled = !F.parcela_id;
  });
  $('#f-cod')?.addEventListener('input', (e) => {
    F.codigo = e.target.value.trim(); F.codigoAuto = false;
    clearTimeout(autoCarga);
    const encontrado = arbolPorCodigo(F.codigo);
    if (F.arbol_id && (!encontrado || encontrado.id !== F.arbol_id)) { soltarArbol(); F.foco = 'f-cod'; vRegistrar(); return; }
    $('#estado-cod').outerHTML = htmlEstadoCodigo();
    if (encontrado && encontrado.id !== F.arbol_id) {
      // elegido de la lista → carga inmediata; escrito a mano → carga al dejar de escribir
      const deLista = !e.inputType || e.inputType === 'insertReplacementText';
      autoCarga = setTimeout(() => { if (arbolPorCodigo(F.codigo)?.id === encontrado.id) { cargarArbol(encontrado); vRegistrar(); toast(`${encontrado.codigo}: se cargaron sus datos para una nueva medición.`); } }, deLista ? 0 : 700);
    }
  });
  $('#f-esp')?.addEventListener('input', (e) => {
    F.especieTxt = e.target.value;
    const esp = especieElegida();
    $('#esp-nueva-box').innerHTML = htmlEspNueva();
    $$('[data-esp]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.esp === esp?.id)));
    $('[data-editar="esp"]').disabled = !esp;
    pintarResultados();
  });
  $('#esp-nueva-box').addEventListener('input', (e) => {
    if (e.target.id === 'en-cie') F.espNueva.cient = e.target.value;
    if (e.target.id === 'en-den') { F.espNueva.dens = num(e.target.value) || 0.6; pintarResultados(); }
  });
  enlazarGPS();

  $$('[data-entrada]').forEach((b) => b.addEventListener('click', () => { F.entrada = b.dataset.entrada; pref.set('entrada', F.entrada); vRegistrar(); }));
  $('#m-fecha').addEventListener('change', (e) => { F.med.fecha = e.target.value; pintarResultados(); });
  $('#m-obs').addEventListener('input', (e) => { F.med.observaciones = e.target.value; });
  $('#m-tec').addEventListener('input', (e) => { F.med.tecnico = e.target.value; pref.set('tecnico', e.target.value); });
  $$('[data-chips]').forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    F.tocado = true;
    const k = g.dataset.chips; const v = k === 'vigor' ? Number(b.dataset.val) : b.dataset.val;
    if (g.dataset.multi) {
      const s = new Set(F.med[k]); s.has(v) ? s.delete(v) : s.add(v); F.med[k] = [...s];
      b.setAttribute('aria-pressed', String(s.has(v)));
    } else {
      F.med[k] = v; $$('.chip', g).forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    }
  }));
  $('#f-foto').addEventListener('change', agregarFotos);
  $('#b-limpiar').addEventListener('click', (e) => confirmar(e.currentTarget, '¿Borrar el formulario?', () => { F = borradorNuevo({ proyecto_id: F.proyecto_id, parcela_id: F.parcela_id }); vRegistrar(); }));
  $('#b-guardar').addEventListener('click', guardarRegistro);
}

async function clicRegistrar(e) {
  const r = e.target.closest('[data-remedir]');
  if (r) { cargarArbol(I.arb.get(r.dataset.remedir)); vRegistrar(); return; }
  const q = e.target.closest('[data-quitar-foto]');
  if (q) { const i = +q.dataset.quitarFoto; URL.revokeObjectURL(F.fotos[i].url); F.fotos.splice(i, 1); pintarFotos(); return; }
  if (e.target.closest('#foto-add')) { $('#f-foto').click(); return; }
  const ed = e.target.closest('[data-editar]');
  if (ed && !ed.disabled) { F.editar = F.editar === ed.dataset.editar ? null : ed.dataset.editar; vRegistrar(); return; }
  const ch = e.target.closest('[data-esp]');
  if (ch) {
    const esp = I.esp.get(ch.dataset.esp); F.especieTxt = etiquetaEsp(esp);
    $('#f-esp').value = F.especieTxt; $('#f-esp').dispatchEvent(new Event('input')); return;
  }
  const ac = e.target.closest('[data-accion]'); if (!ac) return;
  const accion = ac.dataset.accion;
  if (accion === 'cancelar') { F.editar = null; vRegistrar(); }
  else if (accion === 'otro') { soltarArbol(); F.codigoAuto = true; vRegistrar(); }
  else if (accion === 'siguiente') {
    if (F.arbol_id) soltarArbol();
    F.codigoAuto = true; vRegistrar();
  } else if (accion === 'cercanos') {
    const box = $('#cercanos');
    if (!F.ubic) { box.innerHTML = '<p class="alerta small">Primero capture su posición en la tarjeta Ubicación.</p>'; return; }
    const cerca = D.arboles.filter((x) => x.proyecto_id === F.proyecto_id)
      .map((x) => ({ x, d: C.distanciaM(F.ubic, x) })).sort((p, q2) => p.d - q2.d).slice(0, 5);
    box.innerHTML = cerca.length ? `<div class="tree-list">${cerca.map(({ x, d }) => `<button type="button" class="tree-row" data-remedir="${esc(x.id)}">
      <span class="tag">${esc(x.codigo)}</span><span class="sp"><b>${esc(especieDe(x)?.nombre_comun || '—')}</b></span><span class="meas">${fmt(d)} m</span></button>`).join('')}</div>` : '<p class="muted small">No hay árboles registrados en este proyecto.</p>';
  } else if (accion === 'guardar-proy') {
    const nombre = $('#pe-nombre').value.trim(), ff = num($('#pe-ff').value) || 0.5;
    if (!nombre) return toast('Escriba el nombre del proyecto.');
    if (D.proyectos.some((p) => p.nombre.toLowerCase() === nombre.toLowerCase() && (ac.dataset.nuevo || p.id !== F.proyecto_id))) return toast('Ya existe un proyecto con ese nombre.');
    if (ac.dataset.nuevo) {
      const p = await store.guardar('proyectos', { nombre, descripcion: null, factor_forma: ff });
      F.proyecto_id = p.id; F.parcela_id = ''; if (F.arbol_id) soltarArbol(); F.codigoAuto = true;
      pref.set('proyecto', p.id); toast('Proyecto creado.');
    } else {
      await store.guardar('proyectos', { ...I.proy.get(F.proyecto_id), nombre, factor_forma: ff }); toast('Proyecto actualizado.');
    }
    F.editar = null; await cargarDatos(); sync.programar(); vRegistrar();
  } else if (accion === 'guardar-par') {
    const codigo = $('#pa-cod').value.trim(), nombre = $('#pa-nom').value.trim() || null, area_m2 = num($('#pa-area').value);
    if (!codigo) return toast('Escriba el código de la parcela.');
    if (D.parcelas.some((p) => p.proyecto_id === F.proyecto_id && p.codigo.toLowerCase() === codigo.toLowerCase() && (ac.dataset.nuevo || p.id !== F.parcela_id))) return toast('Ya existe una parcela con ese código en este proyecto.');
    if (ac.dataset.nuevo) {
      const p = await store.guardar('parcelas', { proyecto_id: F.proyecto_id, codigo, nombre, area_m2, ...(I.proy.get(F.proyecto_id)?._demo ? { _demo: 1 } : {}) });
      F.parcela_id = p.id; pref.set('parcela', p.id); if (!F.arbol_id) F.codigoAuto = true; toast(`Parcela ${codigo} creada.`);
    } else {
      await store.guardar('parcelas', { ...I.par.get(F.parcela_id), codigo, nombre, area_m2 }); toast('Parcela actualizada.');
    }
    F.editar = null; await cargarDatos(); sync.programar(); vRegistrar();
  } else if (accion === 'guardar-esp') {
    const e0 = especieElegida(); if (!e0) return;
    const nombre_comun = $('#es-com').value.trim();
    if (!nombre_comun) return toast('Escriba el nombre común.');
    const act = await store.guardar('especies', { ...e0, nombre_comun, nombre_cientifico: $('#es-cie').value.trim() || null, familia: $('#es-fam').value.trim() || null, densidad_madera: num($('#es-den').value) || 0.6 });
    F.especieTxt = etiquetaEsp(act); F.editar = null; await cargarDatos(); sync.programar(); toast('Especie actualizada.'); vRegistrar();
  } else if (accion === 'guardar-cod') {
    const a = I.arb.get(F.arbol_id); const codigo = $('#co-cod').value.trim();
    if (!codigo) return toast('Escriba el código.');
    if (D.arboles.some((x) => x.id !== a.id && x.proyecto_id === a.proyecto_id && x.codigo.toLowerCase() === codigo.toLowerCase())) return toast('Ese código ya lo usa otro árbol del proyecto.');
    await store.guardar('arboles', { ...a, codigo }); F.codigo = codigo; F.editar = null;
    await cargarDatos(); sync.programar(); toast(`Código cambiado a ${codigo}.`); vRegistrar();
  }
}

function especieElegida() {
  const t = (F.especieTxt || '').trim().toLowerCase(); if (!t) return null;
  const [comun, cient] = t.split(' — ').map((x) => x.trim());
  return D.especies.find((e) => etiquetaEsp(e).toLowerCase() === t)
    || D.especies.find((e) => e.nombre_comun.toLowerCase() === comun && (!cient || (e.nombre_cientifico || '').toLowerCase() === cient))
    || D.especies.find((e) => (e.nombre_cientifico || '').toLowerCase() === t) || null;
}

function pintarResultados() {
  const box = $('#resultados'); if (!box) return;
  const arbol = F.arbol_id ? I.arb.get(F.arbol_id) : null;
  const esp = especieElegida() || (arbol && !F.especieTxt ? especieDe(arbol) : null);
  const dens = Number(esp?.densidad_madera) || (F.especieTxt ? F.espNueva.dens : 0) || 0.6;
  const d = C.derivados(F.med, { densidad: dens, ff: ffDe(F.proyecto_id) });
  const conv = $('#conv');
  if (conv) conv.textContent = F.entrada === 'dap'
    ? (F.med.dap_cm ? `CAP equivalente: ${fmt(F.med.cap_cm)} cm` : 'Mida a 1,30 m sobre el suelo, del lado de arriba si hay pendiente.')
    : (F.med.cap_cm ? `DAP equivalente: ${fmt(F.med.dap_cm, 2)} cm` : 'Mida la circunferencia a 1,30 m con cinta métrica.');
  const r = (t, v, u, dd = 2) => `<div class="result"><small>${t}</small><b>${fmt(v, dd)}<span>${u}</span></b></div>`;
  const ant = arbol ? ultimaMed(arbol.id) : null;
  const inc = ant && F.med.dap_cm ? C.ipa(ant, F.med) : null;
  box.innerHTML = `<div class="results">
    ${r('Área basal', d.ab, 'm²', 4)}
    ${r('Volumen total', d.vol, 'm³', 3)}
    ${r('Volumen comercial', d.volCom, 'm³', 3)}
    ${r('Área de copa', d.copa, 'm²', 1)}
    ${r('Biomasa aérea', d.agb, 'kg', 1)}
    ${r('CO₂ equivalente', d.co2, 'kg', 1)}
    ${inc != null ? r('Incremento DAP', inc, 'cm/año', 2) : ''}
  </div>
  <p class="small muted">Biomasa con Chave et al. (2014) y densidad de ${fmt(dens, 2)} g/cm³${esp ? ` (${esc(esp.nombre_comun)})` : ' por defecto'}; volumen con factor de forma ${fmt(ffDe(F.proyecto_id), 2)}; carbono = 47 % de la biomasa.</p>`;
  const avisos = C.controlCalidad(F.med, ant);
  $('#avisos').innerHTML = avisos.map((a) => `<div class="alerta small">${esc(a)}</div>`).join('');
}

// ---- Fotos ----
async function comprimir(file, max = 1600, q = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return await new Promise((res) => cv.toBlob(res, 'image/jpeg', q));
  } finally { URL.revokeObjectURL(url); }
}
async function agregarFotos(e) {
  for (const f of e.target.files) {
    try { const blob = await comprimir(f); F.fotos.push({ id: store.nuevoId(), blob, url: URL.createObjectURL(blob) }); }
    catch { toast('No se pudo leer una de las imágenes.'); }
  }
  e.target.value = ''; pintarFotos();
}
function pintarFotos() {
  const box = $('#fotos-box'); if (!box) return;
  box.innerHTML = F.fotos.map((f, i) => `<div class="foto-wrap"><img class="foto" src="${f.url}" alt="Foto ${i + 1}"><button type="button" data-quitar-foto="${i}" aria-label="Quitar foto ${i + 1}">×</button></div>`).join('') +
    `<button type="button" class="foto-add" id="foto-add">+ Foto<br>del árbol</button>`;
}

// ---- Guardar ----
async function guardarRegistro() {
  // si el código escrito ya existe, se trata como remedición de ese árbol
  if (!F.arbol_id) { const ex = arbolPorCodigo(F.codigo); if (ex) cargarArbol(ex); }
  const errores = [];
  if (!F.proyecto_id) errores.push('Cree o elija un proyecto.');
  if (!F.arbol_id) {
    if (!F.codigo) errores.push('Escriba el código de placa.');
    if (!F.ubic) errores.push('Capture la posición, ajústela en el mapa o ingrese las coordenadas.');
  }
  if (!(F.med.dap_cm > 0) && F.med.estado_sanitario !== 'muerto') errores.push('Registre el DAP o el CAP.');
  if (!F.med.fecha) errores.push('Indique la fecha de medición.');
  if (F.arbol_id && (I.meds.get(F.arbol_id) || []).some((m) => m.fecha === F.med.fecha)) errores.push('Este árbol ya tiene una medición con esa fecha.');
  if (errores.length) { toast(errores[0], 4500); if (F.arbol_id) vRegistrar(); return; }
  if (!(F.med.dap_cm > 0)) F.med.dap_cm = ultimaMed(F.arbol_id)?.dap_cm; // árbol muerto: se conserva el último DAP
  if (!(F.med.dap_cm > 0)) { toast('Registre el DAP o el CAP.'); return; }

  const btn = $('#b-guardar'); btn.disabled = true;
  try {
    // especie: del catálogo o nueva (queda guardada para los próximos registros)
    let esp = especieElegida();
    const txt = (F.especieTxt || '').trim();
    if (!esp && txt) {
      const [comun, cient] = txt.split(' — ');
      esp = await store.guardar('especies', { nombre_comun: comun.trim(), nombre_cientifico: (F.espNueva.cient || cient || '').trim() || null, familia: null, densidad_madera: F.espNueva.dens || 0.6 });
    }
    if (esp) pref.set('esp_recientes', [esp.id, ...pref.get('esp_recientes', []).filter((x) => x !== esp.id)].slice(0, 8));
    const demo = I.proy.get(F.proyecto_id)?._demo ? { _demo: 1 } : {};
    let arbol = F.arbol_id ? I.arb.get(F.arbol_id) : null;
    const u = F.ubic;
    const pos = u ? { lat: +u.lat.toFixed(7), lon: +u.lon.toFixed(7), altitud_m: u.alt != null ? +u.alt.toFixed(1) : null,
      precision_m: u.precision != null ? +u.precision.toFixed(2) : null, n_muestras_gps: u.n || null,
      metodo_ubicacion: u.metodo === 'simulada' ? 'manual' : u.metodo } : {};
    if (!arbol) {
      arbol = await store.guardar('arboles', { proyecto_id: F.proyecto_id, parcela_id: F.parcela_id || null, especie_id: esp?.id || null,
        codigo: F.codigo, ...pos, observaciones: null, ...demo });
    } else {
      // cambios hechos al árbol en Identificación (parcela, especie, posición)
      const cambios = {};
      if ((F.parcela_id || null) !== (arbol.parcela_id || null)) cambios.parcela_id = F.parcela_id || null;
      if (esp && esp.id !== arbol.especie_id) cambios.especie_id = esp.id;
      if (F.actualizarPos && u) Object.assign(cambios, pos);
      if (Object.keys(cambios).length) arbol = await store.guardar('arboles', { ...arbol, ...cambios });
    }
    const m = F.med;
    const med = await store.guardar('mediciones', {
      arbol_id: arbol.id, proyecto_id: arbol.proyecto_id, fecha: m.fecha,
      cap_cm: m.cap_cm, dap_cm: m.dap_cm, altura_total_m: m.altura_total_m, altura_comercial_m: m.altura_comercial_m,
      copa_ns_m: m.copa_ns_m, copa_eo_m: m.copa_eo_m, estado_sanitario: m.estado_sanitario, vigor: m.vigor,
      fenologia: m.fenologia, danos: m.danos, observaciones: m.observaciones || null, tecnico: m.tecnico || null,
      ...(arbol._demo ? { _demo: 1 } : {}),
    });
    for (const f of F.fotos) {
      await store.guardarBlob(f.id, f.blob);
      await store.guardar('fotos', {
        id: f.id, arbol_id: arbol.id, medicion_id: med.id, proyecto_id: arbol.proyecto_id,
        storage_path: `${arbol.proyecto_id}/${arbol.id}/${f.id}.jpg`, tipo: 'general',
        lat: arbol.lat, lon: arbol.lon, tomada_en: new Date().toISOString(), ...(arbol._demo ? { _demo: 1 } : {}),
      });
    }
    if (m.tecnico) pref.set('tecnicos', [m.tecnico, ...pref.get('tecnicos', []).filter((x) => x !== m.tecnico)].slice(0, 20));
    await cargarDatos();
    sync.programar(2000);
    toast(`${arbol.codigo} guardado en el equipo${sync.estado.configurado && !arbol._demo ? '. Se subirá a la nube al haber conexión.' : '.'}`);
    const siguiente = borradorNuevo({ proyecto_id: F.proyecto_id, parcela_id: F.parcela_id });
    F.fotos.forEach((f) => URL.revokeObjectURL(f.url));
    F = siguiente; vRegistrar();
  } catch (e) {
    console.error(e); toast('No se pudo guardar: ' + e.message, 5000); btn.disabled = false;
  }
}

// ---------------------------------------------------------------------
// VISTA: Mapa
// ---------------------------------------------------------------------
const COLOR_ESTADO = { bueno: '--ok', regular: '--warn', malo: '--bad', muerto: '--dead' };
const colorVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888';

function vMapa(op = {}) {
  const filtro = pref.get('mapa_proy', '');
  main.innerHTML = `<section class="view full" aria-label="Mapa de árboles"><div class="map-wrap">
    <div id="map"></div>
    <div class="map-tools">
      <select id="mp-proy" aria-label="Proyecto">${opciones(D.proyectos, filtro, (p) => p.nombre, 'Todos los proyectos')}</select>
      <button type="button" class="btn sm" id="mp-yo">Mi ubicación</button>
    </div>
    <div class="map-legend" aria-label="Leyenda">${ESTADOS.map(([v, t]) => `<span class="estado" data-e="${v}">${t}</span>`).join('')}<span class="small muted">Tamaño según DAP</span></div>
    <div class="map-note" id="mp-nota" hidden></div>
  </div></section>`;
  const arbs = D.arboles.filter((a) => !filtro || a.proyecto_id === filtro);
  mapa = L.map('map', { zoomControl: false, preferCanvas: true });
  L.control.zoom({ position: 'topright' }).addTo(mapa);
  capasBase(mapa, $('#mp-nota'));
  const capa = L.featureGroup().addTo(mapa);
  const marcas = new Map();
  for (const a of arbs) {
    const m = ultimaMed(a.id), e = especieDe(a);
    const est = m?.estado_sanitario || 'bueno';
    const radio = 4 + Math.sqrt(m?.dap_cm || 10) * 0.9;
    const mk = L.circleMarker([a.lat, a.lon], { radius: radio, color: '#ffffff', weight: 1.5, fillColor: colorVar(COLOR_ESTADO[est]), fillOpacity: 0.92 })
      .bindPopup(`<div class="row"><span class="tag">${esc(a.codigo)}</span><span class="estado" data-e="${est}">${esc(est)}</span></div>
        <b>${esc(e?.nombre_comun || 'Especie sin definir')}</b><i class="small muted">${esc(e?.nombre_cientifico || '')}</i>
        <span class="small num">DAP ${fmt(m?.dap_cm)} cm · Altura ${fmt(m?.altura_total_m)} m</span>
        <span class="small muted">${fechaLarga(m?.fecha)} · ±${fmt(a.precision_m)} m</span>
        <button type="button" class="btn sm primary" data-detalle="${esc(a.id)}">Ver historial</button>`)
      .addTo(capa);
    marcas.set(a.id, mk);
  }
  if (op.arbol_id && marcas.has(op.arbol_id)) {
    const a = I.arb.get(op.arbol_id); mapa.setView([a.lat, a.lon], 19); setTimeout(() => marcas.get(op.arbol_id).openPopup(), 200);
  } else if (arbs.length) mapa.fitBounds(capa.getBounds().pad(0.15), { maxZoom: 18 });
  else mapa.setView([-1.8312, -78.1834], 7);
  $('#map').addEventListener('click', (e) => { const b = e.target.closest('[data-detalle]'); if (b) abrirDetalle(b.dataset.detalle); });
  $('#mp-proy').addEventListener('change', (e) => { pref.set('mapa_proy', e.target.value); vMapa(); });
  let yo = null;
  $('#mp-yo').addEventListener('click', () => {
    if (!P.hayGPS()) return toast('Este equipo no ofrece geolocalización.');
    P.posicionActual().then((p) => {
      if (!mapa) return;
      const ll = [p.lat, p.lon];
      yo?.remove();
      yo = L.layerGroup([L.circle(ll, { radius: p.acc, color: colorVar('--accent'), weight: 1, fillOpacity: 0.12 }),
        L.circleMarker(ll, { radius: 7, color: '#fff', weight: 2, fillColor: colorVar('--accent'), fillOpacity: 1 })]).addTo(mapa);
      mapa.setView(ll, 18);
    }).catch((e) => toast(e.message, 5000));
  });
  setTimeout(() => mapa?.invalidateSize(), 60);
}

// ---------------------------------------------------------------------
// VISTA: Árboles (lista + detalle histórico)
// ---------------------------------------------------------------------
function vArboles() {
  const f = pref.get('filtros', { q: '', proy: '', par: '', est: '' });
  main.innerHTML = `<section class="view" aria-labelledby="t-arb">
    <div class="card-head"><div><p class="eyebrow">Monitoreo histórico</p><h1 id="t-arb">Árboles marcados</h1></div><span class="muted num" id="cuenta"></span></div>
    <div class="filters">
      <input id="fl-q" type="search" placeholder="Buscar código o especie" value="${esc(f.q)}" aria-label="Buscar">
      <select id="fl-proy" aria-label="Proyecto">${opciones(D.proyectos, f.proy, (p) => p.nombre, 'Todos los proyectos')}</select>
      <select id="fl-par" aria-label="Parcela">${opciones(D.parcelas.filter((p) => !f.proy || p.proyecto_id === f.proy), f.par, (p) => p.codigo + ' · ' + (p.nombre || ''), 'Todas las parcelas')}</select>
      <select id="fl-est" aria-label="Estado">${['', ...ESTADOS.map((e) => e[0])].map((v) => `<option value="${v}" ${v === f.est ? 'selected' : ''}>${v ? ESTADOS.find((e) => e[0] === v)[1] : 'Cualquier estado'}</option>`).join('')}</select>
    </div>
    <div id="lista"></div>
  </section>`;
  const pintar = () => {
    const q = f.q.trim().toLowerCase();
    const lista = D.arboles.filter((a) => {
      if (f.proy && a.proyecto_id !== f.proy) return false;
      if (f.par && a.parcela_id !== f.par) return false;
      const m = ultimaMed(a.id);
      if (f.est && m?.estado_sanitario !== f.est) return false;
      if (q) { const e = especieDe(a); return [a.codigo, e?.nombre_comun, e?.nombre_cientifico].some((s) => (s || '').toLowerCase().includes(q)); }
      return true;
    });
    $('#cuenta').textContent = `${lista.length} de ${D.arboles.length}`;
    $('#lista').innerHTML = lista.length ? `<div class="tree-list">${lista.slice(0, 400).map((a) => {
      const m = ultimaMed(a.id), e = especieDe(a), n = I.meds.get(a.id)?.length || 0, par = I.par.get(a.parcela_id);
      const pend = a._pend || (I.meds.get(a.id) || []).some((x) => x._pend);
      return `<button type="button" class="tree-row" data-detalle="${esc(a.id)}">
        <span class="tag">${esc(a.codigo)}</span>
        <span class="sp"><b>${esc(e?.nombre_comun || 'Especie sin definir')} ${pend && sync.estado.configurado && !a._demo ? '<span class="pend-dot" title="Pendiente de subir"></span>' : ''}</b>
          <i>${esc(e?.nombre_cientifico || '')}${par ? ' · ' + esc(par.codigo) : ''} · <span class="estado" data-e="${m?.estado_sanitario || ''}">${esc(m?.estado_sanitario || 'sin medir')}</span></i></span>
        <span class="meas">${fmt(m?.dap_cm)} cm · ${fmt(m?.altura_total_m)} m<small>${n} ${n === 1 ? 'medición' : 'mediciones'} · ${fechaLarga(m?.fecha)}</small></span>
      </button>`;
    }).join('')}</div>${lista.length > 400 ? '<p class="small muted">Se muestran los primeros 400. Afine la búsqueda.</p>' : ''}`
      : `<div class="empty"><b>No hay árboles con esos filtros.</b><span>Registre uno en la pestaña Registrar o cambie los filtros.</span></div>`;
  };
  const guardarF = () => pref.set('filtros', f);
  $('#fl-q').addEventListener('input', (e) => { f.q = e.target.value; guardarF(); pintar(); });
  $('#fl-proy').addEventListener('change', (e) => { f.proy = e.target.value; f.par = ''; guardarF(); vArboles(); });
  $('#fl-par').addEventListener('change', (e) => { f.par = e.target.value; guardarF(); pintar(); });
  $('#fl-est').addEventListener('change', (e) => { f.est = e.target.value; guardarF(); pintar(); });
  $('#lista').addEventListener('click', (e) => { const b = e.target.closest('[data-detalle]'); if (b) abrirDetalle(b.dataset.detalle); });
  pintar();
}

// Gráfico de línea simple (una serie) con puntos y etiquetas en los extremos
function graficoLinea(puntos, { unidad = '', dec = 1, alto = 150 } = {}) {
  if (puntos.length < 1) return '<p class="small muted">Sin datos.</p>';
  const W = innerWidth < 640 ? 340 : 480, H = alto, pl = 44, pr = 16, pt = 14, pb = 26;
  const xs = puntos.map((p) => new Date(p.f + 'T12:00:00').getTime());
  const ys = puntos.map((p) => p.v);
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x0 === x1) { x0 -= 180 * 864e5; x1 += 180 * 864e5; }
  let y0 = Math.min(...ys), y1 = Math.max(...ys); const pad = (y1 - y0) * 0.2 || Math.max(1, y1 * 0.1); y0 = Math.max(0, y0 - pad); y1 += pad;
  const X = (t) => pl + ((t - x0) / (x1 - x0)) * (W - pl - pr);
  const Y = (v) => pt + (1 - (v - y0) / (y1 - y0)) * (H - pt - pb);
  const ticks = [y0, (y0 + y1) / 2, y1];
  const path = puntos.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const area = `${path}L${X(xs[xs.length - 1]).toFixed(1)},${H - pb}L${X(xs[0]).toFixed(1)},${H - pb}Z`;
  const anios = [...new Map(puntos.map((p, i) => [p.f.slice(0, 4), xs[i]])).entries()];
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Serie de ${puntos.length} mediciones">
    ${ticks.map((t) => `<line class="axis" x1="${pl}" x2="${W - pr}" y1="${Y(t)}" y2="${Y(t)}" stroke-dasharray="${t === y0 ? '' : '2 4'}"/><text x="${pl - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t, dec)}</text>`).join('')}
    ${anios.map(([a, t]) => `<text x="${X(t)}" y="${H - 8}" text-anchor="middle">${a}</text>`).join('')}
    <path d="${area}" fill="var(--accent)" opacity=".10"/>
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
    ${puntos.map((p, i) => `<circle cx="${X(xs[i])}" cy="${Y(p.v)}" r="${i === puntos.length - 1 ? 5 : 4}" fill="${i === puntos.length - 1 ? 'var(--accent)' : 'var(--surface)'}" stroke="var(--accent)" stroke-width="2"><title>${fechaLarga(p.f)}: ${fmt(p.v, dec)} ${unidad}</title></circle>`).join('')}
    <text class="lbl" x="${Math.min(X(xs[xs.length - 1]), W - pr - 4)}" y="${Y(ys[ys.length - 1]) - 10}" text-anchor="end">${fmt(ys[ys.length - 1], dec)} ${unidad}</text>
  </svg></div>`;
}

async function abrirDetalle(id) {
  const a = I.arb.get(id); if (!a) return;
  if (mapa) mapa.closePopup();
  const e = especieDe(a), meds = I.meds.get(id) || [], par = I.par.get(a.parcela_id), proy = I.proy.get(a.proyecto_id);
  const utm = C.aUTM(a.lat, a.lon), ult = meds[meds.length - 1];
  const opt = { densidad: densDe(a), ff: ffDe(a.proyecto_id) };
  const incs = meds.map((m, i) => (i ? C.ipa(meds[i - 1], m) : null));
  const valid = incs.filter((x) => x != null);
  const ipaMedio = valid.length ? valid.reduce((s, x) => s + x, 0) / valid.length : null;
  const back = document.createElement('div');
  back.className = 'sheet-back';
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="det-t">
    <div class="sheet-head">
      <div style="display:grid;gap:6px;min-width:0"><div class="row"><span class="tag">${esc(a.codigo)}</span><span class="estado" data-e="${ult?.estado_sanitario || ''}">${esc(ult?.estado_sanitario || 'sin medir')}</span></div>
        <h2 id="det-t">${esc(e?.nombre_comun || 'Especie sin definir')} <i class="muted" style="font:italic 400 15px var(--f-body)">${esc(e?.nombre_cientifico || '')}</i></h2>
        <p class="small muted">${esc(proy?.nombre || '')}${par ? ' · Parcela ' + esc(par.codigo) : ''}</p></div>
      <button type="button" class="close" aria-label="Cerrar">×</button>
    </div>
    <div class="kv">
      <div><small>Coordenadas</small><b class="mono">${a.lat.toFixed(6)}, ${a.lon.toFixed(6)}</b></div>
      <div><small>UTM ${utm.zona}${utm.hemisferio}</small><b class="mono">${fmt(utm.este, 0)} E · ${fmt(utm.norte, 0)} N</b></div>
      <div><small>Precisión GPS</small><b>${a.precision_m != null ? '±' + fmt(a.precision_m) + ' m' : a.metodo_ubicacion === 'mapa' ? 'Ubicado en mapa' : '—'}${a.n_muestras_gps ? ` <span class="muted small">(${a.n_muestras_gps} lect.)</span>` : ''}</b></div>
      <div><small>Altitud</small><b>${a.altitud_m != null ? fmt(a.altitud_m, 0) + ' m' : '—'}</b></div>
      <div><small>Incremento DAP medio</small><b>${ipaMedio != null ? fmt(ipaMedio, 2) + ' cm/año' : '—'}</b></div>
      <div><small>CO₂e actual</small><b>${ult ? fmt(C.derivados(ult, opt).co2, 0) + ' kg' : '—'}</b></div>
    </div>
    <div class="charts2">
      <div class="card"><h3>DAP (cm)</h3>${graficoLinea(meds.map((m) => ({ f: m.fecha, v: Number(m.dap_cm) })), { unidad: 'cm' })}</div>
      <div class="card"><h3>Altura total (m)</h3>${graficoLinea(meds.filter((m) => m.altura_total_m).map((m) => ({ f: m.fecha, v: Number(m.altura_total_m) })), { unidad: 'm' })}</div>
    </div>
    <h3>Historial de mediciones</h3>
    <div class="tablewrap"><table>
      <thead><tr><th>Fecha</th><th>DAP cm</th><th>Alt. m</th><th>Alt. com. m</th><th>AB m²</th><th>Vol. m³</th><th>CO₂e kg</th><th>IPA cm/año</th><th>Estado</th><th></th></tr></thead>
      <tbody>${meds.slice().reverse().map((m) => {
        const i = meds.indexOf(m), d = C.derivados(m, opt);
        return `<tr><td>${fechaLarga(m.fecha)}</td><td>${fmt(m.dap_cm)}</td><td>${fmt(m.altura_total_m)}</td><td>${fmt(m.altura_comercial_m)}</td>
          <td>${fmt(d.ab, 4)}</td><td>${fmt(d.vol, 3)}</td><td>${fmt(d.co2, 0)}</td><td>${incs[i] != null ? fmt(incs[i], 2) : '—'}</td>
          <td style="text-align:left"><span class="estado" data-e="${m.estado_sanitario}">${esc(m.estado_sanitario)}</span></td>
          <td><button type="button" class="linkbtn small" data-borrar-med="${esc(m.id)}" style="color:var(--bad)">Borrar</button></td></tr>`;
      }).join('')}</tbody></table></div>
    ${meds.some((m) => m.observaciones) ? `<div style="display:grid;gap:4px">${meds.filter((m) => m.observaciones).map((m) => `<p class="small"><b>${fechaLarga(m.fecha)}:</b> ${esc(m.observaciones)}</p>`).join('')}</div>` : ''}
    <div id="det-fotos" class="fotos"></div>
    <div class="row">
      <button type="button" class="btn primary" id="det-remedir">Nueva medición</button>
      <button type="button" class="btn" id="det-mapa">Ver en el mapa</button>
      <div class="spacer"></div>
      <button type="button" class="btn ghost danger" id="det-borrar">Eliminar árbol</button>
    </div>
  </div>`;
  const cerrar = () => { back.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = (ev) => { if (ev.key === 'Escape') cerrar(); };
  document.addEventListener('keydown', esc_);
  back.addEventListener('click', async (ev) => {
    if (ev.target === back || ev.target.closest('.close')) return cerrar();
    const bm = ev.target.closest('[data-borrar-med]');
    if (bm) confirmar(bm, '¿Seguro?', async () => { await store.borrar('mediciones', bm.dataset.borrarMed); await cargarDatos(); sync.programar(); cerrar(); abrirDetalle(id); refrescarVista(); });
  });
  document.body.appendChild(back);
  $('.close', back).focus();
  $('#det-remedir', back).addEventListener('click', () => { cerrar(); ir('registrar', { arbol_id: id }); });
  $('#det-mapa', back).addEventListener('click', () => { cerrar(); ir('mapa', { arbol_id: id }); });
  $('#det-borrar', back).addEventListener('click', (ev) => confirmar(ev.currentTarget, 'Toque otra vez para eliminar', async () => {
    await store.borrar('arboles', id);
    for (const m of meds) await store.borrar('mediciones', m.id);
    await cargarDatos(); sync.programar(); cerrar(); refrescarVista(); toast(`Árbol ${a.codigo} eliminado.`);
  }));
  const fotos = I.fotos.get(id) || [];
  if (fotos.length) {
    const box = $('#det-fotos', back);
    for (const f of fotos) {
      const url = await sync.urlFoto(f).catch(() => null);
      box.insertAdjacentHTML('beforeend', url ? `<a href="${url}" target="_blank" rel="noopener"><img class="foto" src="${url}" alt="Foto del árbol ${esc(a.codigo)}"></a>` : `<div class="foto" title="Foto disponible con conexión"></div>`);
    }
  }
}

// ---------------------------------------------------------------------
// VISTA: Panel (indicadores del rodal / proyecto)
// ---------------------------------------------------------------------
function resumen(proyId) {
  const arbs = D.arboles.filter((a) => !proyId || a.proyecto_id === proyId);
  const vivos = [], muertos = [];
  for (const a of arbs) { const m = ultimaMed(a.id); if (!m) continue; (m.estado_sanitario === 'muerto' ? muertos : vivos).push({ a, m }); }
  let ab = 0, vol = 0, co2 = 0, c = 0;
  for (const { a, m } of vivos) {
    const d = C.derivados(m, { densidad: densDe(a), ff: ffDe(a.proyecto_id) });
    ab += d.ab || 0; vol += d.vol || 0; co2 += d.co2 || 0; c += d.c || 0;
  }
  // valores por hectárea: solo árboles dentro de parcelas con área conocida
  const conArea = (a) => Number(I.par.get(a.parcela_id)?.area_m2) > 0;
  const parIds = new Set(arbs.filter(conArea).map((a) => a.parcela_id));
  const areaHa = parIds.size ? [...parIds].reduce((s, i) => s + Number(I.par.get(i).area_m2), 0) / 10000 : null;
  const ha = { ab: 0, vol: 0, co2: 0, n: 0 };
  for (const { a, m } of vivos) if (conArea(a)) {
    const d = C.derivados(m, { densidad: densDe(a), ff: ffDe(a.proyecto_id) });
    ha.ab += d.ab || 0; ha.vol += d.vol || 0; ha.co2 += d.co2 || 0; ha.n++;
  }
  const meds = D.mediciones.filter((m) => !proyId || m.proyecto_id === proyId);
  const incs = [];
  for (const a of arbs) { const l = I.meds.get(a.id) || []; for (let i = 1; i < l.length; i++) { const v = C.ipa(l[i - 1], l[i]); if (v != null) incs.push({ a, v }); } }
  return { arbs, vivos, muertos, ab, vol, co2, c, areaHa, ha, meds, incs };
}

function barras(datos, { unidad = '', dec = 0, alto = 180, etiquetaX = '' } = {}) {
  if (!datos.length) return '<p class="small muted">Sin datos.</p>';
  const W = innerWidth < 640 ? 360 : 560, H = alto, pl = 40, pr = 10, pt = 18, pb = 40;
  const max = Math.max(...datos.map((d) => d.v)) || 1;
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= max) return k * p; return max; })();
  const bw = (W - pl - pr) / datos.length;
  const Y = (v) => pt + (1 - v / nice) * (H - pt - pb);
  const ticks = [0, nice / 2, nice];
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(etiquetaX)}">
    ${ticks.map((t) => `<line class="axis" x1="${pl}" x2="${W - pr}" y1="${Y(t)}" y2="${Y(t)}" stroke-dasharray="${t ? '2 4' : ''}"/><text x="${pl - 6}" y="${Y(t) + 4}" text-anchor="end">${fmt(t, Number.isInteger(t) ? 0 : Number.isInteger(t * 10) ? 1 : 2)}</text>`).join('')}
    ${datos.map((d, i) => {
      const x = pl + i * bw + 2, w = Math.max(2, bw - 4), y = Y(d.v), h = H - pb - y;
      const r = Math.min(4, w / 2, h);
      const p = h > 0 ? `M${x},${H - pb}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${H - pb}Z` : '';
      return `<g><path d="${p}" fill="var(--accent)"/><rect x="${pl + i * bw}" y="${pt}" width="${bw}" height="${H - pt - pb}" fill="transparent"><title>${esc(d.t)}: ${fmt(d.v, dec)} ${unidad}</title></rect>
        ${d.v > 0 ? `<text class="lbl" x="${x + w / 2}" y="${y - 5}" text-anchor="middle">${fmt(d.v, dec)}</text>` : ''}
        <text x="${x + w / 2}" y="${H - pb + 15}" text-anchor="middle">${esc(d.t)}</text></g>`;
    }).join('')}
    <text x="${(W + pl) / 2}" y="${H - 4}" text-anchor="middle">${esc(etiquetaX)}</text>
  </svg></div>`;
}

function vPanel() {
  const proyId = pref.get('panel_proy', '');
  const R = resumen(proyId);
  const porHa = (k) => (R.areaHa ? R.ha[k] / R.areaHa : null);
  // distribución diamétrica
  const clases = new Map();
  for (const { m } of R.vivos) { const k = C.claseDiametrica(m.dap_cm); clases.set(k, (clases.get(k) || 0) + 1); }
  const maxK = Math.max(0, ...clases.keys());
  const dist = []; for (let k = 0; k <= maxK; k += 10) dist.push({ t: `${k}–${k + 10}`, v: clases.get(k) || 0 });
  // estados
  const est = Object.fromEntries(ESTADOS.map(([v]) => [v, 0]));
  for (const a of R.arbs) { const m = ultimaMed(a.id); if (m) est[m.estado_sanitario]++; }
  const totEst = Object.values(est).reduce((s, x) => s + x, 0) || 1;
  // campañas (por año)
  const camp = new Map();
  for (const m of R.meds) { const y = m.fecha.slice(0, 4); const c = camp.get(y) || { n: 0, ab: 0, dap: 0 }; c.n++; c.ab += C.areaBasal(m.dap_cm) || 0; c.dap += Number(m.dap_cm); camp.set(y, c); }
  const anios = [...camp.keys()].sort();
  // por especie
  const pe = new Map();
  for (const { a, m } of R.vivos) {
    const e = especieDe(a); const k = e?.id || '_';
    const r = pe.get(k) || { nombre: e?.nombre_comun || 'Sin especie', cient: e?.nombre_cientifico || '', n: 0, dap: 0, h: 0, nh: 0, co2: 0, inc: [] };
    r.n++; r.dap += Number(m.dap_cm); if (m.altura_total_m) { r.h += Number(m.altura_total_m); r.nh++; }
    r.co2 += C.derivados(m, { densidad: densDe(a), ff: ffDe(a.proyecto_id) }).co2 || 0; pe.set(k, r);
  }
  for (const { a, v } of R.incs) { const r = pe.get(especieDe(a)?.id || '_'); if (r) r.inc.push(v); }
  const especies = [...pe.values()].sort((p, q) => q.n - p.n);
  const ipaTot = R.incs.length ? R.incs.reduce((s, x) => s + x.v, 0) / R.incs.length : null;
  const ultFecha = R.meds.reduce((mx, m) => (m.fecha > mx ? m.fecha : mx), '');

  main.innerHTML = `<section class="view" aria-labelledby="t-pan">
    <div class="card-head"><div><p class="eyebrow">Plataforma de monitoreo</p><h1 id="t-pan">Panel del inventario</h1></div>
      <select id="pn-proy" style="width:auto;max-width:100%" aria-label="Proyecto">${opciones(D.proyectos, proyId, (p) => p.nombre, 'Todos los proyectos')}</select></div>
    <div class="kpis">
      <div class="kpi"><small>Árboles vivos</small><b class="num">${R.vivos.length}</b><p>${R.muertos.length} muertos · ${R.arbs.length} marcados</p></div>
      <div class="kpi"><small>Mediciones</small><b class="num">${R.meds.length}</b><p>Última: ${fechaLarga(ultFecha || null)}</p></div>
      <div class="kpi"><small>Área basal</small><b>${fmt(R.areaHa ? porHa('ab') : R.ab, 2)}<span>${R.areaHa ? 'm²/ha' : 'm²'}</span></b><p>${R.areaHa ? `${fmt(R.areaHa, 2)} ha medidas · total ${fmt(R.ab, 2)} m²` : 'Asigne área a las parcelas para ver valores por hectárea'}</p></div>
      <div class="kpi"><small>Volumen</small><b>${fmt(R.areaHa ? porHa('vol') : R.vol, 1)}<span>${R.areaHa ? 'm³/ha' : 'm³'}</span></b><p>Total ${fmt(R.vol, 1)} m³</p></div>
      <div class="kpi"><small>CO₂ equivalente</small><b>${fmt(R.co2 / 1000, 1)}<span>t</span></b><p>${fmt(R.c / 1000, 1)} t de carbono${R.areaHa ? ` · ${fmt(porHa('co2') / 1000, 1)} t/ha` : ''}</p></div>
      <div class="kpi"><small>Crecimiento DAP</small><b>${fmt(ipaTot, 2)}<span>cm/año</span></b><p>Promedio de ${R.incs.length} intervalos</p></div>
    </div>

    <div class="charts2">
      <div class="card"><div class="card-head"><h3>Distribución diamétrica</h3><span class="small muted">árboles vivos por clase de DAP</span></div>
        ${barras(dist, { unidad: 'árboles', etiquetaX: 'Clase diamétrica (cm)' })}</div>
      <div class="card"><div class="card-head"><h3>Área basal por campaña</h3><span class="small muted">suma de las mediciones de cada año</span></div>
        ${barras(anios.map((y) => ({ t: y, v: camp.get(y).ab })), { unidad: 'm²', dec: 2, etiquetaX: 'Año de medición' })}</div>
    </div>

    <div class="card"><div class="card-head"><h3>Estado sanitario actual</h3><span class="small muted">según la última medición de cada árbol</span></div>
      <svg viewBox="0 0 560 22" width="100%" height="22" preserveAspectRatio="none" role="img" aria-label="Proporción por estado sanitario" style="display:block">
        ${(() => { let x = 0; return ESTADOS.map(([v, t]) => { const w = (est[v] / totEst) * 560; const s = w > 0 ? `<rect x="${x}" y="0" width="${Math.max(0, w - 2)}" height="22" rx="3" fill="var(${COLOR_ESTADO[v]})"><title>${t}: ${est[v]}</title></rect>` : ''; x += w; return s; }).join(''); })()}
      </svg>
      <div class="legend">${ESTADOS.map(([v, t]) => `<span><i style="--c:var(${COLOR_ESTADO[v]})"></i>${t} <b class="num">${est[v]}</b> (${fmt((est[v] / totEst) * 100, 0)} %)</span>`).join('')}</div>
    </div>

    <div class="card"><div class="card-head"><h3>Resumen por especie</h3><span class="small muted">árboles vivos</span></div>
      <div class="tablewrap"><table><thead><tr><th>Especie</th><th>Árboles</th><th>DAP medio cm</th><th>Altura media m</th><th>IPA DAP cm/año</th><th>CO₂e t</th></tr></thead>
      <tbody>${especies.map((r) => `<tr><td><b>${esc(r.nombre)}</b> <i class="muted small">${esc(r.cient)}</i></td><td>${r.n}</td><td>${fmt(r.dap / r.n)}</td><td>${fmt(r.nh ? r.h / r.nh : null)}</td>
        <td>${fmt(r.inc.length ? r.inc.reduce((s, x) => s + x, 0) / r.inc.length : null, 2)}</td><td>${fmt(r.co2 / 1000, 2)}</td></tr>`).join('') || '<tr><td colspan="6">Sin datos.</td></tr>'}</tbody></table></div>
    </div>

    <div class="card"><div class="card-head"><h3>Exportar datos</h3><span class="small muted">para Excel, QGIS o ArcGIS</span></div>
      <div class="row">
        <button type="button" class="btn" data-exp="csv">${P.NATIVA ? 'Exportar' : 'Descargar'} mediciones (CSV)</button>
        <button type="button" class="btn" data-exp="geojson">${P.NATIVA ? 'Exportar' : 'Descargar'} árboles (GeoJSON)</button>
        <button type="button" class="btn ghost sm" data-copiar="csv">Copiar CSV</button>
        <button type="button" class="btn ghost sm" data-copiar="geojson">Copiar GeoJSON</button>
      </div>
      <p class="small muted">Coordenadas en WGS84 (EPSG:4326). El CSV usa punto y coma, como lo espera Excel en español.</p>
    </div>
  </section>`;
  $('#pn-proy').addEventListener('change', (e) => { pref.set('panel_proy', e.target.value); vPanel(); });
  $$('[data-exp]').forEach((b) => b.addEventListener('click', () => exportar(b.dataset.exp, proyId, false)));
  $$('[data-copiar]').forEach((b) => b.addEventListener('click', () => exportar(b.dataset.copiar, proyId, true)));
}

function textoCSV(proyId) {
  const cols = ['proyecto', 'parcela', 'codigo', 'especie', 'nombre_cientifico', 'lat', 'lon', 'precision_m', 'fecha', 'dap_cm', 'cap_cm', 'altura_total_m', 'altura_comercial_m', 'copa_ns_m', 'copa_eo_m', 'estado_sanitario', 'vigor', 'fenologia', 'danos', 'area_basal_m2', 'volumen_m3', 'biomasa_kg', 'co2e_kg', 'tecnico', 'observaciones'];
  const q = (v) => { if (v == null) return ''; const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const filas = [cols.join(';')];
  for (const a of D.arboles.filter((x) => !proyId || x.proyecto_id === proyId)) {
    const e = especieDe(a);
    for (const m of I.meds.get(a.id) || []) {
      const d = C.derivados(m, { densidad: densDe(a), ff: ffDe(a.proyecto_id) });
      const r = [I.proy.get(a.proyecto_id)?.nombre, I.par.get(a.parcela_id)?.codigo, a.codigo, e?.nombre_comun, e?.nombre_cientifico, a.lat, a.lon, a.precision_m,
        m.fecha, m.dap_cm, m.cap_cm, m.altura_total_m, m.altura_comercial_m, m.copa_ns_m, m.copa_eo_m, m.estado_sanitario, m.vigor, m.fenologia, (m.danos || []).join(', '),
        d.ab && +d.ab.toFixed(5), d.vol && +d.vol.toFixed(4), d.agb && +d.agb.toFixed(1), d.co2 && +d.co2.toFixed(1), m.tecnico, m.observaciones];
      filas.push(r.map(q).join(';'));
    }
  }
  return '﻿' + filas.join('\r\n');
}
function textoGeoJSON(proyId) {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: D.arboles.filter((x) => !proyId || x.proyecto_id === proyId).map((a) => {
      const m = ultimaMed(a.id), e = especieDe(a);
      return { type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
        properties: { id: a.id, codigo: a.codigo, proyecto: I.proy.get(a.proyecto_id)?.nombre, parcela: I.par.get(a.parcela_id)?.codigo ?? null,
          especie: e?.nombre_comun ?? null, nombre_cientifico: e?.nombre_cientifico ?? null, precision_m: a.precision_m,
          ultima_fecha: m?.fecha ?? null, dap_cm: m?.dap_cm ?? null, altura_total_m: m?.altura_total_m ?? null,
          estado_sanitario: m?.estado_sanitario ?? null, n_mediciones: I.meds.get(a.id)?.length || 0 } };
    }),
  }, null, 1);
}
async function exportar(tipo, proyId, copiar) {
  const txt = tipo === 'csv' ? textoCSV(proyId) : textoGeoJSON(proyId);
  if (copiar) {
    try { await navigator.clipboard.writeText(txt.replace(/^﻿/, '')); toast('Copiado. Péguelo en una hoja de cálculo o un archivo de texto.'); }
    catch { toast('El navegador no permitió copiar. Use el botón Descargar.'); }
    return;
  }
  const nombre = `dendrogeo_${tipo === 'csv' ? 'mediciones' : 'arboles'}_${hoy()}.${tipo === 'csv' ? 'csv' : 'geojson'}`;
  try {
    const r = await P.entregarArchivo(nombre, txt, tipo === 'csv' ? 'text/csv;charset=utf-8' : 'application/geo+json');
    if (r === 'descargado') toast('Descarga iniciada. Si no aparece, use “Copiar”.');
  } catch (e) {
    if (!/cancel/i.test(e.message || '')) toast('No se pudo exportar: ' + e.message, 5000);
  }
}

// ---------------------------------------------------------------------
// VISTA: Ajustes (nube, cuenta, proyectos, parcelas, especies, GPS)
// ---------------------------------------------------------------------
function htmlEstadoSync() {
  const e = sync.estado;
  if (!e.configurado) return `<p class="small">Los datos se guardan solo en este equipo. Conecte la nube para respaldarlos y compartirlos con su equipo.</p>`;
  return `<div class="kv">
    <div><small>Cuenta</small><b>${esc(e.usuario || 'Sin iniciar sesión')}</b></div>
    <div><small>Conexión</small><b>${e.online ? 'En línea' : 'Sin conexión'}</b></div>
    <div><small>Por subir</small><b class="num">${e.pendientes}</b></div>
    <div><small>Última sincronización</small><b>${e.ultima ? new Date(e.ultima).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }) : 'Nunca'}</b></div>
  </div>${e.error ? `<div class="alerta bad small">${esc(e.error)}</div>` : ''}`;
}

function vAjustes() {
  const cfg = sync.configActual();
  const e = sync.estado;
  const hayDemo = D.proyectos.some((p) => p._demo);
  main.innerHTML = `<section class="view" aria-labelledby="t-aj">
    <div><p class="eyebrow">Configuración</p><h1 id="t-aj">Ajustes</h1></div>

    <div class="card">
      <div class="card-head"><h2>Apariencia</h2><span class="small muted">se guarda en este equipo</span></div>
      <div class="tema-opciones" role="group" aria-label="Fondo de la aplicación">
        <button type="button" class="tema-op" data-tema="claro" aria-pressed="${T.temaActual() === 'claro'}">
          <span class="tema-muestra" style="background:#eff2ec"><i style="background:#ffffff;border-bottom:1px solid #d0d8cc"></i><i style="margin:8px;border-radius:4px;background:#e2b336"></i></span>Fondo claro</button>
        <button type="button" class="tema-op" data-tema="oscuro" aria-pressed="${T.temaActual() === 'oscuro'}">
          <span class="tema-muestra" style="background:#0d1310"><i style="background:#141c17;border-bottom:1px solid #29352e"></i><i style="margin:8px;border-radius:4px;background:#e6bd4c"></i></span>Fondo oscuro</button>
      </div>
      <p class="small muted">El fondo claro se lee mejor a pleno sol en el campo; el oscuro descansa la vista y ahorra batería en pantallas OLED. También puede cambiarlo con el botón de la barra superior.</p>
    </div>

    <div class="card">
      <div class="card-head"><h2>Nube y sincronización</h2>${e.configurado && e.usuario ? '<button type="button" class="btn sm primary" id="aj-sync">Sincronizar ahora</button>' : ''}</div>
      <div id="estado-sync">${htmlEstadoSync()}</div>
      ${e.configurado && !e.usuario ? `
        <form id="aj-login" class="grid2" autocomplete="on">
          <label class="field"><span>Correo</span><input id="lg-email" type="email" required autocomplete="email"></label>
          <label class="field"><span>Contraseña</span><input id="lg-pass" type="password" required minlength="6" autocomplete="current-password"></label>
          <div class="row"><button class="btn primary" type="submit" id="lg-entrar">Ingresar</button><button class="btn" type="button" id="lg-reg">Crear cuenta</button></div>
        </form>` : ''}
      ${e.usuario ? '<div class="row"><button type="button" class="btn ghost sm" id="aj-salir">Cerrar sesión</button><span class="small muted">Los registros pendientes se quedan en el equipo.</span></div>' : ''}
      <details ${e.configurado ? '' : 'open'}>
        <summary>Conexión a Supabase</summary>
        <div style="display:grid;gap:10px;margin-top:10px">
          <label class="field"><span>URL del proyecto</span><input id="aj-url" type="url" placeholder="https://xxxx.supabase.co" value="${esc(cfg?.url || '')}"></label>
          <label class="field"><span>Clave pública (anon)</span><input id="aj-key" type="text" class="mono" placeholder="eyJhbGciOi…" value="${esc(cfg?.key || '')}" autocomplete="off"></label>
          <div class="row"><button type="button" class="btn primary sm" id="aj-guardar-nube">Guardar conexión</button>${cfg ? '<button type="button" class="btn ghost sm" id="aj-quitar-nube">Desconectar</button>' : ''}</div>
          <p class="small muted">En Supabase: Project Settings → API. Antes, ejecute el archivo <span class="mono">supabase/schema.sql</span> en el SQL Editor.</p>
        </div>
      </details>
    </div>

    <div class="card">
      <h2>Proyectos</h2>
      <div class="tree-list">${D.proyectos.map((p) => `<div class="tree-row" style="cursor:default"><span class="tag">${esc(p.id.slice(0, 4).toUpperCase())}</span>
        <span class="sp"><b>${esc(p.nombre)}</b><i>${D.arboles.filter((a) => a.proyecto_id === p.id).length} árboles · factor de forma ${fmt(p.factor_forma, 2)}${p._demo ? ' · ejemplo' : ''}</i></span><span></span></div>`).join('') || '<p class="empty">Sin proyectos.</p>'}</div>
      <form id="aj-proy" class="grid2">
        <label class="field"><span>Nuevo proyecto</span><input id="np-nombre" required placeholder="Ej. Monitoreo reforestación 2026"></label>
        <label class="field"><span>Factor de forma <em>(0,5 latifoliadas)</em></span><input id="np-ff" type="number" step="0.01" min="0.2" max="1" value="0.5"></label>
        <div class="row"><button class="btn primary sm" type="submit">Crear proyecto</button></div>
      </form>
    </div>

    <div class="card">
      <h2>Parcelas</h2>
      <form id="aj-par" class="grid2">
        <label class="field"><span>Proyecto</span><select id="npa-proy">${opciones(D.proyectos, pref.get('proyecto', D.proyectos[0]?.id), (p) => p.nombre)}</select></label>
        <label class="field"><span>Código</span><input id="npa-cod" required placeholder="P03" class="mono"></label>
        <label class="field"><span>Nombre</span><input id="npa-nom" placeholder="Ribera del estero"></label>
        <label class="field"><span>Área</span><div class="unit"><input id="npa-area" type="number" min="0" step="any" placeholder="1000"><i>m²</i></div></label>
        <div class="row"><button class="btn primary sm" type="submit">Crear parcela</button></div>
      </form>
      <p class="small muted">${D.parcelas.length} parcelas registradas. El área permite calcular área basal, volumen y carbono por hectárea.</p>
    </div>

    <div class="card">
      <h2>Especies</h2>
      <form id="aj-esp" class="grid2">
        <label class="field"><span>Nombre común</span><input id="ne-com" required></label>
        <label class="field"><span>Nombre científico</span><input id="ne-cie"></label>
        <label class="field"><span>Densidad de madera</span><div class="unit"><input id="ne-den" type="number" step="0.01" min="0.1" max="1.4" value="0.6"><i>g/cm³</i></div></label>
        <div class="row"><button class="btn primary sm" type="submit">Agregar especie</button></div>
      </form>
      <p class="small muted">${D.especies.length} especies en el catálogo. La densidad se usa para estimar biomasa y carbono.</p>
    </div>

    <div class="card">
      <h2>GPS</h2>
      <div class="grid2">
        <label class="field"><span>Tiempo de promedio</span><select id="aj-seg">${[10, 20, 30, 60, 120].map((s) => `<option value="${s}" ${s === pref.get('gps_seg', 30) ? 'selected' : ''}>${s} segundos</option>`).join('')}</select></label>
        <label class="field"><span>Precisión objetivo</span><select id="aj-obj">${[2, 3, 5, 10, 15].map((s) => `<option value="${s}" ${s === pref.get('gps_obj', 5) ? 'selected' : ''}>${s} m o mejor</option>`).join('')}</select></label>
      </div>
      <p class="small muted">Bajo dosel cerrado, un promedio de 60 s o más reduce el error. Se descartan lecturas mucho peores que la mejor obtenida.</p>
    </div>

    <div class="card">
      <h2>Datos del equipo</h2>
      <p class="small">${store.persistente ? (P.NATIVA ? `App para ${P.SO === 'ios' ? 'iPhone/iPad' : 'Android'}. ` : '') + 'Los registros se guardan en este equipo y siguen disponibles sin conexión.' : 'Este navegador no permite guardar datos de forma permanente: los registros se perderán al cerrar la página.'}</p>
      <div class="row">
        ${hayDemo ? '<button type="button" class="btn sm" id="aj-demo-borrar">Borrar datos de ejemplo</button>' : '<button type="button" class="btn sm" id="aj-demo-cargar">Cargar datos de ejemplo</button>'}
        <button type="button" class="btn sm" id="aj-instalar" hidden>Instalar la app</button>
        <button type="button" class="btn ghost sm danger" id="aj-vaciar">Borrar todo del equipo</button>
      </div>
    </div>
  </section>`;

  $('#aj-sync')?.addEventListener('click', async () => { const ok = await sync.sincronizar(); await cargarDatos(); toast(ok ? 'Sincronización completa.' : 'No se pudo sincronizar: ' + (sync.estado.error || 'sin conexión')); });
  $('#aj-salir')?.addEventListener('click', async () => { await sync.salir(); vAjustes(); });
  $('#aj-login')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await sync.entrar($('#lg-email').value, $('#lg-pass').value); toast('Sesión iniciada. Sincronizando…'); await sync.sincronizar(); await cargarDatos(); vAjustes(); }
    catch (err) { toast(err.message, 5000); }
  });
  $('#lg-reg')?.addEventListener('click', async () => {
    const em = $('#lg-email').value, pw = $('#lg-pass').value;
    if (!em || pw.length < 6) return toast('Escriba un correo y una contraseña de al menos 6 caracteres.');
    try { const confirmarCorreo = await sync.registrar(em, pw); toast(confirmarCorreo ? 'Cuenta creada. Revise su correo para confirmarla y luego ingrese.' : 'Cuenta creada.', 6000); vAjustes(); }
    catch (err) { toast(err.message, 5000); }
  });
  $('#aj-guardar-nube').addEventListener('click', async () => {
    const url = $('#aj-url').value.trim(), key = $('#aj-key').value.trim();
    if (!/^https:\/\/.+/.test(url) || key.length < 20) return toast('Revise la URL (debe empezar con https://) y la clave anon.');
    await sync.guardarConfig(url, key); toast('Conexión guardada. Ahora inicie sesión.'); vAjustes();
  });
  $('#aj-quitar-nube')?.addEventListener('click', async () => { await sync.salir().catch(() => {}); await sync.guardarConfig('', ''); vAjustes(); });
  $('#aj-proy').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const p = await store.guardar('proyectos', { nombre: $('#np-nombre').value.trim(), descripcion: null, factor_forma: num($('#np-ff').value) || 0.5 });
    pref.set('proyecto', p.id); pref.set('parcela', ''); F = null;
    await cargarDatos(); sync.programar(); toast('Proyecto creado.'); vAjustes();
  });
  $('#aj-par').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const proyecto_id = $('#npa-proy').value, codigo = $('#npa-cod').value.trim();
    if (D.parcelas.some((p) => p.proyecto_id === proyecto_id && p.codigo.toLowerCase() === codigo.toLowerCase())) return toast('Ya existe una parcela con ese código en el proyecto.');
    const p = await store.guardar('parcelas', { proyecto_id, codigo, nombre: $('#npa-nom').value.trim() || null, area_m2: num($('#npa-area').value), ...(I.proy.get(proyecto_id)?._demo ? { _demo: 1 } : {}) });
    pref.set('proyecto', proyecto_id); pref.set('parcela', p.id); F = null;
    await cargarDatos(); sync.programar(); toast(`Parcela ${codigo} creada.`); vAjustes();
  });
  $('#aj-esp').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await store.guardar('especies', { nombre_comun: $('#ne-com').value.trim(), nombre_cientifico: $('#ne-cie').value.trim() || null, familia: null, densidad_madera: num($('#ne-den').value) || 0.6 });
    await cargarDatos(); sync.programar(); toast('Especie agregada.'); vAjustes();
  });
  $$('[data-tema]').forEach((b) => b.addEventListener('click', () => T.aplicarTema(b.dataset.tema)));
  $('#aj-seg').addEventListener('change', (ev) => pref.set('gps_seg', Number(ev.target.value)));
  $('#aj-obj').addEventListener('change', (ev) => pref.set('gps_obj', Number(ev.target.value)));
  $('#aj-demo-borrar')?.addEventListener('click', async () => { await borrarDemo(); pref.set('proyecto', null); F = null; await cargarDatos(); toast('Datos de ejemplo borrados.'); vAjustes(); });
  $('#aj-demo-cargar')?.addEventListener('click', async () => { await cargarDemo(); F = null; await cargarDatos(); toast('Datos de ejemplo cargados.'); vAjustes(); });
  $('#aj-vaciar').addEventListener('click', (ev) => confirmar(ev.currentTarget, 'Se perderá lo no sincronizado. ¿Confirmar?', async () => {
    await store.vaciarTodo(); await asegurarEspecies(); await store.meta('demo_cargado', true); F = null; await cargarDatos(); toast('Datos del equipo borrados.'); vAjustes();
  }));
  if (instalador) { const b = $('#aj-instalar'); b.hidden = false; b.addEventListener('click', async () => { instalador.prompt(); instalador = null; b.hidden = true; }); }
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
let instalador = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); instalador = e; });

function refrescarVista() {
  if (vista === 'arboles') vArboles();
  else if (vista === 'panel') vPanel();
  else if (vista === 'ajustes') vAjustes();
  else if (vista === 'mapa') vMapa();
}

async function iniciar() {
  T.iniciarTema(); pintarBotonTema();
  await store.abrir();
  await asegurarEspecies();
  if (!(await store.meta('demo_cargado'))) await cargarDemo();
  await cargarDatos();
  let recarga;
  store.alCambiar(() => { clearTimeout(recarga); recarga = setTimeout(async () => { await cargarDatos(); const escribiendo = document.activeElement?.matches?.('input, select, textarea');
    if (!['registrar', 'ajustes'].includes(vista) && !escribiendo && !document.querySelector('.sheet-back')) refrescarVista(); }, 300); });
  const inicial = location.hash.slice(1);
  ir(['registrar', 'mapa', 'arboles', 'panel', 'ajustes'].includes(inicial) ? inicial : 'registrar');
  sync.iniciar();
  pintarSync();
  P.registrarModoSinConexion();
}
iniciar().catch((e) => { console.error(e); main.innerHTML = `<div class="view"><div class="alerta bad">No se pudo iniciar la app: ${esc(e.message)}</div></div>`; });
