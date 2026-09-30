// Catálogo base de especies y datos de ejemplo para probar la app sin nube.
import * as store from './store.js';

export const ESPECIES_BASE = [
  ['01', 'Teca', 'Tectona grandis', 'Lamiaceae', 0.55],
  ['02', 'Balsa', 'Ochroma pyramidale', 'Malvaceae', 0.16],
  ['03', 'Laurel', 'Cordia alliodora', 'Boraginaceae', 0.48],
  ['04', 'Guayacán', 'Handroanthus chrysanthus', 'Bignoniaceae', 0.92],
  ['05', 'Cacao', 'Theobroma cacao', 'Malvaceae', 0.42],
  ['06', 'Samán', 'Samanea saman', 'Fabaceae', 0.49],
  ['07', 'Ceibo', 'Ceiba trichistandra', 'Malvaceae', 0.25],
  ['08', 'Fernán Sánchez', 'Triplaris cumingiana', 'Polygonaceae', 0.55],
  ['09', 'Guachapelí', 'Albizia guachapele', 'Fabaceae', 0.56],
  ['10', 'Pechiche', 'Vitex gigantea', 'Lamiaceae', 0.60],
  ['11', 'Caoba', 'Swietenia macrophylla', 'Meliaceae', 0.51],
  ['12', 'Cedro', 'Cedrela odorata', 'Meliaceae', 0.41],
  ['13', 'Melina', 'Gmelina arborea', 'Lamiaceae', 0.43],
  ['14', 'Algarrobo', 'Prosopis juliflora', 'Fabaceae', 0.80],
  ['15', 'Moral fino', 'Maclura tinctoria', 'Moraceae', 0.75],
].map(([n, comun, cient, fam, dens]) => ({
  id: `00000000-0000-4000-a000-0000000000${n}`,
  nombre_comun: comun, nombre_cientifico: cient, familia: fam, densidad_madera: dens,
  modificado_cliente: '2026-01-01T00:00:00.000Z', deleted: false, _pend: 0,
}));

const esp = (n) => `00000000-0000-4000-a000-0000000000${n}`;

