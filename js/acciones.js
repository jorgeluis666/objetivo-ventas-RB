/* ============================================================
   acciones.js — Acciones sugeridas del mes para Meta Ads, con check.

   El Ciclo Mensual de Análisis y Optimización dice en qué semana del mes vamos; las cifras reales
   dicen qué hacer. De las dos cosas sale la lista: cada acción lleva el número exacto, el porqué y
   la ruta donde se toca en el Administrador de anuncios.

   Dos cosas propias de Royal Baby. La primera: aunque el mes de ventas cierra el 26 (ciclo.js), las
   semanas de este ciclo van por mes de calendario, porque la descarga de Meta viene así —septiembre
   es del 1 al 30— y contar las semanas sobre el ciclo pondría la etiqueta de una semana encima de
   las cifras de otra. La segunda: Google Ads va por Nexus, así que acá solo se mira Meta.

   Las palancas de Meta no son las de Google: no se mueven keywords ni pujas, se mueve el arte, el
   formato y la inversión de la campaña. El hito que corre hoy pone sus acciones primero, pero no se
   esconde ninguna: una pieza que gasta sin resultados no puede esperar a la semana que le toque.

   El id de cada acción es estable (tipo + campaña o anuncio, nunca la cifra), de modo que lo marcado
   sigue marcado aunque los números cambien al día siguiente. El estado es por mes y, por ahora, vive
   solo en este navegador: lo que marca una persona no lo ven las demás, y la tarjeta lo dice.
   ============================================================ */

