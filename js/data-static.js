/* ============================================================
   Datos estáticos — no cambian con el pipeline de Sheets.
   Expone window.DataStatic con:
     - channels, palette, palette de tipos de prenda
     - d2025, defaultTargets, monthDays
     - productos: top unidades / ingreso / ticket / tipos
     - copurchase, nextSales, multiData, bundleIdeas
   ============================================================ */

(function (global) {
  const channels = ['Tienda', 'Web', 'WhatsApp', 'Showroom', 'Instagram', 'Facebook'];

  const palette = {
    Tienda:    '#2563EB',
    Web:       '#7C3AED',
    WhatsApp:  '#059669',
    Showroom:  '#D97706',
    Instagram: '#DB2777',
    Facebook:  '#64748B',
  };

  const typeColors = ['#2563EB', '#7C3AED', '#059669', '#D97706', '#DB2777', '#65A30D', '#94A3B8'];

  // Fallback 2025: datos conocidos por mes. El pipeline sobreescribe estos
  // valores con d2025_live cuando viene del sheet (ver main.js adoptLive2025).
  const d2025 = {
    Enero:      { Tienda: 44745.56, Web:  8196.80, WhatsApp: 1219.44, Showroom: 0, Instagram: 227.20, Facebook: 0 },
    Febrero:    { Tienda: 48628.60, Web:  9726.80, WhatsApp: 3510.80, Showroom: 0, Instagram: 0,      Facebook: 0 },
    Marzo:      { Tienda: 63861.93, Web: 13518.50, WhatsApp: 3459.60, Showroom: 0, Instagram: 182.40, Facebook: 0 },
    Abril:      { Tienda: 54762.89, Web:  9316.54, WhatsApp: 5367.70, Showroom: 0, Instagram: 0,      Facebook: 0 },
    Mayo:       { Tienda: 0, Web: 0, WhatsApp: 0, Showroom: 0, Instagram: 0, Facebook: 0 },
    Junio:      { Tienda: 0, Web: 0, WhatsApp: 0, Showroom: 0, Instagram: 0, Facebook: 0 },
    Julio:      { Tienda: 0, Web: 0, WhatsApp: 0, Showroom: 0, Instagram: 0, Facebook: 0 },
    Agosto:     { Tienda: 0, Web: 0, WhatsApp: 0, Showroom: 0, Instagram: 0, Facebook: 0 },
    Septiembre: { Tienda: 0, Web: 0, WhatsApp: 0, Showroom: 0, Instagram: 0, Facebook: 0 },
    Octubre:    { Tienda: 0, Web: 0, WhatsApp: 0, Showroom: 0, Instagram: 0, Facebook: 0 },
    Noviembre:  { Tienda: 0, Web: 0, WhatsApp: 0, Showroom: 0, Instagram: 0, Facebook: 0 },
    Diciembre:  { Tienda: 0, Web: 0, WhatsApp: 0, Showroom: 0, Instagram: 0, Facebook: 0 },
  };

  const defaultTargets = {
    Enero:      { Tienda: 49220, Web:  9016, WhatsApp: 1341, Showroom: 0, Instagram:  250, Facebook: 0 },
    Febrero:    { Tienda: 53491, Web: 10699, WhatsApp: 3862, Showroom: 0, Instagram:    0, Facebook: 0 },
    Marzo:      { Tienda: 70248, Web: 14870, WhatsApp: 3806, Showroom: 0, Instagram:  201, Facebook: 0 },
    Abril:      { Tienda: 60239, Web: 10248, WhatsApp: 5904, Showroom: 0, Instagram:    0, Facebook: 0 },
    Mayo:       { Tienda: 57970, Web: 18809, WhatsApp: 1328, Showroom: 0, Instagram:  486, Facebook: 0 },
    Junio:      { Tienda: 75987, Web: 15394, WhatsApp:  356, Showroom: 0, Instagram:  164, Facebook: 0 },
    Julio:      { Tienda: 53784, Web: 11402, WhatsApp: 4636, Showroom: 0, Instagram:  758, Facebook: 0 },
    Agosto:     { Tienda: 74564, Web: 19449, WhatsApp: 4334, Showroom: 0, Instagram:  999, Facebook: 0 },
    Septiembre: { Tienda: 66740, Web: 22677, WhatsApp: 6172, Showroom: 0, Instagram:    0, Facebook: 0 },
    Octubre:    { Tienda: 70703, Web: 11653, WhatsApp: 3843, Showroom: 0, Instagram:  674, Facebook: 0 },
    Noviembre:  { Tienda: 87765, Web: 22501, WhatsApp: 6452, Showroom: 0, Instagram: 2005, Facebook: 0 },
    Diciembre:  { Tienda: 85443, Web: 18049, WhatsApp: 6380, Showroom: 0, Instagram: 1122, Facebook: 0 },
  };

  const monthDays = {
    Enero: 31, Febrero: 28, Marzo: 31, Abril: 30,
    Mayo: 31, Junio: 30, Julio: 31, Agosto: 31,
    Septiembre: 30, Octubre: 31, Noviembre: 30, Diciembre: 31,
  };
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril',
    'Mayo', 'Junio', 'Julio', 'Agosto',
    'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];
  // Meses de 2026 que ya tienen datos cerrados/en curso (el pipeline solo
  // lee estos del sheet). Se expanden conforme 2026 avanza.
  const monthsWith2026Data = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo'];

  const STEP = 500;

  // ── Productos web ────────────────────────────────────────────────
  const prodTopUnits = [
    { name: 'Vestido Rayas Niña Lucca',     uds: 7 },
    { name: 'Vestido Niña Cuadros Capri',   uds: 7 },
    { name: 'Vestido Prune',                uds: 5 },
    { name: 'Vestido Niña Sweet Summer',    uds: 4 },
    { name: 'Ranita Tirantes Tela Mawl',    uds: 4 },
    { name: 'Conj. C. Bombacho Prune',      uds: 4 },
    { name: 'Vestido Estampado Momo',       uds: 4 },
    { name: 'Conj. C. Bombacho Marsala',    uds: 4 },
  ];

  const prodTopRev = [
    { name: 'Vestido Niña Cuadros Capri',   rev: 1561.35 },
    { name: 'Vestido Nice',                 rev:  923.05 },
    { name: 'Conj. Camisa Bombacho Marsala',rev:  836.18 },
    { name: 'Jesusito Estampado Tolouse',   rev:  835.09 },
    { name: 'Vestido Rayas Niña Lucca',     rev:  785.49 },
    { name: 'Jesusito Niña Capri',          rev:  756.94 },
  ];

  const prodTopTicket = [
    { name: 'Vestido Nice',                 tk: 308 },
    { name: 'Vestido Niña Siena',           tk: 296 },
    { name: 'Jesusito Estampado Tolouse',   tk: 278 },
    { name: 'Vestido Estampado Verona',     tk: 270 },
    { name: 'Jesusito Niña Portofino',      tk: 236 },
  ];

  const prodTypes = [
    { type: 'Vestido',            uds: 75 },
    { type: 'Jesusito',           uds: 39 },
    { type: 'Conjunto',           uds: 33 },
    { type: 'Pantalón/Bombacho',  uds: 29 },
    { type: 'Pelele/Ranita/Peto', uds: 25 },
    { type: 'Jersey/Cardigan',    uds: 21 },
    { type: 'Otros',              uds: 16 },
  ];

  const copurchaseData = [
    {
      title: 'Bebé + Jesusitos', icon: '👶', tone: 'brand',
      desc: '35 uds · S/. 5,109',
      detail: 'Clúster más fuerte. Quien compra Jesusito suele agregar Pelele o Ranita de la misma colección.',
    },
    {
      title: 'Sale + Verano', icon: '☀️', tone: 'amber',
      desc: '63 uds · S/. 6,684',
      detail: 'Mayor volumen de unidades. Base activa de compradores sensibles a precio — oportunidad para up-sell a precio completo.',
    },
    {
      title: 'Ocasiones Especiales', icon: '🎀', tone: 'purple',
      desc: '24 uds · S/. 4,031 · ticket S/. 296',
      detail: 'Tickets más altos del catálogo. Compra motivada por evento (bautizo, cumpleaños) con alta recurrencia estacional.',
    },
  ];

  const nextSales = [
    { trigger: 'Compra Jesusito',              suggest: 'Pelele Punto o Ranita de la misma colección',        why: 'Alta coherencia de colección — misma paleta y marca Martín Aranda.' },
    { trigger: 'Compra Vestido Niña',          suggest: 'Cardigan/Jersey coordinado + Complementos',          why: 'Solo 21 uds de knitwear vendidas — espacio amplio para cross-sell en cada venta de vestido.' },
    { trigger: 'Compra en Sale/Verano',        suggest: 'Preview de colección Invierno al cierre de temporada', why: '63 uds en sale = base activa dispuesta a comprar con adelanto.' },
    { trigger: 'Compra Ocasión Especial',      suggest: 'Royal Boxes o pack regalo + Complementos',           why: 'Ticket promedio S/. 296 — cliente ya está en modo regalo, incrementar con packaging premium.' },
    { trigger: 'Compra Conjunto Bebé',         suggest: 'Primera Puesta o Pelele de la misma línea',          why: 'Conjuntos en Ocasiones Especiales: cliente busca completar el look.' },
    { trigger: 'Alta rotación (ratio > 1.3×)', suggest: 'Bundle de 2 tallas con descuento',                   why: 'Patrón de compra por crecimiento del bebé — facilitar la decisión con pack.' },
  ];

  const multiData = [
    { name: 'Conj. Camisa Bombacho Prune', uds: 4, ped: 2, ratio: 2.0,  rev: 413.75, why: '2 tallas · regalo doble' },
    { name: 'Vestido Niña Siena',          uds: 3, ped: 2, ratio: 1.5,  rev: 591.52, why: 'tallas consecutivas' },
    { name: 'Pelele Punto Unisex Capri',   uds: 3, ped: 2, ratio: 1.5,  rev: 389.66, why: 'tallas consecutivas' },
    { name: 'Jersey Niño Chambray',        uds: 3, ped: 2, ratio: 1.5,  rev: 202.38, why: 'tallas consecutivas' },
    { name: 'Jersey Unisex Fresonara',     uds: 3, ped: 2, ratio: 1.5,  rev: 256.27, why: 'tallas consecutivas' },
    { name: 'Vestido Niña Sweet Summer',   uds: 4, ped: 3, ratio: 1.33, rev: 432.56, why: '3 tallas · regalo' },
    { name: 'Peto Tela Niño Salve',        uds: 4, ped: 3, ratio: 1.33, rev: 404.76, why: '3 tallas' },
  ];

  const bundleIdeas = [
    {
      icon: '👕', color: 'var(--brand)', tag: 'Bundle tallas',
      title: 'Pack Crecimiento 3M + 6M',
      products: ['Pelele Punto Unisex Capri', 'Jersey Unisex Fresonara', 'Conj. Camisa Bombacho Prune'],
      mechanic: 'Mismo producto en 2 tallas consecutivas con 8–10% de descuento',
      ticket: 'S/. 280 – S/. 420',
      why: 'Ya lo hacen solos — facilitar la decisión con precio especial y lo convierte en acción de marketing.',
    },
    {
      icon: '🎀', color: 'var(--purple)', tag: 'Bundle regalo',
      title: 'Pack Ocasión Especial',
      products: ['Jesusito Niña Capri / Verona', 'Pelele coordinado', 'Calcetín o babero'],
      mechanic: 'Jesusito + accesorio a juego en packaging de regalo (Royal Box)',
      ticket: 'S/. 250 – S/. 350',
      why: 'Ticket de Ocasiones Especiales ya es S/. 296 promedio — el packaging premium justifica precio sin descuento.',
    },
    {
      icon: '👗', color: 'var(--amber)', tag: 'Bundle look completo',
      title: 'Look Niña: Vestido + Cardigan',
      products: ['Vestido Niña Cuadros Capri / Nice', 'Jersey o Cardigan coordinado'],
      mechanic: 'Vestido + knitwear de la misma colección con 5% descuento en el segundo ítem',
      ticket: 'S/. 280 – S/. 400',
      why: 'Solo 21 uds de jersey vendidas vs 75 de vestidos — enorme oportunidad de cross-sell ya captada en tienda física.',
    },
    {
      icon: '🧸', color: 'var(--green)', tag: 'Bundle bebé completo',
      title: 'Canastilla Bebé Martín Aranda',
      products: ['Jesusito + Pelele/Ranita', 'Babero + Calcetín de la línea'],
      mechanic: 'Pack de 4 piezas coordinadas con precio cerrado (ej. S/. 350)',
      ticket: 'S/. 320 – S/. 380',
      why: 'Bebé representa el 36% del ingreso web — un pack canastilla captura al cliente regalo de una sola vez.',
    },
    {
      icon: '☀️', color: 'var(--amber)', tag: 'Bundle liquidación',
      title: 'Pack Sale + Temporada',
      products: ['2 piezas Sale/Verano (ej. Vestido + Ranita)', 'de la misma talla o colección'],
      mechanic: '2 piezas Sale con 15% sobre el total — mínimo 2 SKUs distintos',
      ticket: 'S/. 180 – S/. 260',
      why: '63 uds vendidas en Sale/Verano = base activa. El bundle evita descuentos individuales y mueve stock rápido.',
    },
    {
      icon: '🎁', color: '#64748B', tag: 'Bundle regalo adulto',
      title: 'Gift Card + Prenda Ancla',
      products: ['Vestido Nice o Jesusito Tolouse', 'Gift Card de S/. 50 incluida'],
      mechanic: 'Producto de ticket alto (S/. 280+) con Gift Card para próxima compra',
      ticket: 'S/. 330 – S/. 360',
      why: 'Retiene al cliente: quien recibe un regalo de bebé suele volver. La gift card cierra el ciclo.',
    },
  ];

  // Canal ↔ CHANNEL (upper) mapping del sheet
  const chToUpper = {
    Tienda: 'TIENDA', Web: 'WEB', WhatsApp: 'WHATSAPP',
    Showroom: 'SHOWROOM', Instagram: 'INSTAGRAM', Facebook: 'FACEBOOK',
  };

  global.DataStatic = {
    channels, palette, typeColors,
    d2025, defaultTargets, monthDays, months, monthsWith2026Data,
    STEP,
    prodTopUnits, prodTopRev, prodTopTicket, prodTypes,
    copurchaseData, nextSales, multiData, bundleIdeas,
    chToUpper,
  };
})(window);
