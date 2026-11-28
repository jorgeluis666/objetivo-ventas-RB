/* ============================================================
   competencia.js — Análisis de Competencia.
   Instantánea manual de la Biblioteca de Anuncios de Meta (anuncios activos con
   alcance en Perú, categoría ropa de bebé y niño). No hay sincronización
   automática: los datos de abajo se actualizan a mano y FECHA_CORTE dice cuándo.
   Para rehacer la toma: facebook.com/ads/library → país Perú → la página de cada
   marca → contar los activos y su formato, y guardar el creativo de la oferta en
   assets/competencia/.
   Expone window.Competencia = { init }.
   ============================================================ */

(function (global) {
  const FECHA_CORTE = '27 nov 2026, 20:00';
  const PERIODO = 'Black Friday · 26 y 27 de noviembre de 2026';

  // Cada marca: anuncios activos, desglose de formato, oferta y primer anuncio al aire.
  // `activos` sale del contador de la Biblioteca. El formato se contó sobre las piezas
  // que llegó a cargar la página, y `muestra` dice sobre cuántas (null = todas).
  const MARCAS = [
    {
      nombre: 'Baby Loli', activos: 99, aprox: true, muestra: 28,
      video: 12, imagen: 14, catalogo: 2,
      oferta: 'Sin oferta de Black Friday', salida: null,
      lectura: 'Volumen continuo todo el año', tono: 'slate',
    },
    {
      nombre: 'Royal Baby', activos: 17, aprox: false, muestra: null,
      video: 14, imagen: 0, catalogo: 3,
      oferta: '20 % Dorian Gray · 15 % Martín Aranda · 30 % Manchester',
      salida: '27 nov, 17:09',
      lectura: 'Casi todo video, sin imagen estática', tono: 'amber', propia: true,
    },
    {
      nombre: 'Hormiguita Bebé', activos: 9, aprox: false, muestra: null,
      video: 6, imagen: 0, catalogo: 3,
      oferta: 'Hasta 50 % OFF · del 21 al 30 de noviembre',
      salida: '25 nov, 02:48',
      lectura: 'Oferta y catálogo a la vez', tono: 'green',
    },
    {
      nombre: 'Cottoba', activos: 7, aprox: false, muestra: null,
      video: 0, imagen: 7, catalogo: 0,
      oferta: '20 % OFF con el código 20OFF',
      salida: '27 nov, 12:54',
      lectura: 'Solo imagen', tono: 'slate',
    },
    {
      nombre: 'Babyberry', activos: 7, aprox: true, muestra: 6,
      video: 5, imagen: 1, catalogo: 0,
      oferta: 'Hasta 30 % OFF · del 27 al 30 de noviembre',
      salida: '27 nov, 14:25',
      lectura: 'Video de marca, oferta en imagen', tono: 'slate',
    },
    {
      nombre: 'shop.babymoon', activos: 1, aprox: false, muestra: null,
      video: 0, imagen: 1, catalogo: 0,
      oferta: '30 % en toda la web · código FRIDAY30 · del 25 al 28',
      salida: '26 nov, 20:53',
      lectura: 'Una sola pieza', tono: 'amber',
    },
  ];

  // Creativos de la oferta, guardados de la Biblioteca.
  const CREATIVOS = [
    { marca: 'Hormiguita Bebé', img: 'assets/competencia/hormiguita.jpg', dice: 'HASTA 50 % OFF', cuando: 'mié 25 nov, 02:48' },
    { marca: 'shop.babymoon', img: 'assets/competencia/babymoon.jpg', dice: '30 % en toda la web · FRIDAY30', cuando: 'jue 26 nov, 20:53' },
    { marca: 'Cottoba', img: 'assets/competencia/cottoba.jpg', dice: '20 % OFF · código 20OFF', cuando: 'vie 27 nov, 12:54' },
    { marca: 'Babyberry', img: 'assets/competencia/babyberry.jpg', dice: 'hasta 30 % OFF', cuando: 'vie 27 nov, 14:25' },
    { marca: 'Royal Baby', img: 'assets/competencia/royal-baby.jpg', dice: 'Ningún porcentaje', cuando: 'vie 27 nov, 17:09', propia: true },
  ];

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => new Intl.NumberFormat('es-PE').format(n);

  let inited = false;

  function kpis() {
    const propia = MARCAS.find(m => m.propia);
    const lider = MARCAS.reduce((a, b) => (b.activos > a.activos ? b : a));
    return `
      <div class="kpi-card">
        <div class="kpi-icon red">▣</div>
        <div class="kpi-lbl">Activos de Royal Baby</div>
        <div class="kpi-val">${num(propia.activos)}</div>
        <div class="kpi-sub"><span class="pill amber">5 son de Black Days</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon slate">▲</div>
        <div class="kpi-lbl">El que más corre</div>
        <div class="kpi-val">~${num(lider.activos)}</div>
        <div class="kpi-sub"><span class="muted">${esc(lider.nombre)} · sin oferta de Black Friday</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon amber">▶</div>
        <div class="kpi-lbl">Peso del video</div>
        <div class="kpi-val amber">${propia.video} de ${propia.activos}</div>
        <div class="kpi-sub"><span class="muted">Ninguna imagen estática al aire</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-icon red">⏱</div>
        <div class="kpi-lbl">Royal Baby salió a las</div>
        <div class="kpi-val red">17:09</div>
        <div class="kpi-sub"><span class="pill red">Último del grupo</span></div>
      </div>`;
  }

  function tablaOfertas() {
    const filas = MARCAS
      .slice()
      .sort((a, b) => (a.salida || 'zz').localeCompare(b.salida || 'zz'))
      .map(m => `
        <tr${m.propia ? ' class="comp-propia"' : ''}>
          <td><b>${esc(m.nombre)}</b></td>
          <td>${esc(m.oferta)}</td>
          <td class="r mono">${m.salida ? esc(m.salida) : '—'}</td>
          <td><span class="pill ${m.tono === 'slate' ? '' : m.tono}">${esc(m.lectura)}</span></td>
        </tr>`).join('');
    return `
      <div class="gp-table-wrap"><table class="rep-table">
        <thead><tr>
          <th>Marca</th><th>Oferta</th><th class="r">Primer anuncio al aire</th><th>Cómo compite</th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table></div>`;
  }

  function tablaFormatos() {
    const filas = MARCAS.map(m => `
      <tr${m.propia ? ' class="comp-propia"' : ''}>
        <td><b>${esc(m.nombre)}</b>${m.muestra ? `<span class="comp-nota">formato sobre ${m.muestra} piezas</span>` : ''}</td>
        <td class="r">${m.aprox ? '~' : ''}${num(m.activos)}</td>
        <td class="r">${num(m.video)}</td>
        <td class="r">${num(m.imagen)}</td>
        <td class="r">${num(m.catalogo)}</td>
      </tr>`).join('');
    const total = MARCAS.reduce((s, m) => s + m.activos, 0);
    return `
      <div class="gp-table-wrap"><table class="rep-table">
        <thead><tr>
          <th>Marca</th><th class="r">Activos</th><th class="r">Video</th><th class="r">Imagen</th><th class="r">Catálogo</th>
        </tr></thead>
        <tbody>${filas}
          <tr class="plan-total">
            <td><b>Total relevado</b></td>
            <td class="r"><b>${num(total)}</b></td>
            <td class="r">—</td><td class="r">—</td><td class="r">—</td>
          </tr>
        </tbody>
      </table></div>`;
  }

  function creativos() {
    return CREATIVOS.map(c => `
      <figure class="comp-creativo${c.propia ? ' propia' : ''}">
        <img src="${esc(c.img)}" alt="Anuncio de ${esc(c.marca)}: ${esc(c.dice)}" loading="lazy">
        <figcaption>
          <div class="comp-creativo-marca">${esc(c.marca)}${c.propia ? ' <span class="pill red">Nuestra marca</span>' : ''}</div>
          <div class="comp-creativo-dice">${esc(c.dice)}</div>
          <div class="comp-creativo-cuando">${esc(c.cuando)}</div>
        </figcaption>
      </figure>`).join('');
  }

  function chart() {
    if (!global.Charts?.mount) return;
    const orden = MARCAS.slice().sort((a, b) => b.activos - a.activos);
    global.Charts.mount('chart-comp-activos', {
      type: 'bar',
      data: {
        labels: orden.map(m => m.nombre),
        datasets: [
          { label: 'Video', data: orden.map(m => m.video), backgroundColor: '#b91c1c', stack: 'f' },
          { label: 'Imagen', data: orden.map(m => m.imagen), backgroundColor: '#f1a7a7', stack: 'f' },
          { label: 'Catálogo', data: orden.map(m => m.catalogo), backgroundColor: '#475569', stack: 'f' },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
          datalabels: { display: false },
          tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.x}` } },
        },
        scales: {
          x: { stacked: true, beginAtZero: true, grid: { color: '#eef2f7' }, ticks: { font: { size: 11 } } },
          y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
        },
      },
    });
  }

  function init() {
    if (inited) { chart(); return; }
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    set('comp-kpis', kpis());
    set('comp-ofertas', tablaOfertas());
    set('comp-formatos', tablaFormatos());
    set('comp-creativos', creativos());
    const corte = document.getElementById('comp-corte');
    if (corte) corte.textContent = `${PERIODO} · toma del ${FECHA_CORTE}`;
    chart();
    inited = true;
  }

  global.Competencia = { init };
})(window);