function azar(semilla) { // mulberry32: datos de ejemplo reproducibles
  return () => {
    semilla |= 0; semilla = (semilla + 0x6d2b79f5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function asegurarEspecies() {
  const actuales = await store.todos('especies');
  const ids = new Set(actuales.map((e) => e.id));
  await store.guardarVarios('especies', ESPECIES_BASE.filter((e) => !ids.has(e.id)));
}

export async function cargarDemo() {
  const r = azar(20260928);
  const ts = '2026-09-01T00:00:00.000Z';
  const base = { modificado_cliente: ts, deleted: false, _pend: 0, _demo: 1 };
  const proy = { ...base, id: 'demo-proyecto', nombre: 'Parcela demostrativa (ejemplo)', descripcion: 'Datos inventados para conocer la app. Puede borrarlos en Ajustes.', factor_forma: 0.5 };
  const parcelas = [
    { ...base, id: 'demo-p01', proyecto_id: proy.id, codigo: 'P01', nombre: 'Bosque seco · lote norte', area_m2: 2500, _c: [-1.55520, -80.42470] },
    { ...base, id: 'demo-p02', proyecto_id: proy.id, codigo: 'P02', nombre: 'Sistema agroforestal con cacao', area_m2: 2500, _c: [-1.55840, -80.42190] },
  ];
  // [especie, n árboles, DAP inicial medio, incremento cm/año, altura asintótica]
  const mezcla = {
    'demo-p01': [['04', 4, 22, 0.6, 18], ['06', 3, 38, 1.1, 22], ['07', 2, 55, 1.4, 25], ['08', 4, 18, 0.9, 16], ['09', 3, 26, 1.0, 19], ['14', 2, 20, 0.5, 11], ['15', 2, 24, 0.7, 17]],
    'demo-p02': [['05', 6, 11, 0.6, 6], ['03', 4, 19, 1.3, 21], ['01', 3, 21, 1.6, 23], ['02', 2, 28, 3.0, 24], ['12', 2, 16, 1.2, 18], ['13', 2, 20, 2.0, 20]],
  };
  const fechas = ['2023-09-14', '2024-09-19', '2025-09-11', '2026-09-17'];
  const arboles = [], mediciones = [];
  for (const par of parcelas) {
    let n = 0;
    for (const [e, cant, d0, inc, hMax] of mezcla[par.id]) {
      for (let i = 0; i < cant; i++) {
        n++;
        const codigo = `${par.codigo}-${String(n).padStart(3, '0')}`;
        const id = `demo-a-${codigo}`;
        const lat = par._c[0] + (r() - 0.5) * 0.00045, lon = par._c[1] + (r() - 0.5) * 0.00045;
        arboles.push({ ...base, id, proyecto_id: proy.id, parcela_id: par.id, especie_id: esp(e), codigo,
          lat: +lat.toFixed(7), lon: +lon.toFixed(7), altitud_m: Math.round(95 + r() * 40),
          precision_m: +(2 + r() * 3).toFixed(1), n_muestras_gps: 25 + Math.floor(r() * 20), metodo_ubicacion: 'gps', observaciones: '' });
        let dap = d0 * (0.7 + r() * 0.6);
        const desde = r() < 0.2 ? 1 : 0; // algunos árboles se marcaron en 2024
        const ncopa = 2 + dap / 10;
        for (let k = desde; k < fechas.length; k++) {
          if (k > desde) dap += inc * (0.6 + r() * 0.8);
          const h = 1.3 + (hMax - 1.3) * (1 - Math.exp(-0.045 * dap)) * (0.98 + r() * 0.04);
          let estado = r() < 0.8 ? 'bueno' : r() < 0.7 ? 'regular' : 'malo';
          if (codigo === 'P01-011' && k === 3) estado = 'muerto';
          const copa = ncopa * (0.8 + r() * 0.5) + k * 0.3;
          mediciones.push({ ...base, id: `demo-m-${codigo}-${k}`, arbol_id: id, proyecto_id: proy.id, fecha: fechas[k],
            dap_cm: +dap.toFixed(1), cap_cm: +(dap * Math.PI).toFixed(1),
            altura_total_m: +h.toFixed(1), altura_comercial_m: e === '05' ? null : +(h * (0.45 + r() * 0.2)).toFixed(1),
            copa_ns_m: +copa.toFixed(1), copa_eo_m: +(copa * (0.85 + r() * 0.3)).toFixed(1),
            estado_sanitario: estado, vigor: estado === 'bueno' ? 1 : estado === 'regular' ? 2 : 3,
            fenologia: ['vegetativo', 'floracion', 'fructificacion', 'defoliado'][Math.floor(r() * 4)],
            danos: estado === 'malo' ? ['insectos'] : [], observaciones: '', tecnico: 'Brigada de ejemplo' });
        }
      }
    }
  }
  await store.guardarVarios('proyectos', [proy]);
  await store.guardarVarios('parcelas', parcelas.map(({ _c, ...p }) => p));
  await store.guardarVarios('arboles', arboles);
  await store.guardarVarios('mediciones', mediciones);
  await store.meta('demo_cargado', true);
}

export async function borrarDemo() {
  for (const t of ['proyectos', 'parcelas', 'arboles', 'mediciones', 'fotos']) {
    const recs = await store.todos(t);
    const quedan = recs.filter((x) => !(x._demo || x.proyecto_id === 'demo-proyecto'));
    if (quedan.length !== recs.length) {
      // reescribir la tabla sin los registros de ejemplo
      await store.guardarVarios(t, recs.filter((x) => x._demo || x.proyecto_id === 'demo-proyecto').map((x) => ({ ...x, deleted: true, _pend: 0, _demo: 1 })));
    }
  }
  store.emitir();
}