(function (global) {
  const LOCAL_KEY = 'rb_acciones_v1';
  const FRECUENCIA_ALTA = 2;
  const GASTO_MINIMO = 50;
  const CAMBIO_MINIMO = 0.15;

  const HITOS = [
    { key: 'calibracion', hasta: 7, titulo: 'Calibración', semana: 'Semana 1' },
    { key: 'desgaste', hasta: 14, titulo: 'Desgaste del arte', semana: 'Semana 2' },
    { key: 'formato', hasta: 21, titulo: 'Formato', semana: 'Semana 3' },
    { key: 'escalar', hasta: 99, titulo: 'Escalar y repetir', semana: 'Semana 4' },
  ];
  const ORDEN = HITOS.map(hito => hito.key);

  const TIPOS = {
    compras: { metric: 'purchases', uno: 'compra', varias: 'compras' },
    mensajes: { metric: 'conversations', uno: 'conversación', varias: 'conversaciones' },
    resultados: { metric: 'results', uno: 'resultado', varias: 'resultados' },
  };

  const state = { hechas: {}, cargado: false, datos: null };

  const esc = valor => String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const normalize = valor => String(valor ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const finite = valor => valor != null && Number.isFinite(Number(valor));
  const nf = (valor, min, max) => Number(valor).toLocaleString('es-PE', { minimumFractionDigits: min, maximumFractionDigits: max });
  const money = valor => (finite(valor) ? `S/ ${nf(valor, 2, 2)}` : '—');
  // Un costo de centavos con dos decimales queda en «S/ 0.01» y la frase pierde sentido.
  const costo = valor => (finite(valor) && valor > 0 && valor < 0.1 ? `S/ ${nf(valor, 3, 4)}` : money(valor));
  const count = valor => (finite(valor) ? nf(Math.round(valor), 0, 0) : '—');
  const pct = valor => `${valor > 0 ? '+' : ''}${Math.round(valor * 100)}%`;
  // Meta nombra las campañas «Ventas E-Commerce | 2025 | LR | Inv. Total | Ver01»: en una frase se
  // lee mal. En el título va el nombre corto; en la ruta, el nombre tal cual.
  const corto = nombre => (String(nombre || '').split('|')[0].trim() || String(nombre || ''));

  // ── Guardado ───────────────────────────────────────────────────────────────
  function cargar() {
    if (state.cargado) return;
    state.cargado = true;
    try {
      const guardado = JSON.parse(global.localStorage.getItem(LOCAL_KEY) || '{}');
      if (guardado && typeof guardado === 'object') state.hechas = guardado;
    } catch (err) {
      // Sin localStorage las marcas duran lo que dure la pestaña.
    }
  }

  function guardar() {
    try {
      global.localStorage.setItem(LOCAL_KEY, JSON.stringify(state.hechas));
    } catch (err) {
      // Igual que arriba.
    }
  }

  const marcada = (mes, id) => Boolean(state.hechas[`${mes}|${id}`]);

  function marcar(mes, id, valor) {
    const key = `${mes}|${id}`;
    if (valor) state.hechas[key] = true;
    else delete state.hechas[key];
    guardar();
  }

  function clave(texto) {
    const plano = normalize(texto).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (plano.length <= 32) return plano;
    let suma = 5381;
    for (let i = 0; i < plano.length; i += 1) suma = ((suma * 33) ^ plano.charCodeAt(i)) >>> 0;
    return `${plano.slice(0, 32)}-${suma.toString(36)}`;
  }

  // ── Las filas de Meta ──────────────────────────────────────────────────────
  // El JSON guarda la tabla comprimida: campaña, conjunto y anuncio son índices a sus listas, y el
  // día es el número de día del mes. Se expande a filas con nombres, que es como se puede agrupar.
  function filasDe(mes) {
    const tabla = mes?.meta?.table;
    if (!tabla || !Array.isArray(tabla.rows)) return [];
    const col = nombre => tabla.columns.indexOf(nombre);
    const idx = { d: col('d'), campaign: col('campaign'), adset: col('adset'), ad: col('ad') };
    const nums = ['spend', 'impressions', 'reach', 'linkClicks', 'purchases', 'conversations', 'results']
      .map(campo => [campo, col(campo)]);
    // Campañas y conjuntos son cadenas; cada anuncio es { name, link }.
    const nombre = (lista, i) => {
      const valor = Array.isArray(lista) && i != null ? lista[i] : null;
      if (valor == null) return '';
      return typeof valor === 'string' ? valor : String(valor.name ?? valor.ad ?? '');
    };
    return tabla.rows.map(row => {
      const item = {
        d: Number(row[idx.d]) || 0,
        campaign: nombre(tabla.campaigns, row[idx.campaign]),
        adset: nombre(tabla.adsets, row[idx.adset]),
        ad: nombre(tabla.ads, row[idx.ad]),
      };
      nums.forEach(([campo, i]) => { item[campo] = i < 0 ? 0 : Number(row[i]) || 0; });
      return item;
    });
  }

  function totales(filas) {
    const suma = { spend: 0, impressions: 0, reach: 0, linkClicks: 0, purchases: 0, conversations: 0, results: 0 };
    filas.forEach(row => { Object.keys(suma).forEach(campo => { suma[campo] += row[campo] || 0; }); });
    suma.frequency = suma.reach > 0 ? suma.impressions / suma.reach : null;
    return suma;
  }

  const tipoDe = suma => (suma.purchases > 0 ? TIPOS.compras : suma.conversations > 0 ? TIPOS.mensajes : TIPOS.resultados);
  const valorDe = (suma, tipo) => suma[tipo.metric] || 0;
  const costoDe = (suma, tipo) => (valorDe(suma, tipo) > 0 ? suma.spend / valorDe(suma, tipo) : null);

  function agrupar(filas, llave, extra) {
    const mapa = new Map();
    filas.forEach(row => {
      const key = llave(row);
      if (!mapa.has(key)) mapa.set(key, { key, filas: [], ...extra(row) });
      mapa.get(key).filas.push(row);
    });
    return [...mapa.values()].map(item => ({ ...item, ...totales(item.filas) })).filter(item => item.spend > 0);
  }

  const porCampana = filas => agrupar(filas, row => normalize(row.campaign), row => ({ campaign: row.campaign }));
  const porAnuncio = filas => agrupar(filas, row => `${normalize(row.campaign)}|${normalize(row.ad)}`, row => ({ campaign: row.campaign, ad: row.ad }));

  // El mes con datos más reciente y el mismo tramo de días del mes anterior del ciclo.
  function periodo(datos) {
    const meses = (datos?.months || []).filter(m => m?.meta?.table?.rows?.length);
    if (!meses.length) return null;
    const mes = meses[meses.length - 1];
    const prev = meses[meses.length - 2] || null;
    const filas = filasDe(mes);
    const to = Math.max(...filas.map(row => row.d), 0);
    const prevFilas = prev ? filasDe(prev).filter(row => row.d <= to) : null;
    return {
      id: mes.id,
      label: mes.label,
      to,
      filas,
      prev: prevFilas && prevFilas.length ? prevFilas : null,
      labelPrev: prev ? prev.label : '',
    };
  }

  // La semana del ciclo va por **mes de calendario**, no por el ciclo de venta de Royal Baby.
  // Parece al revés de lo que haría el resto del tablero, y es a propósito: la descarga de Meta
  // viene por mes natural (septiembre es del 1 al 30, no del 27 ago al 26 sep), así que contar las
  // semanas sobre el ciclo pondría la etiqueta de una semana encima de las cifras de otra. El ciclo
  // del 26 manda en ventas; aquí mandan los días que trae el dato.
  function hitoDe(period) {
    const [year, mes] = period.id.split('-').map(Number);
    const hoy = global.Ciclo ? global.Ciclo.hoyLima() : new Date().toISOString().slice(0, 10);
    const enCurso = period.id === hoy.slice(0, 7);
    const dia = enCurso ? Number(hoy.slice(8, 10)) : period.to;
    const dias = new Date(Date.UTC(year, mes, 0)).getUTCDate();
    return { hito: HITOS.find(item => dia <= item.hasta) || HITOS[HITOS.length - 1], dia, dias, enCurso };
  }

  function causa(cur, prev, tipo) {
    const gasto = prev.spend > 0 ? cur.spend / prev.spend - 1 : 0;
    const res = valorDe(prev, tipo) > 0 ? valorDe(cur, tipo) / valorDe(prev, tipo) - 1 : 0;
    if (res < 0 && gasto >= -0.05) return 'los resultados cayeron con la misma inversión: es la creatividad, no el presupuesto';
    if (gasto > 0.1 && res <= gasto) return 'la inversión subió más rápido que los resultados';
    return 'el costo por resultado se movió sin que cambiara la inversión';
  }

  // El formato sale de la pieza de la carpeta de artes, que el barrido ya trae al tablero.
  const claveArte = nombre => normalize(nombre).replace(/\.[a-z0-9]{2,5}$/, '').replace(/[^a-z0-9]+/g, '');

  // artes-2026.json guarda los meses en un objeto, no en una lista, y cada pieza es
  // { file, campana, driveId, kind }. La primera que aparece se queda: una pieza repetida en dos
  // meses es la misma pieza.
  function piezasDe() {
    const meses = state.artes?.months;
    const mapa = {};
    if (!meses || typeof meses !== 'object') return mapa;
    Object.values(meses).forEach(mes => {
      (mes?.artes || []).forEach(pieza => {
        const key = claveArte(pieza.file);
        if (key && !mapa[key]) mapa[key] = { tipo: pieza.kind, nombre: pieza.file };
      });
    });
    return mapa;
  }

  // ── El cálculo ─────────────────────────────────────────────────────────────
  function acciones(period) {
    if (!period) return [];
    const lista = [];
    const campanas = porCampana(period.filas);
    const anuncios = porAnuncio(period.filas);
    const prevCamp = period.prev ? new Map(porCampana(period.prev).map(c => [c.key, c])) : new Map();
    const prevAds = period.prev ? new Map(porAnuncio(period.prev).map(a => [a.key, a])) : new Map();
    const piezas = piezasDe();

    // 1 · Calibración.
    campanas.forEach(camp => {
      const prev = prevCamp.get(camp.key);
      if (!prev || camp.spend < GASTO_MINIMO) return;
      const tipo = tipoDe(camp);
      const ahora = costoDe(camp, tipo);
      const antes = costoDe(prev, tipo);
      if (!finite(ahora) || !finite(antes)) return;
      const cambio = ahora / antes - 1;
      if (cambio < CAMBIO_MINIMO) return;
      lista.push({
        id: `calibracion:${clave(camp.key)}`,
        hito: 'calibracion',
        tono: cambio >= 0.3 ? 'red' : 'amber',
        titulo: `Revisar ${corto(camp.campaign)}: cada ${tipo.uno} cuesta ${costo(ahora)}`,
        porque: `${pct(cambio)} contra el mismo tramo de ${period.labelPrev.toLowerCase()} (${costo(antes)}); ${causa(camp, prev, tipo)}.`,
        donde: `Administrador de anuncios › Campañas › ${camp.campaign}`,
      });
    });

    // 2 · Desgaste del arte.
    anuncios.forEach(ad => {
      if (ad.spend < GASTO_MINIMO) return;
      const tipo = tipoDe(ad);
      if (valorDe(ad, tipo) === 0) {
        lista.push({
          id: `seca:${clave(ad.key)}`,
          hito: 'desgaste',
          tono: 'red',
          titulo: `Pausar «${ad.ad}» o cambiar su pieza`,
          porque: `Lleva ${money(ad.spend)} del mes sin un solo resultado.`,
          donde: `Administrador de anuncios › Anuncios › ${ad.ad}`,
        });
        return;
      }
      const prev = prevAds.get(ad.key);
      if (prev && prev.reach > 0) {
        const ahora = costoDe(ad, tipo);
        const antes = costoDe(prev, tipo);
        if (finite(ahora) && finite(antes)) {
          const masCaro = ahora / antes - 1;
          const menosAlcance = ad.reach / prev.reach - 1;
          if (masCaro >= CAMBIO_MINIMO && menosAlcance <= -0.1) {
            lista.push({
              id: `desgaste:${clave(ad.key)}`,
              hito: 'desgaste',
              tono: 'amber',
              titulo: `Renovar «${ad.ad}»: cuesta ${pct(masCaro)} y llega a ${pct(menosAlcance)} de gente`,
              porque: `${costo(antes)} → ${costo(ahora)} por ${tipo.uno} con ${count(ad.reach)} de alcance (antes ${count(prev.reach)}): la misma pieza llegando a menos gente y más cara.`,
              donde: `Administrador de anuncios › Anuncios › ${ad.ad}`,
            });
            return;
          }
        }
      }
      if (finite(ad.frequency) && ad.frequency >= FRECUENCIA_ALTA) {
        lista.push({
          id: `frecuencia:${clave(ad.key)}`,
          hito: 'desgaste',
          tono: 'amber',
          titulo: `Renovar «${ad.ad}»: la misma gente ya la vio ${ad.frequency.toFixed(1)} veces`,
          porque: `${count(ad.impressions)} impresiones sobre ${count(ad.reach)} personas. Pasada la segunda vez, la pieza deja de sumar y empieza a cansar.`,
          donde: `Administrador de anuncios › Anuncios › ${ad.ad}`,
        });
      }
    });

    // 3 · Formato: video contra imagen dentro de la misma campaña.
    campanas.forEach(camp => {
      const tipo = tipoDe(camp);
      const suyos = anuncios.filter(ad => normalize(ad.campaign) === camp.key && valorDe(ad, tipo) > 0);
      if (suyos.length < 2) return;
      const porFormato = new Map();
      suyos.forEach(ad => {
        const arte = piezas[claveArte(ad.ad)];
        const tipoArte = arte?.tipo || arte?.type || '';
        const formato = /video/i.test(tipoArte) ? 'video' : tipoArte ? 'imagen' : '';
        if (!formato) return;
        const actual = porFormato.get(formato) || { spend: 0, valor: 0, ads: [] };
        actual.spend += ad.spend;
        actual.valor += valorDe(ad, tipo);
        actual.ads.push(ad);
        porFormato.set(formato, actual);
      });
      if (porFormato.size < 2) return;
      const ranking = [...porFormato.entries()]
        .map(([formato, item]) => ({ formato, ...item, costo: item.spend / item.valor }))
        .sort((left, right) => left.costo - right.costo);
      const mejor = ranking[0];
      const peor = ranking[ranking.length - 1];
      // Mover S/ 13 de un formato a otro no es una acción, es ruido.
      if (peor.costo < mejor.costo * (1 + CAMBIO_MINIMO) || peor.spend < GASTO_MINIMO) return;
      lista.push({
        id: `formato:${clave(camp.key)}`,
        hito: 'formato',
        tono: 'amber',
        titulo: `Mover inversión de ${peor.formato} a ${mejor.formato} en ${corto(camp.campaign)}`,
        porque: `En ${mejor.formato} cada ${tipo.uno} sale ${costo(mejor.costo)} y en ${peor.formato} ${costo(peor.costo)}; hoy ${peor.formato} se lleva ${money(peor.spend)}.`,
        donde: `Administrador de anuncios › Conjuntos de ${camp.campaign} › Presupuesto`,
      });
      const lider = mejor.ads.sort((left, right) => costoDe(left, tipo) - costoDe(right, tipo))[0];
      if (lider) {
        lista.push({
          id: `variaciones:${clave(lider.key)}`,
          hito: 'formato',
          tono: 'green',
          titulo: `Producir variaciones de «${lider.ad}»`,
          porque: `Es la pieza más barata de ${corto(camp.campaign)}: ${costo(costoDe(lider, tipo))} por ${tipo.uno}.`,
          donde: `Administrador de anuncios › Anuncios › ${lider.ad}`,
        });
      }
    });

    // 4 · Escalar y repetir.
    campanas.forEach(camp => {
      const prev = prevCamp.get(camp.key);
      if (!prev || camp.spend < GASTO_MINIMO) return;
      const tipo = tipoDe(camp);
      const ahora = costoDe(camp, tipo);
      const antes = costoDe(prev, tipo);
      if (!finite(ahora) || !finite(antes)) return;
      const cambio = ahora / antes - 1;
      if (cambio > -CAMBIO_MINIMO) return;
      const dias = new Set(camp.filas.map(row => row.d)).size || 1;
      const diario = camp.spend / dias;
      lista.push({
        id: `escalar:${clave(camp.key)}`,
        hito: 'escalar',
        tono: 'green',
        titulo: `Subir la inversión de ${corto(camp.campaign)} de ${money(diario)} a ${money(diario * 1.2)} por día`,
        porque: `Su costo por ${tipo.uno} bajó ${Math.round(Math.abs(cambio) * 100)}% (${costo(antes)} → ${costo(ahora)}): es donde el dinero rinde mejor este mes.`,
        donde: `Administrador de anuncios › Campañas › ${camp.campaign} › Presupuesto`,
      });
    });

    return lista;
  }

  // ── Pintado ────────────────────────────────────────────────────────────────
  function pintar() {
    const host = document.getElementById('acciones-lista');
    if (!host) return;
    const sub = document.getElementById('acciones-sub');
    const nota = document.getElementById('acciones-nota');
    const estado = document.getElementById('acciones-estado');
    cargar();

    const period = periodo(state.datos);
    if (!period) {
      host.innerHTML = '<p class="acciones-vacio">Sin datos de Meta Ads para sugerir acciones.</p>';
      if (estado) estado.textContent = '';
      return;
    }

    const { hito, dia, dias, enCurso } = hitoDe(period);
    const lista = acciones(period).sort((left, right) => {
      const suyo = item => (item.hito === hito.key ? -1 : ORDEN.indexOf(item.hito));
      const tono = { red: 0, amber: 1, green: 2 };
      return suyo(left) - suyo(right) || tono[left.tono] - tono[right.tono];
    });

    if (sub) {
      sub.textContent = `${hito.semana} · ${hito.titulo}. ${enCurso ? `Día ${dia} de ${dias} del ciclo` : `${period.label} ya cerró: se lee con su último día`}.`;
    }
    const contar = () => lista.filter(item => marcada(period.id, item.id)).length;
    if (estado) estado.textContent = lista.length ? `${contar()} de ${lista.length} hechas` : '';
    if (nota) {
      nota.textContent = 'Las semanas van por mes de calendario, que es como viene la descarga de Meta; el cierre del 26 manda en ventas, no acá. Lo marcado se guarda solo en este navegador: otra persona no lo ve. Google Ads va por Nexus; acá solo Meta.';
    }

    if (!lista.length) {
      host.innerHTML = `<p class="acciones-vacio">Nada que corregir con las cifras de ${esc(period.label.toLowerCase())}: ninguna campaña se salió de su costo y ninguna pieza muestra desgaste.</p>`;
      return;
    }

    host.innerHTML = lista.map(item => {
      const hecha = marcada(period.id, item.id);
      const suHito = HITOS.find(h => h.key === item.hito);
      return `
        <label class="accion ${esc(item.tono)}${hecha ? ' hecha' : ''}">
          <input type="checkbox" data-accion="${esc(item.id)}"${hecha ? ' checked' : ''}>
          <span class="accion-cuerpo">
            <span class="accion-titulo">${esc(item.titulo)}</span>
            <span class="accion-porque">${esc(item.porque)}</span>
            <span class="accion-donde">${esc(item.donde)}</span>
          </span>
          <span class="accion-hito">${esc(suHito ? suHito.titulo : item.hito)}</span>
        </label>`;
    }).join('');

    host.querySelectorAll('[data-accion]').forEach(input => {
      input.addEventListener('change', () => {
        marcar(period.id, input.dataset.accion, input.checked);
        input.closest('.accion')?.classList.toggle('hecha', input.checked);
        if (estado) estado.textContent = `${contar()} de ${lista.length} hechas`;
      });
    });
  }

  // Los datos son los mismos del módulo Gasto publicitario: una sola carga para los dos.
  function init() {
    if (state.datos) { pintar(); return; }
    const pedidos = [global.Gasto ? global.Gasto.load() : Promise.resolve(null)];
    pedidos.push(global.RB_ARTES_DATA
      ? Promise.resolve(global.RB_ARTES_DATA)
      : fetch('data/artes-2026.json', { cache: 'no-store' }).then(res => (res.ok ? res.json() : null)).catch(() => null));
    Promise.all(pedidos).then(([datos, artes]) => {
      state.datos = datos;
      state.artes = artes;
      pintar();
    });
  }

  global.Acciones = { init, render: pintar, acciones };
})(typeof self !== 'undefined' ? self : this);
