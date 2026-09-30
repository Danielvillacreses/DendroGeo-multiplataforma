// Cinta métrica deslizable: se arrastra con el dedo (con inercia), con la rueda del mouse
// (desplazamiento horizontal), con las flechas del teclado o con los botones − / +.
// Está sincronizada con el campo numérico: escribir mueve la cinta y mover la cinta escribe el valor.

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export function crearCinta(host, {
  min = 0, max = 100, paso = 0.1, unidad = 'cm', valor = null, inicial = 10,
  pxPorUnidad = 60, etiquetaCada = 1, etiqueta = 'Medida', alCambiar = () => {},
} = {}) {
  const decimales = Math.max(0, Math.round(-Math.log10(paso)));
  const pasosPorUnidad = Math.round(1 / paso);
  const redondear = (v) => +(Math.round(v / paso) * paso).toFixed(decimales);
  const limitar = (v) => Math.min(max, Math.max(min, v));

  host.innerHTML = `<div class="cinta">
    <button type="button" class="cinta-btn" data-d="-1" aria-label="Restar ${paso} ${unidad}">−</button>
    <div class="cinta-pista" tabindex="0" role="slider" aria-label="${etiqueta}: cinta métrica deslizable"
      aria-valuemin="${min}" aria-valuemax="${max}">
      <canvas></canvas><div class="cinta-aguja" aria-hidden="true"></div>
    </div>
    <button type="button" class="cinta-btn" data-d="1" aria-label="Sumar ${paso} ${unidad}">+</button>
  </div>`;
  const pista = host.querySelector('.cinta-pista');
  const canvas = host.querySelector('canvas');
  const ctx = canvas.getContext('2d');

  let actual = valor;                         // valor elegido (null = sin dato)
  let pos = limitar(valor ?? inicial);        // valor bajo la aguja (continuo)
  let W = 0, H = 0, anim = 0;

  function medir() {
    const r = pista.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dibujar();
  }

  function dibujar() {
    if (!W) return;
    const tinta = css('--tape-ink') || '#2a2105';
    const fondo = css('--tape') || '#e2b336';
    const fuente = css('--f-mono') || 'monospace';
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = fondo; ctx.fillRect(0, 0, W, H);
    const cx = W / 2;
    const desde = Math.floor((pos - cx / pxPorUnidad) / paso) - 1;
    const hasta = Math.ceil((pos + cx / pxPorUnidad) / paso) + 1;
    // zona fuera de rango
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    const xMin = cx + (min - pos) * pxPorUnidad, xMax = cx + (max - pos) * pxPorUnidad;
    if (xMin > 0) ctx.fillRect(0, 0, xMin, H);
    if (xMax < W) ctx.fillRect(xMax, 0, W - xMax, H);
    ctx.globalAlpha = actual == null ? 0.55 : 1;
    ctx.strokeStyle = tinta; ctx.fillStyle = tinta;
    ctx.font = `600 12px ${fuente}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    for (let n = desde; n <= hasta; n++) {
      const v = n * paso;
      if (v < min - 1e-9 || v > max + 1e-9) continue;
      const x = Math.round(cx + (v - pos) * pxPorUnidad) + 0.5;
      let h = H * 0.18, w = 1;
      if (n % pasosPorUnidad === 0) { h = H * 0.46; w = 1.6; }
      else if (pasosPorUnidad % 2 === 0 && n % (pasosPorUnidad / 2) === 0) h = H * 0.32;
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      if (n % (pasosPorUnidad * etiquetaCada) === 0) ctx.fillText(String(Math.round(v)), x, H - 8);
    }
    ctx.globalAlpha = 1;
    // bordes que se desvanecen: sugieren que la cinta continúa
    const g1 = ctx.createLinearGradient(0, 0, 28, 0); g1.addColorStop(0, fondo); g1.addColorStop(1, 'rgba(0,0,0,0)');
    const g2 = ctx.createLinearGradient(W - 28, 0, W, 0); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, fondo);
    ctx.fillStyle = g1; ctx.fillRect(0, 0, 28, H);
    ctx.fillStyle = g2; ctx.fillRect(W - 28, 0, 28, H);
    pista.setAttribute('aria-valuenow', String(actual ?? ''));
    pista.setAttribute('aria-valuetext', actual == null ? 'sin medir' : `${actual} ${unidad}`);
  }

  let ultimaUnidad = Math.floor(pos);
  function emitir(final = false) {
    const v = redondear(limitar(pos));
    if (v !== actual) {
      actual = v;
      const u = Math.floor(v);
      if (u !== ultimaUnidad) { ultimaUnidad = u; try { navigator.vibrate?.(4); } catch {} }
      alCambiar(v, final);
    } else if (final) alCambiar(v, true);
  }

  // --- arrastre con inercia ---
  let arrastrando = false, x0 = 0, t0 = 0, vel = 0, movido = 0;
  pista.addEventListener('pointerdown', (e) => {
    cancelAnimationFrame(anim);
    arrastrando = true; movido = 0; x0 = e.clientX; t0 = performance.now(); vel = 0;
    pista.setPointerCapture(e.pointerId);
    pista.classList.add('activa');
  });
  pista.addEventListener('pointermove', (e) => {
    if (!arrastrando) return;
    const t = performance.now(), dx = e.clientX - x0, dt = Math.max(1, t - t0);
    movido += Math.abs(dx);
    pos = limitar(pos - dx / pxPorUnidad);
    vel = 0.8 * (-dx / pxPorUnidad / dt) + 0.2 * vel;
    x0 = e.clientX; t0 = t;
    dibujar(); emitir();
  });
  const soltar = () => {
    if (!arrastrando) return;
    arrastrando = false; pista.classList.remove('activa');
    if (performance.now() - t0 > 80) vel = 0;       // se detuvo antes de soltar
    let tPrev = performance.now();
    const paso_ = (t) => {
      const dt = t - tPrev; tPrev = t;
      pos = limitar(pos + vel * dt);
      vel *= Math.pow(0.94, dt / 16);
      if (Math.abs(vel) < 0.0004 || pos === min || pos === max) {
        pos = redondear(pos); dibujar(); emitir(true); return;
      }
      dibujar(); emitir();
      anim = requestAnimationFrame(paso_);
    };
    if (movido > 2) anim = requestAnimationFrame(paso_);
  };
  pista.addEventListener('pointerup', soltar);
  pista.addEventListener('pointercancel', soltar);

  // --- rueda horizontal / trackpad ---
  pista.addEventListener('wheel', (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : (e.shiftKey ? e.deltaY : 0);
    if (!d) return;
    e.preventDefault(); cancelAnimationFrame(anim);
    pos = limitar(pos + d / pxPorUnidad); dibujar(); emitir();
  }, { passive: false });

  // --- teclado ---
  pista.addEventListener('keydown', (e) => {
    const m = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10 * pasosPorUnidad, PageDown: -10 * pasosPorUnidad }[e.key];
    if (e.key === 'Home') { pos = min; } else if (e.key === 'End') { pos = max; }
    else if (m) { pos = limitar(redondear((actual ?? pos) + m * paso * (e.shiftKey ? 10 : 1))); }
    else return;
    e.preventDefault(); cancelAnimationFrame(anim); dibujar(); emitir(true);
  });

  // --- botones − / + (mantener presionado repite) ---
  host.querySelectorAll('.cinta-btn').forEach((b) => {
    let rep = 0, retardo = 0;
    const mover = () => { pos = limitar(redondear((actual ?? pos) + Number(b.dataset.d) * paso)); dibujar(); emitir(true); };
    const parar = () => { clearTimeout(retardo); clearInterval(rep); };
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); cancelAnimationFrame(anim); mover(); retardo = setTimeout(() => { rep = setInterval(mover, 55); }, 380); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, parar));
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mover(); } });
  });

  window.addEventListener('dg-tema', dibujar);
  const ro = new ResizeObserver(medir);
  ro.observe(pista);
  requestAnimationFrame(medir);

  return {
    /** Mueve la cinta a un valor escrito a mano (no dispara alCambiar). */
    set(v) {
      cancelAnimationFrame(anim);
      actual = v == null || isNaN(v) ? null : limitar(v);
      if (actual != null) pos = actual;
      ultimaUnidad = Math.floor(pos);
      dibujar();
    },
    destruir() { ro.disconnect(); cancelAnimationFrame(anim); window.removeEventListener('dg-tema', dibujar); },
  };
}
