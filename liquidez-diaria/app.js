/* =========================================================================
   Liquidez diaria — Monitor Monetario Argentina
   Módulo 1: Liquidez diaria
   Fuente exclusiva de datos: API oficial del BCRA v4.0
   (https://api.bcra.gob.ar/estadisticas/v4.0/monetarias)

   Reglas duras de este módulo (no relajar sin aprobación explícita):
   - Cero datos ficticios / mock / hardcodeados. Todo valor sale de la API.
   - Si un dato no está disponible: mostrar "Dato no disponible". Nunca
     interpolar, nunca forward-fill, nunca inventar un valor para "cerrar"
     una fecha.
   - No confundir stock con flujo. ID 63 (flujo, variación diaria) e ID 70
     (saldo, nivel) son vistas alternativas del mismo panel: nunca se
     combinan ni se tratan como equivalentes.
   - ID 198 es un control analítico separado (saldo). No se usa para
     descomponer "Otros factores" (ID 59, flujo). El overlay opcional
     Δ ID198 es un estudio de asociación, no una identidad contable ni una
     etiqueta sobre la composición de "Otros".
   - La conciliación (suma de factores vs ΔBM) es un control de calidad de
     datos, no una explicación económica de "Otros".
   ========================================================================= */

(() => {
  'use strict';

  // -----------------------------------------------------------------------
  // 0. Configuración
  // -----------------------------------------------------------------------

  const API_BASE = 'https://api.bcra.gob.ar/estadisticas/v4.0/monetarias';
  // Fecha de inicio para traer el historial completo disponible (soporta la
  // opción de período "Máx."). Se pide siempre el máximo posible; cada serie
  // devuelve lo que la API tenga informado, sin forzar continuidad.
  const HISTORY_DESDE = '2003-01-01';
  const FETCH_PAGE_LIMIT = 3000;
  const FETCH_SAFETY_CAP = 20000; // salvaguarda ante una paginación anómala
  const RECONCILIATION_TOLERANCE = 1; // millones de ARS, por redondeo
  const FUENTE_OFICIAL = 'Banco Central de la República Argentina (BCRA)';

  // Ventanas del selector de período, en cantidad de observaciones (días
  // hábiles) sobre el índice temporal ya construido — no en días de
  // calendario, para no arrastrar fines de semana/feriados. "Máx." muestra
  // todo el historial disponible en el índice de fechas del gráfico.
  const PERIODS = {
    '1M': 21,
    '3M': 63,
    '6M': 126,
    '1A': 252,
    'Máx.': Infinity,
  };

  // Tipos de evento previstos para una fase posterior (licitaciones del
  // Tesoro). Estructura lista, sin datos: no se inventan fechas ni eventos.
  const EVENT_TYPES = ['AUCTION', 'SETTLEMENT', 'MATURITY', 'BCRA_POLICY', 'FX_EVENT'];
  /** @type {Array<{date:string, type:string, label:string, description?:string}>} */
  const EVENTS = []; // intencionalmente vacío en esta etapa

  // -----------------------------------------------------------------------
  // 1. Registro de series — trazabilidad obligatoria (sección 10 del spec)
  // -----------------------------------------------------------------------
  // Cada serie conserva: id BCRA, nombre oficial (tal cual figura en el
  // listado del BCRA, sin corregir erratas), nombre de display, tipoSerie,
  // periodicidad, unidad, rol dentro del módulo y si se muestra en el
  // frontend. "role" determina en qué gráfico/cálculo participa.

  const SERIES = {
    64: {
      id: 64, nombreOficial: 'Base monetaria', display: 'Δ Base Monetaria',
      tipoSerie: 'Variación diaria de saldos', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'resultado-bm', frontend: true,
    },
    63: {
      id: 63, nombreOficial: 'Cuentas corrientes en pesos en el BCRA', display: 'Variación diaria de cuentas corrientes bancarias en el BCRA',
      tipoSerie: 'Variación diaria de saldos', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'resultado-cc-flujo', frontend: true,
    },
    46: {
      id: 46, nombreOficial: 'Total de factores de explicación de la base monetaria', display: 'Total factores (oficial BCRA)',
      tipoSerie: 'Flujo diario', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'conciliacion-total', frontend: false,
    },
    47: {
      id: 47, nombreOficial: 'Efecto monetario de las compras netas de divisas al sector privado y otros', display: 'FX sector privado y otros',
      tipoSerie: 'Flujo diario', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'factor', grupo: 'fx_priv', frontend: true,
    },
    48: {
      id: 48, nombreOficial: 'Efecto monetario de las compras netas de divisas al tesoro nacional', display: 'FX con el Tesoro',
      tipoSerie: 'Flujo diario', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'factor', grupo: 'fx_tesoro', frontend: true,
    },
    49: {
      id: 49, nombreOficial: 'Efecto monetario de los adelantos transitorios al tesoro nacional', display: 'Adelantos transitorios al Tesoro',
      tipoSerie: 'Flujo diario', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'factor', grupo: 'tesoro', frontend: false,
    },
    50: {
      id: 50, nombreOficial: 'Efecto monetario de las transferencia de utilidades al tesoro nacional', display: 'Transferencia de utilidades al Tesoro',
      tipoSerie: 'Flujo diario', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'factor', grupo: 'tesoro', frontend: false,
    },
    51: {
      id: 51, nombreOficial: 'Efecto monetario del resto de operaciones con el tesoro nacional', display: 'Resto de operaciones con el Tesoro',
      tipoSerie: 'Flujo diario', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'factor', grupo: 'tesoro', frontend: false,
    },
    52: {
      id: 52, nombreOficial: 'Efecto monetario de las operaciones de pases', display: 'Operaciones de pases (histórico)',
      tipoSerie: 'Flujo diario', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'factor-historico', frontend: false,
    },
    53: {
      id: 53, nombreOficial: 'Efecto monetario de las LELIQ y NOTALQ', display: 'LELIQ y NOTALIQ (histórico)',
      tipoSerie: 'Flujo diario', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'factor-historico', frontend: false,
    },
    54: {
      id: 54, nombreOficial: 'Efecto monetario de los redescuentos y adelantos', display: 'Redescuentos y adelantos (histórico)',
      tipoSerie: 'Flujo diario', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'factor-historico', frontend: false,
    },
    55: {
      id: 55, nombreOficial: 'Efecto monetario de los interéses, primas y remuneración de cuentas corrientes asociados a op. de pases, LELIQ, NOTALQ, redescuentos y adel.', display: 'Intereses, primas y remun. ctas. ctes. (histórico)',
      tipoSerie: 'Flujo diario', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'factor-historico', frontend: false,
    },
    56: {
      id: 56, nombreOficial: 'Efecto monetario de las LEBAC y NOBAC', display: 'LEBAC y NOBAC (histórico)',
      tipoSerie: 'Flujo diario', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'factor-historico', frontend: false,
    },
    57: {
      id: 57, nombreOficial: 'Efecto monetario del rescate de cuasimonedas', display: 'Rescate de cuasimonedas (histórico)',
      tipoSerie: 'Flujo diario', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'factor-historico', frontend: false,
    },
    58: {
      id: 58, nombreOficial: 'Efecto monetario de las operaciones con letras fiscales de liquidez', display: 'Operaciones con LEFI (histórico)',
      tipoSerie: 'Flujo diario', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'factor-historico', frontend: false,
    },
    59: {
      id: 59, nombreOficial: 'Efecto monetario de otras operaciones que explican la variación de la base monetaria', display: 'Otros factores',
      tipoSerie: 'Flujo diario', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'factor', grupo: 'otros', frontend: true,
    },
    70: {
      id: 70, nombreOficial: 'Cuentas corrientes en pesos en el BCRA', display: 'Saldo de cuentas corrientes bancarias en el BCRA',
      tipoSerie: 'Saldos', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'resultado-cc-nivel', frontend: true,
    },
    71: {
      id: 71, nombreOficial: 'Base monetaria', display: 'Saldo Base Monetaria (control)',
      tipoSerie: 'Saldos', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'control-stock', frontend: false,
    },
    148: {
      id: 148, nombreOficial: 'Tasa de interés de préstamos entre entidades financieras locales', display: 'Call en pesos (hasta 15 días)',
      tipoSerie: 'Tasa de interés', periodicidad: 'D', unidad: '% nominal anual (TNA)',
      role: 'tasa', frontend: true,
    },
    150: {
      id: 150, nombreOficial: 'Tasa de interés por operaciones de pases entre terceros a 1 día', display: 'REPO 1 día (pases entre terceros)',
      tipoSerie: 'Tasa de interés', periodicidad: 'D', unidad: '% nominal anual (TNA)',
      role: 'tasa', frontend: true,
    },
    135: {
      id: 135, nombreOficial: 'Tasa de interés de referencia de depósitos a plazo fijo de 30 a 35 días de pesos por más de un millón de pesos (TAMAR)', display: 'TAMAR',
      tipoSerie: 'Tasa de interés', periodicidad: 'D', unidad: '% nominal anual (TNA)',
      role: 'tasa-mayorista', frontend: true,
    },
    198: {
      id: 198, nombreOficial: 'Otros', display: 'Posición neta de operaciones de corto plazo del BCRA',
      tipoSerie: 'Saldos', periodicidad: 'D', unidad: 'Millones de ARS',
      role: 'control-analitico', frontend: false,
    },
  };

  const ALL_IDS = Object.keys(SERIES).map(Number);
  // Componentes oficiales que deben sumar para reconstruir la identidad
  // contable de la Base Monetaria (todo lo que compone el "Total" oficial,
  // ID 46, excepto 46 mismo).
  const RECONCILIATION_COMPONENT_IDS = [47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59];
  const TESORO_COMPONENT_IDS = [49, 50, 51];

  // Tasas de corto plazo mostradas en el panel 2B — fuente única de verdad
  // para el gráfico, la leyenda y las fechas de actualización. Orden fijo:
  // REPO 1 día | Call | TAMAR. TAMAR se distingue visual y conceptualmente
  // (línea punteada, grupo "mayorista") porque representa fondeo bancario
  // mayorista a ~30 días, no liquidez overnight. No se calculan spreads.
  const RATES_SERIES = [
    { key: 'repo', id: 150, label: 'REPO 1 día (pases entre terceros)', color: 'var(--series-repo)', group: 'overnight' },
    { key: 'call', id: 148, label: 'Call en pesos (hasta 15 días)', color: 'var(--series-call)', group: 'overnight' },
    {
      key: 'tamar', id: 135, label: 'TAMAR', color: 'var(--series-tamar)', group: 'mayorista', dashed: true,
      info: 'TAMAR representa fondeo bancario mayorista a aproximadamente un mes (30 a 35 días), no liquidez overnight. No se calculan spreads entre estas tasas.',
    },
  ];

  // -----------------------------------------------------------------------
  // 2. Utilidades de fecha / formato
  // -----------------------------------------------------------------------

  function isoDate(d) {
    return d.toISOString().slice(0, 10);
  }

  function todayISO() {
    return isoDate(new Date());
  }

  function formatDMY(iso) {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  const nfMillones = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
  const nfDecimal1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const nfDecimal2 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  // Formatea un valor en millones de ARS eligiendo la unidad legible
  // (millones / miles de millones / billones) SIN alterar el dato
  // original almacenado (siempre se guarda y calcula en millones).
  function formatARS(valorEnMillones) {
    if (valorEnMillones === null || valorEnMillones === undefined || Number.isNaN(valorEnMillones)) {
      return 'Dato no disponible';
    }
    const abs = Math.abs(valorEnMillones);
    const signo = valorEnMillones < 0 ? '-' : '';
    if (abs >= 1_000_000) {
      return `${signo}${nfDecimal2.format(abs / 1_000_000)} billones`;
    }
    if (abs >= 1_000) {
      return `${signo}${nfDecimal1.format(abs / 1_000)} mil M`;
    }
    return `${signo}${nfMillones.format(abs)} M`;
  }

  function formatARSCompactAxis(valorEnMillones) {
    const abs = Math.abs(valorEnMillones);
    const signo = valorEnMillones < 0 ? '-' : '';
    if (abs >= 1_000_000) return `${signo}${nfDecimal1.format(abs / 1_000_000)}B`;
    if (abs >= 1_000) return `${signo}${nfDecimal1.format(abs / 1_000)}mM`;
    return `${signo}${nfMillones.format(abs)}M`;
  }

  function formatPct(valor) {
    if (valor === null || valor === undefined || Number.isNaN(valor)) return 'Dato no disponible';
    return `${nfDecimal2.format(valor)}% TNA`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  // -----------------------------------------------------------------------
  // 3. Fetch a la API oficial del BCRA (v4.0 — NO usar v3.0)
  // -----------------------------------------------------------------------

  /**
   * Trae una serie completa desde la API oficial, paginando con
   * limit/offset hasta agotar el rango o el total informado por la propia
   * API. Nunca fabrica datos: ante cualquier falla en la primera página
   * (red, CORS, HTTP, formato) devuelve ok:false y el llamador debe mostrar
   * "Dato no disponible". Si falla una página posterior a la primera, se
   * conserva lo ya obtenido (datos reales, no fabricados) en lugar de
   * descartarlo.
   */
  async function fetchSeries(id, desde, hasta) {
    let offset = 0;
    const detalle = [];
    try {
      while (true) {
        const url = `${API_BASE}/${id}?desde=${desde}&hasta=${hasta}&limit=${FETCH_PAGE_LIMIT}&offset=${offset}`;
        let resp;
        try {
          resp = await fetch(url, { headers: { Accept: 'application/json' } });
        } catch (err) {
          if (detalle.length) break; // ya tenemos datos reales de páginas previas
          return { id, ok: false, error: (err && err.message) || 'Error de red/CORS', points: [] };
        }
        if (!resp.ok) {
          if (detalle.length) break;
          return { id, ok: false, error: `HTTP ${resp.status}`, points: [] };
        }
        const body = await resp.json();
        const page = body?.results?.[0]?.detalle;
        if (!Array.isArray(page)) {
          if (detalle.length) break;
          return { id, ok: false, error: 'Respuesta sin detalle', points: [] };
        }
        detalle.push(...page);
        const count = body?.metadata?.resultset?.count;
        offset += page.length;
        const total = typeof count === 'number' ? count : offset;
        if (page.length === 0 || page.length < FETCH_PAGE_LIMIT || offset >= total || offset >= FETCH_SAFETY_CAP) break;
      }
      // r.valor puede venir null (la API lo usa como placeholder en días sin
      // dato, p.ej. fines de semana/feriados dentro del rango consultado).
      // Number(null) === 0, así que null/undefined/'' se mapean explícitamente
      // a NaN para que el filtro los descarte como "sin dato" en vez de
      // fabricar un cero.
      const points = detalle
        .map((r) => {
          const raw = r.valor;
          const value = typeof raw === 'number' ? raw : (raw === null || raw === undefined || raw === '' ? NaN : Number(raw));
          return { date: r.fecha, value };
        })
        .filter((p) => p.date && Number.isFinite(p.value))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      return { id, ok: true, points };
    } catch (err) {
      // Falla de red o de CORS: el navegador no distingue el motivo exacto.
      return { id, ok: false, error: (err && err.message) || 'Error de red/CORS', points: [] };
    }
  }

  async function fetchAllSeries() {
    const desde = HISTORY_DESDE;
    const hasta = todayISO();
    const results = await Promise.all(ALL_IDS.map((id) => fetchSeries(id, desde, hasta)));
    const byId = {};
    results.forEach((r) => { byId[r.id] = r; });
    return byId;
  }

  // Convierte points [{date,value}] a un Map fecha->valor para lookup O(1).
  function toMap(points) {
    const m = new Map();
    for (const p of points) m.set(p.date, p.value);
    return m;
  }

  // -----------------------------------------------------------------------
  // 4. Estado de la aplicación
  // -----------------------------------------------------------------------

  const state = {
    raw: {},          // id -> {ok, points, error}
    maps: {},         // id -> Map(fecha->valor)
    delta198Map: new Map(), // fecha -> ID198(t) - ID198(t-1), calculado sobre fechas propias de la serie
    period: '3M',
    ccView: 'flujo',   // 'flujo' (ID 63, variación diaria) | 'saldo' (ID 70, nivel)
    analysisOverlay198: false, // off por defecto — overlay analítico Δ ID198 sobre "Otros factores"
    visibility: {
      chart1: { fx_priv: true, fx_tesoro: true, tesoro: true, otros: true, bm: true },
      chart2rates: { repo: true, call: true, tamar: true },
    },
  };

  // -----------------------------------------------------------------------
  // 5. Construcción de series derivadas (Tesoro = 49+50+51; Δ ID198)
  // -----------------------------------------------------------------------

  function sumSeriesAt(ids, date) {
    let sum = null;
    for (const id of ids) {
      const v = state.maps[id]?.get(date);
      if (v !== undefined) {
        sum = (sum ?? 0) + v;
      }
    }
    return sum; // null si NINGUNO de los componentes tiene dato ese día
  }

  // Δ posición neta de operaciones de corto plazo del BCRA = ID198(t) -
  // ID198(t-1), calculado sobre fechas CONSECUTIVAS de la propia serie 198
  // (no sobre el índice de otro gráfico), para no comparar contra un hueco.
  // Es un control analítico: no se afirma que corresponda a compras/ventas
  // de títulos, mercado secundario ni operaciones simultáneas.
  function computeDelta198Map() {
    const map = new Map();
    const pts = state.raw[198]?.points || [];
    for (let i = 1; i < pts.length; i++) {
      const cur = pts[i].value;
      const prev = pts[i - 1].value;
      if (Number.isFinite(cur) && Number.isFinite(prev)) {
        map.set(pts[i].date, cur - prev);
      }
    }
    return map;
  }

  // -----------------------------------------------------------------------
  // 6. Índice temporal (días hábiles) por gráfico
  // -----------------------------------------------------------------------

  function unionDates(idList) {
    const set = new Set();
    for (const id of idList) {
      for (const p of state.raw[id]?.points || []) set.add(p.date);
    }
    return Array.from(set).sort();
  }

  function lastNDates(dates, n) {
    if (n >= dates.length) return dates.slice();
    return dates.slice(dates.length - n);
  }

  // -----------------------------------------------------------------------
  // 7. Motor de gráficos — SVG plano, sin librerías externas
  // -----------------------------------------------------------------------

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  function toSvgPoint(svg, evt) {
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    return pt.matrixTransform(ctm.inverse());
  }

  // Tooltip único compartido (una instancia por gráfico contenedor).
  function createTooltip(container) {
    const el = document.createElement('div');
    el.className = 'chart-tooltip';
    el.hidden = true;
    container.appendChild(el);
    return {
      show(html, x, y) {
        el.innerHTML = html; // contenido armado con escapeHtml() en el llamador
        el.hidden = false;
        const cw = container.clientWidth;
        const tw = el.offsetWidth;
        let left = x + 14;
        if (left + tw > cw) left = x - tw - 14;
        el.style.left = `${left}px`;
        el.style.top = `${Math.max(0, y - 12)}px`;
      },
      hide() { el.hidden = true; },
    };
  }

  function niceLinearScale(min, max) {
    if (min === max) { min -= 1; max += 1; }
    const pad = (max - min) * 0.08;
    return { min: min - pad, max: max + pad };
  }

  // ---- Gráfico 1: barras apiladas divergentes (factores) + línea (ΔBM) ---
  // + overlay opcional (off por defecto): Δ posición op. corto plazo BCRA.

  function renderFactorsChart(container, dates) {
    container.innerHTML = '';
    if (!dates.length) {
      container.innerHTML = '<p class="empty-note">Dato no disponible para el período seleccionado.</p>';
      return;
    }

    const vis = state.visibility.chart1;
    const groups = [
      { key: 'fx_priv', label: 'FX sector privado y otros', color: 'var(--series-fx-priv)', ids: [47] },
      { key: 'fx_tesoro', label: 'FX con el Tesoro', color: 'var(--series-fx-tesoro)', ids: [48] },
      { key: 'tesoro', label: 'Operaciones con el Tesoro (Adel. + Util. + Resto)', color: 'var(--series-tesoro)', ids: TESORO_COMPONENT_IDS },
      { key: 'otros', label: 'Otros factores', color: 'var(--series-otros)', ids: [59] },
    ];
    const overlayActive = !!state.analysisOverlay198;

    // valores por fecha y por grupo (null = sin dato ese día para ese grupo)
    const perDate = dates.map((date) => {
      const vals = {};
      for (const g of groups) {
        vals[g.key] = g.ids.length === 1 ? (state.maps[g.ids[0]]?.get(date) ?? null) : sumSeriesAt(g.ids, date);
      }
      vals.bm = state.maps[64]?.get(date) ?? null;
      vals.d198 = overlayActive ? (state.delta198Map.get(date) ?? null) : null;
      return { date, vals };
    });

    // dominio Y: considera stacks positivos/negativos de grupos visibles +
    // línea ΔBM + overlay Δ198 (si está activo)
    let yMin = 0, yMax = 0;
    for (const { vals } of perDate) {
      let pos = 0, neg = 0;
      for (const g of groups) {
        if (!vis[g.key]) continue;
        const v = vals[g.key];
        if (v === null) continue;
        if (v >= 0) pos += v; else neg += v;
      }
      yMax = Math.max(yMax, pos);
      yMin = Math.min(yMin, neg);
      if (vis.bm && vals.bm !== null) {
        yMax = Math.max(yMax, vals.bm);
        yMin = Math.min(yMin, vals.bm);
      }
      if (overlayActive && vals.d198 !== null) {
        yMax = Math.max(yMax, vals.d198);
        yMin = Math.min(yMin, vals.d198);
      }
    }
    const yDom = niceLinearScale(yMin, yMax);

    const width = 960, height = 420;
    const margin = { top: 16, right: 20, bottom: 28, left: 64 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart-svg', role: 'img', 'aria-label': 'Factores de explicación de la variación diaria de la Base Monetaria' });
    const plot = svgEl('g', { transform: `translate(${margin.left},${margin.top})` });
    svg.appendChild(plot);

    const n = dates.length;
    const bandW = innerW / n;
    const barW = Math.max(1, Math.min(22, bandW * 0.62));

    const yScale = (v) => innerH - ((v - yDom.min) / (yDom.max - yDom.min)) * innerH;
    const xCenter = (i) => i * bandW + bandW / 2;

    // Gridlines horizontales (hairline, sólidas, recesivas) + eje Y
    const yTicks = 5;
    for (let t = 0; t <= yTicks; t++) {
      const v = yDom.min + (t / yTicks) * (yDom.max - yDom.min);
      const y = yScale(v);
      plot.appendChild(svgEl('line', { x1: 0, x2: innerW, y1: y, y2: y, class: 'gridline' }));
      const label = svgEl('text', { x: -8, y: y + 3, class: 'axis-label', 'text-anchor': 'end' });
      label.textContent = formatARSCompactAxis(v);
      plot.appendChild(label);
    }
    // línea base (y=0) más marcada
    const y0 = yScale(0);
    plot.appendChild(svgEl('line', { x1: 0, x2: innerW, y1: y0, y2: y0, class: 'baseline' }));

    // Eje X: etiquetas dispersas para no saturar
    const maxLabels = Math.min(n, 10);
    const step = Math.max(1, Math.round(n / maxLabels));
    for (let i = 0; i < n; i += step) {
      const label = svgEl('text', { x: xCenter(i), y: innerH + 18, class: 'axis-label', 'text-anchor': 'middle' });
      label.textContent = formatDMY(dates[i]).slice(0, 5);
      plot.appendChild(label);
    }

    // Barras apiladas divergentes
    for (let i = 0; i < n; i++) {
      const { vals } = perDate[i];
      let stackPos = 0, stackNeg = 0;
      for (const g of groups) {
        if (!vis[g.key]) continue;
        const v = vals[g.key];
        if (v === null) continue;
        const y1 = v >= 0 ? stackPos : stackNeg;
        const y2 = v >= 0 ? stackPos + v : stackNeg + v;
        if (v >= 0) stackPos += v; else stackNeg += v;
        const rectY = yScale(Math.max(y1, y2));
        const rectH = Math.max(0.6, Math.abs(yScale(y1) - yScale(y2)));
        const rect = svgEl('rect', {
          x: xCenter(i) - barW / 2, y: rectY, width: barW, height: rectH,
          fill: g.color, class: 'bar-seg', 'data-i': i, 'data-g': g.key,
        });
        plot.appendChild(rect);
      }
    }

    // Línea ΔBM (referencia / identidad) — puntos donde hay dato, sin unir huecos falsos
    if (vis.bm) {
      let pathD = '';
      let drawing = false;
      for (let i = 0; i < n; i++) {
        const v = perDate[i].vals.bm;
        if (v === null) { drawing = false; continue; }
        const x = xCenter(i), y = yScale(v);
        pathD += (drawing ? ' L' : ' M') + `${x},${y}`;
        drawing = true;
      }
      if (pathD) plot.appendChild(svgEl('path', { d: pathD.trim(), class: 'line-series', stroke: 'var(--series-bm)' }));
      for (let i = 0; i < n; i++) {
        const v = perDate[i].vals.bm;
        if (v === null) continue;
        plot.appendChild(svgEl('circle', { cx: xCenter(i), cy: yScale(v), r: 3, class: 'line-dot', fill: 'var(--series-bm)' }));
      }
    }

    // Overlay analítico opcional: Δ posición op. corto plazo BCRA (ID 198).
    // Línea punteada, sin puntos, para marcarla como capa de estudio y no
    // como un factor oficial más. No se etiqueta como compras/ventas de
    // títulos, mercado secundario ni operaciones simultáneas.
    if (overlayActive) {
      let pathD = '', drawing = false;
      for (let i = 0; i < n; i++) {
        const v = perDate[i].vals.d198;
        if (v === null) { drawing = false; continue; }
        const x = xCenter(i), y = yScale(v);
        pathD += (drawing ? ' L' : ' M') + `${x},${y}`;
        drawing = true;
      }
      if (pathD) plot.appendChild(svgEl('path', { d: pathD.trim(), class: 'line-series line-series--dashed line-series--analytic', stroke: 'var(--series-op-corto-plazo)' }));
    }

    // Capa de eventos (arquitectura lista, sin datos todavía)
    renderEventMarkers(plot, dates, xCenter, innerH);

    // Interacción: crosshair + tooltip con todos los valores del día
    const hitLayer = svgEl('rect', { x: 0, y: 0, width: innerW, height: innerH, fill: 'transparent', class: 'hit-layer' });
    plot.appendChild(hitLayer);
    const crosshair = svgEl('line', { y1: 0, y2: innerH, class: 'crosshair', hidden: true });
    plot.appendChild(crosshair);

    container.appendChild(svg);
    const tooltip = createTooltip(container);

    function handleMove(evt) {
      const p = toSvgPoint(svg, evt);
      const localX = p.x - margin.left;
      let i = Math.round(localX / bandW - 0.5);
      i = Math.max(0, Math.min(n - 1, i));
      const x = xCenter(i);
      crosshair.setAttribute('x1', x);
      crosshair.setAttribute('x2', x);
      crosshair.removeAttribute('hidden');
      const { date, vals } = perDate[i];
      let rows = '';
      for (const g of groups) {
        if (!vis[g.key]) continue;
        rows += `<div class="tt-row"><span class="tt-key" style="--dot:${g.color}">${escapeHtml(g.label)}</span><span class="tt-val">${escapeHtml(formatARS(vals[g.key]))}</span></div>`;
      }
      if (vis.bm) {
        rows += `<div class="tt-row tt-row--strong"><span class="tt-key" style="--dot:var(--series-bm)">Δ Base Monetaria</span><span class="tt-val">${escapeHtml(formatARS(vals.bm))}</span></div>`;
      }
      if (overlayActive) {
        rows += `<div class="tt-row"><span class="tt-key" style="--dot:var(--series-op-corto-plazo)">Δ posición op. corto plazo BCRA (analítico, ID 198)</span><span class="tt-val">${escapeHtml(formatARS(vals.d198))}</span></div>`;
      }
      tooltip.show(`<div class="tt-date">${escapeHtml(formatDMY(date))}</div>${rows}<div class="tt-unit">Millones de ARS</div>`, p.x, p.y);
    }
    hitLayer.addEventListener('pointermove', handleMove);
    hitLayer.addEventListener('pointerleave', () => { tooltip.hide(); crosshair.setAttribute('hidden', 'true'); });

    return { groups, vis };
  }

  // Placeholder de eventos: no dibuja nada mientras EVENTS esté vacío, pero
  // deja la capa y el contrato listos para cuando se conecten licitaciones.
  function renderEventMarkers(plot, dates, xCenter, innerH) {
    if (!EVENTS.length) return;
    const idxByDate = new Map(dates.map((d, i) => [d, i]));
    for (const ev of EVENTS) {
      if (!EVENT_TYPES.includes(ev.type)) continue;
      const i = idxByDate.get(ev.date);
      if (i === undefined) continue;
      const x = xCenter(i);
      const marker = svgEl('line', { x1: x, x2: x, y1: 0, y2: innerH, class: `event-marker event-${ev.type.toLowerCase()}` });
      const title = svgEl('title', {});
      title.textContent = `${ev.type}: ${ev.label || ''}`;
      marker.appendChild(title);
      plot.appendChild(marker);
    }
  }

  // ---- Legend genérica con toggle (soporta swatch punteado + info-icon) ----

  function renderLegend(container, items, visibilityState, onToggle) {
    container.innerHTML = '';
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'legend-item' + (visibilityState[item.key] ? '' : ' legend-item--off');
      btn.setAttribute('aria-pressed', String(!!visibilityState[item.key]));
      const swatchClass = 'legend-swatch' + (item.dashed ? ' legend-swatch--dashed' : '');
      const swatchStyle = item.dashed ? `border-top-color:${item.color}` : `background:${item.color}`;
      btn.innerHTML = `<span class="${swatchClass}" style="${swatchStyle}"></span><span>${escapeHtml(item.label)}</span>`;
      btn.addEventListener('click', () => {
        visibilityState[item.key] = !visibilityState[item.key];
        onToggle();
      });
      container.appendChild(btn);
      if (item.info) {
        const info = document.createElement('span');
        info.className = 'info-icon';
        info.tabIndex = 0;
        info.title = item.info;
        info.textContent = '?';
        container.appendChild(info);
      }
    }
  }

  // ---- Gráfico 2 — Panel A: barras (Variación diaria — flujo, ID 63) ----

  function renderBarsPanel(container, dates, seriesId, color, label) {
    container.innerHTML = '';
    if (!dates.length) {
      container.innerHTML = '<p class="empty-note">Dato no disponible para el período seleccionado.</p>';
      return;
    }
    const values = dates.map((d) => state.maps[seriesId]?.get(d) ?? null);
    const present = values.filter((v) => v !== null);
    if (!present.length) {
      container.innerHTML = '<p class="empty-note">Dato no disponible para el período seleccionado.</p>';
      return;
    }
    const yDom = niceLinearScale(Math.min(0, ...present), Math.max(0, ...present));

    const width = 960, height = 220;
    const margin = { top: 12, right: 20, bottom: 24, left: 64 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const n = dates.length;
    const bandW = innerW / n;
    const barW = Math.max(1, Math.min(22, bandW * 0.62));
    const yScale = (v) => innerH - ((v - yDom.min) / (yDom.max - yDom.min)) * innerH;
    const xCenter = (i) => i * bandW + bandW / 2;

    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart-svg', role: 'img', 'aria-label': label });
    const plot = svgEl('g', { transform: `translate(${margin.left},${margin.top})` });
    svg.appendChild(plot);

    const yTicks = 4;
    for (let t = 0; t <= yTicks; t++) {
      const v = yDom.min + (t / yTicks) * (yDom.max - yDom.min);
      const y = yScale(v);
      plot.appendChild(svgEl('line', { x1: 0, x2: innerW, y1: y, y2: y, class: 'gridline' }));
      const lab = svgEl('text', { x: -8, y: y + 3, class: 'axis-label', 'text-anchor': 'end' });
      lab.textContent = formatARSCompactAxis(v);
      plot.appendChild(lab);
    }
    const y0 = yScale(0);
    plot.appendChild(svgEl('line', { x1: 0, x2: innerW, y1: y0, y2: y0, class: 'baseline' }));

    const maxLabels = Math.min(n, 10);
    const step = Math.max(1, Math.round(n / maxLabels));
    for (let i = 0; i < n; i += step) {
      const lab = svgEl('text', { x: xCenter(i), y: innerH + 18, class: 'axis-label', 'text-anchor': 'middle' });
      lab.textContent = formatDMY(dates[i]).slice(0, 5);
      plot.appendChild(lab);
    }

    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (v === null) continue;
      const y1 = yScale(Math.max(0, v));
      const h = Math.max(0.6, Math.abs(yScale(0) - yScale(v)));
      plot.appendChild(svgEl('rect', { x: xCenter(i) - barW / 2, y: y1, width: barW, height: h, fill: color, class: 'bar-seg' }));
    }

    const hitLayer = svgEl('rect', { x: 0, y: 0, width: innerW, height: innerH, fill: 'transparent' });
    plot.appendChild(hitLayer);
    const crosshair = svgEl('line', { y1: 0, y2: innerH, class: 'crosshair', hidden: true });
    plot.appendChild(crosshair);
    container.appendChild(svg);
    const tooltip = createTooltip(container);

    hitLayer.addEventListener('pointermove', (evt) => {
      const p = toSvgPoint(svg, evt);
      let i = Math.round((p.x - margin.left) / bandW - 0.5);
      i = Math.max(0, Math.min(n - 1, i));
      const x = xCenter(i);
      crosshair.setAttribute('x1', x); crosshair.setAttribute('x2', x);
      crosshair.removeAttribute('hidden');
      tooltip.show(
        `<div class="tt-date">${escapeHtml(formatDMY(dates[i]))}</div>` +
        `<div class="tt-row"><span class="tt-key" style="--dot:${color}">${escapeHtml(label)}</span><span class="tt-val">${escapeHtml(formatARS(values[i]))}</span></div>` +
        `<div class="tt-unit">Millones de ARS — flujo diario (variación)</div>`,
        p.x, p.y,
      );
    });
    hitLayer.addEventListener('pointerleave', () => { tooltip.hide(); crosshair.setAttribute('hidden', 'true'); });
  }

  // ---- Gráfico 2 — Panel A (vista alternativa): línea de nivel (Saldo, ID 70) ----
  // Nunca se combina con la vista de flujo (ID 63): son vistas alternativas
  // del mismo panel, mutuamente excluyentes.

  function renderLevelLinePanel(container, dates, seriesId, color, label) {
    container.innerHTML = '';
    if (!dates.length) {
      container.innerHTML = '<p class="empty-note">Dato no disponible para el período seleccionado.</p>';
      return;
    }
    const values = dates.map((d) => state.maps[seriesId]?.get(d) ?? null);
    const present = values.filter((v) => v !== null);
    if (!present.length) {
      container.innerHTML = '<p class="empty-note">Dato no disponible para el período seleccionado.</p>';
      return;
    }
    const yDom = niceLinearScale(Math.min(...present), Math.max(...present));

    const width = 960, height = 220;
    const margin = { top: 12, right: 20, bottom: 24, left: 64 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const n = dates.length;
    const bandW = innerW / n;
    const yScale = (v) => innerH - ((v - yDom.min) / (yDom.max - yDom.min)) * innerH;
    const xCenter = (i) => i * bandW + bandW / 2;

    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart-svg', role: 'img', 'aria-label': label });
    const plot = svgEl('g', { transform: `translate(${margin.left},${margin.top})` });
    svg.appendChild(plot);

    const yTicks = 4;
    for (let t = 0; t <= yTicks; t++) {
      const v = yDom.min + (t / yTicks) * (yDom.max - yDom.min);
      const y = yScale(v);
      plot.appendChild(svgEl('line', { x1: 0, x2: innerW, y1: y, y2: y, class: 'gridline' }));
      const lab = svgEl('text', { x: -8, y: y + 3, class: 'axis-label', 'text-anchor': 'end' });
      lab.textContent = formatARSCompactAxis(v);
      plot.appendChild(lab);
    }
    const maxLabels = Math.min(n, 10);
    const step = Math.max(1, Math.round(n / maxLabels));
    for (let i = 0; i < n; i += step) {
      const lab = svgEl('text', { x: xCenter(i), y: innerH + 18, class: 'axis-label', 'text-anchor': 'middle' });
      lab.textContent = formatDMY(dates[i]).slice(0, 5);
      plot.appendChild(lab);
    }

    // Área suave bajo la línea: apoyo visual de nivel, no un dato adicional.
    let curSeg = null;
    const segments = [];
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (v === null) { if (curSeg) { segments.push(curSeg); curSeg = null; } continue; }
      if (!curSeg) curSeg = [];
      curSeg.push([xCenter(i), yScale(v)]);
    }
    if (curSeg) segments.push(curSeg);
    const yBase = yScale(yDom.min);
    for (const seg of segments) {
      if (seg.length < 2) continue;
      const first = seg[0], last = seg[seg.length - 1];
      let d = `M${first[0]},${yBase} ` + seg.map((p) => `L${p[0]},${p[1]}`).join(' ') + ` L${last[0]},${yBase} Z`;
      plot.appendChild(svgEl('path', { d, class: 'level-area', fill: color }));
    }

    let pathD = '', drawing = false;
    for (let i = 0; i < n; i++) {
      const v = values[i];
      if (v === null) { drawing = false; continue; }
      const x = xCenter(i), y = yScale(v);
      pathD += (drawing ? ' L' : ' M') + `${x},${y}`;
      drawing = true;
    }
    if (pathD) plot.appendChild(svgEl('path', { d: pathD.trim(), class: 'line-series', stroke: color }));

    const hitLayer = svgEl('rect', { x: 0, y: 0, width: innerW, height: innerH, fill: 'transparent' });
    plot.appendChild(hitLayer);
    const crosshair = svgEl('line', { y1: 0, y2: innerH, class: 'crosshair', hidden: true });
    plot.appendChild(crosshair);
    container.appendChild(svg);
    const tooltip = createTooltip(container);

    hitLayer.addEventListener('pointermove', (evt) => {
      const p = toSvgPoint(svg, evt);
      let i = Math.round((p.x - margin.left) / bandW - 0.5);
      i = Math.max(0, Math.min(n - 1, i));
      const x = xCenter(i);
      crosshair.setAttribute('x1', x); crosshair.setAttribute('x2', x);
      crosshair.removeAttribute('hidden');
      tooltip.show(
        `<div class="tt-date">${escapeHtml(formatDMY(dates[i]))}</div>` +
        `<div class="tt-row"><span class="tt-key" style="--dot:${color}">${escapeHtml(label)}</span><span class="tt-val">${escapeHtml(formatARS(values[i]))}</span></div>` +
        `<div class="tt-unit">Millones de ARS — nivel (saldo)</div>`,
        p.x, p.y,
      );
    });
    hitLayer.addEventListener('pointerleave', () => { tooltip.hide(); crosshair.setAttribute('hidden', 'true'); });
  }

  // ---- Gráfico 2 — Panel B: líneas (tasas, % TNA) — REPO | Call | TAMAR ----

  function renderRatesPanel(container, dates) {
    container.innerHTML = '';
    if (!dates.length) {
      container.innerHTML = '<p class="empty-note">Dato no disponible para el período seleccionado.</p>';
      return;
    }
    const vis = state.visibility.chart2rates;
    const valuesByKey = {};
    let allPresent = [];
    for (const s of RATES_SERIES) {
      valuesByKey[s.key] = dates.map((d) => state.maps[s.id]?.get(d) ?? null);
      if (vis[s.key]) allPresent = allPresent.concat(valuesByKey[s.key].filter((v) => v !== null));
    }
    if (!allPresent.length) {
      container.innerHTML = '<p class="empty-note">Dato no disponible para el período seleccionado.</p>';
      return;
    }
    const yDom = niceLinearScale(Math.min(...allPresent), Math.max(...allPresent));

    const width = 960, height = 220;
    const margin = { top: 12, right: 20, bottom: 24, left: 56 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const n = dates.length;
    const bandW = innerW / n;
    const yScale = (v) => innerH - ((v - yDom.min) / (yDom.max - yDom.min)) * innerH;
    const xCenter = (i) => i * bandW + bandW / 2;

    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'chart-svg', role: 'img', 'aria-label': 'Tasas de corto plazo (% TNA)' });
    const plot = svgEl('g', { transform: `translate(${margin.left},${margin.top})` });
    svg.appendChild(plot);

    const yTicks = 4;
    for (let t = 0; t <= yTicks; t++) {
      const v = yDom.min + (t / yTicks) * (yDom.max - yDom.min);
      const y = yScale(v);
      plot.appendChild(svgEl('line', { x1: 0, x2: innerW, y1: y, y2: y, class: 'gridline' }));
      const lab = svgEl('text', { x: -8, y: y + 3, class: 'axis-label', 'text-anchor': 'end' });
      lab.textContent = `${nfDecimal1.format(v)}%`;
      plot.appendChild(lab);
    }
    const maxLabels = Math.min(n, 10);
    const step = Math.max(1, Math.round(n / maxLabels));
    for (let i = 0; i < n; i += step) {
      const lab = svgEl('text', { x: xCenter(i), y: innerH + 18, class: 'axis-label', 'text-anchor': 'middle' });
      lab.textContent = formatDMY(dates[i]).slice(0, 5);
      plot.appendChild(lab);
    }

    for (const s of RATES_SERIES) {
      if (!vis[s.key]) continue;
      const vals = valuesByKey[s.key];
      let pathD = '', drawing = false;
      for (let i = 0; i < n; i++) {
        const v = vals[i];
        if (v === null) { drawing = false; continue; }
        const x = xCenter(i), y = yScale(v);
        pathD += (drawing ? ' L' : ' M') + `${x},${y}`;
        drawing = true;
      }
      if (pathD) plot.appendChild(svgEl('path', { d: pathD.trim(), class: 'line-series' + (s.dashed ? ' line-series--dashed' : ''), stroke: s.color }));
    }

    const hitLayer = svgEl('rect', { x: 0, y: 0, width: innerW, height: innerH, fill: 'transparent' });
    plot.appendChild(hitLayer);
    const crosshair = svgEl('line', { y1: 0, y2: innerH, class: 'crosshair', hidden: true });
    plot.appendChild(crosshair);
    container.appendChild(svg);
    const tooltip = createTooltip(container);

    hitLayer.addEventListener('pointermove', (evt) => {
      const p = toSvgPoint(svg, evt);
      let i = Math.round((p.x - margin.left) / bandW - 0.5);
      i = Math.max(0, Math.min(n - 1, i));
      const x = xCenter(i);
      crosshair.setAttribute('x1', x); crosshair.setAttribute('x2', x);
      crosshair.removeAttribute('hidden');
      let rows = '';
      for (const s of RATES_SERIES) {
        if (!vis[s.key]) continue;
        rows += `<div class="tt-row"><span class="tt-key" style="--dot:${s.color}">${escapeHtml(s.label)}</span><span class="tt-val">${escapeHtml(formatPct(valuesByKey[s.key][i]))}</span></div>`;
      }
      tooltip.show(`<div class="tt-date">${escapeHtml(formatDMY(dates[i]))}</div>${rows}`, p.x, p.y);
    });
    hitLayer.addEventListener('pointerleave', () => { tooltip.hide(); crosshair.setAttribute('hidden', 'true'); });
  }

  // -----------------------------------------------------------------------
  // 8. Conciliación (control de calidad, no explicación económica)
  // -----------------------------------------------------------------------

  function computeReconciliation(dates) {
    const rows = [];
    for (const date of dates) {
      const bm = state.maps[64]?.get(date);
      if (bm === undefined) continue; // sin ΔBM ese día, no se puede conciliar
      let sum = 0, missing = [];
      for (const id of RECONCILIATION_COMPONENT_IDS) {
        const v = state.maps[id]?.get(date);
        if (v === undefined) { missing.push(id); continue; }
        sum += v;
      }
      const errorConciliacion = sum - bm;
      rows.push({ date, bm, sum, errorConciliacion, missing });
    }
    return rows;
  }

  // La conciliación funciona siempre en segundo plano como control de
  // calidad. Solo se muestra algo en pantalla cuando hay un error material
  // (fuera de tolerancia por redondeo); en el resto de los casos no se
  // renderiza ningún badge (ni siquiera uno de "OK").
  function renderReconciliationBanner(container, dates) {
    const rows = computeReconciliation(dates);
    const withIssue = rows.filter((r) => Math.abs(r.errorConciliacion) > RECONCILIATION_TOLERANCE);
    container.innerHTML = '';
    if (!rows.length) {
      container.innerHTML = '<p class="reconciliation-note">Conciliación no disponible: falta la variación diaria de la Base Monetaria (ID 64) en el período visible.</p>';
      return;
    }
    if (!withIssue.length) {
      return; // silencioso: conciliación dentro de tolerancia, no se muestra nada
    }
    const last = rows[rows.length - 1];
    const lastHasIssue = Math.abs(last.errorConciliacion) > RECONCILIATION_TOLERANCE;
    const badge = document.createElement('div');
    badge.className = 'reconciliation-badge reconciliation-badge--warn';
    badge.innerHTML = `⚠ <strong>Advertencia de conciliación:</strong> en ${withIssue.length} de ${rows.length} día(s) hábiles del período, la suma de factores oficiales difiere de la variación de la Base Monetaria por más de ${RECONCILIATION_TOLERANCE} millón de ARS (tolerancia por redondeo). Último día (${escapeHtml(formatDMY(last.date))}): error de conciliación = ${escapeHtml(formatARS(last.errorConciliacion))}${lastHasIssue ? ' — no se interpreta automáticamente esta fecha.' : '.'}`;
    container.appendChild(badge);
  }

  // -----------------------------------------------------------------------
  // 9. "Datos actualizados al" — por serie, sin forzar coincidencia
  // -----------------------------------------------------------------------

  function lastAvailableDate(id) {
    const pts = state.raw[id]?.points;
    if (!pts || !pts.length) return null;
    return pts[pts.length - 1].date;
  }

  function renderUpdatedLabels() {
    const chart1El = document.getElementById('updated-chart1');
    if (chart1El) {
      const last = lastAvailableDate(64);
      chart1El.textContent = last ? `Actualizado al ${formatDMY(last)}` : 'Dato no disponible';
    }

    const ccEl = document.getElementById('updated-cc');
    if (ccEl) {
      const ccId = state.ccView === 'saldo' ? 70 : 63;
      const last = lastAvailableDate(ccId);
      ccEl.textContent = last ? `Actualizado al ${formatDMY(last)}` : 'Dato no disponible';
    }

    const ratesEl = document.getElementById('updated-rates');
    if (ratesEl) {
      ratesEl.innerHTML = RATES_SERIES.map((s) => {
        const last = lastAvailableDate(s.id);
        const swatchClass = 'legend-swatch' + (s.dashed ? ' legend-swatch--dashed' : '');
        const swatchStyle = s.dashed ? `border-top-color:${s.color}` : `background:${s.color}`;
        const shortLabel = s.label.split(' (')[0];
        return `<span class="rates-updated__item"><span class="${swatchClass}" style="${swatchStyle}"></span>${escapeHtml(shortLabel)}: ${last ? escapeHtml(formatDMY(last)) : 'Dato no disponible'}</span>`;
      }).join('');
    }
  }

  // -----------------------------------------------------------------------
  // 10. Fuente y metodología (trazabilidad)
  // -----------------------------------------------------------------------

  function renderMethodology() {
    const tbody = document.getElementById('methodology-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const ordered = Object.values(SERIES).sort((a, b) => a.id - b.id);
    for (const s of ordered) {
      const last = lastAvailableDate(s.id);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${s.id}</td>
        <td>${escapeHtml(s.nombreOficial)}</td>
        <td>${escapeHtml(s.display)}</td>
        <td>${escapeHtml(s.tipoSerie)}</td>
        <td>${escapeHtml(s.periodicidad)}</td>
        <td>${escapeHtml(s.unidad)}</td>
        <td>${s.frontend ? 'Sí' : 'No'}</td>
        <td>${last ? escapeHtml(formatDMY(last)) : 'Dato no disponible'}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  // -----------------------------------------------------------------------
  // 11. Panel de cuentas corrientes — Saldo (nivel) / Variación (flujo)
  // -----------------------------------------------------------------------
  // El saldo (ID 70) se muestra como nivel; la variación (ID 63) se muestra
  // como flujo diario. Vistas mutuamente excluyentes: nunca se mezclan ni
  // se tratan como equivalentes.

  function renderCCPanel() {
    const seriesId = state.ccView === 'saldo' ? 70 : 63;
    const dates = lastNDates(unionDates([seriesId]), PERIODS[state.period]);

    const titleEl = document.getElementById('cc-title-label');
    const unitEl = document.getElementById('cc-unit-label');
    if (state.ccView === 'saldo') {
      if (titleEl) titleEl.textContent = 'Saldo de cuentas corrientes bancarias en el BCRA';
      if (unitEl) unitEl.textContent = 'Millones de ARS — nivel (saldo)';
      renderLevelLinePanel(document.getElementById('chart2-bars'), dates, 70, 'var(--series-cc-saldo)', 'Saldo de cuentas corrientes bancarias en el BCRA');
    } else {
      if (titleEl) titleEl.textContent = 'Variación diaria de cuentas corrientes bancarias en el BCRA';
      if (unitEl) unitEl.textContent = 'Millones de ARS — flujo diario (variación)';
      renderBarsPanel(document.getElementById('chart2-bars'), dates, 63, 'var(--series-cc)', 'Variación diaria de cuentas corrientes bancarias en el BCRA');
    }
  }

  // -----------------------------------------------------------------------
  // 12. Orquestación / render principal
  // -----------------------------------------------------------------------

  function renderAll() {
    const chart1Ids = [47, 48, 49, 50, 51, 64];
    const dates1 = lastNDates(unionDates(chart1Ids), PERIODS[state.period]);
    renderFactorsChart(document.getElementById('chart1'), dates1);
    renderLegend(
      document.getElementById('legend1'),
      [
        { key: 'fx_priv', label: 'FX sector privado y otros', color: 'var(--series-fx-priv)' },
        { key: 'fx_tesoro', label: 'FX con el Tesoro', color: 'var(--series-fx-tesoro)' },
        { key: 'tesoro', label: 'Operaciones con el Tesoro', color: 'var(--series-tesoro)' },
        { key: 'otros', label: 'Otros factores', color: 'var(--series-otros)' },
        { key: 'bm', label: 'Δ Base Monetaria', color: 'var(--series-bm)' },
      ],
      state.visibility.chart1,
      () => renderFactorsChart(document.getElementById('chart1'), dates1),
    );
    renderReconciliationBanner(document.getElementById('reconciliation'), dates1);

    renderCCPanel();

    const datesRates = lastNDates(unionDates(RATES_SERIES.map((s) => s.id)), PERIODS[state.period]);
    renderRatesPanel(document.getElementById('chart2-rates'), datesRates);
    renderLegend(
      document.getElementById('legend2'),
      RATES_SERIES.map((s) => ({ key: s.key, label: s.label, color: s.color, dashed: s.dashed, info: s.info })),
      state.visibility.chart2rates,
      () => renderRatesPanel(document.getElementById('chart2-rates'), datesRates),
    );

    renderUpdatedLabels();
    renderMethodology();
  }

  function setPeriod(period) {
    state.period = period;
    document.querySelectorAll('.period-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.period === period);
      b.setAttribute('aria-pressed', String(b.dataset.period === period));
    });
    renderAll();
  }

  function wirePeriodSelector() {
    document.querySelectorAll('.period-btn').forEach((btn) => {
      btn.addEventListener('click', () => setPeriod(btn.dataset.period));
    });
  }

  function setCCView(view) {
    state.ccView = view;
    document.querySelectorAll('.cc-view-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.ccview === view);
      b.setAttribute('aria-pressed', String(b.dataset.ccview === view));
    });
    renderAll();
  }

  function wireCCViewToggle() {
    document.querySelectorAll('.cc-view-btn').forEach((btn) => {
      btn.addEventListener('click', () => setCCView(btn.dataset.ccview));
    });
  }

  function wireAnalysisToggle() {
    const cb = document.getElementById('toggle-op-corto-plazo');
    if (!cb) return;
    cb.addEventListener('change', () => {
      state.analysisOverlay198 = cb.checked;
      renderAll();
    });
  }

  async function init() {
    wirePeriodSelector();
    wireCCViewToggle();
    wireAnalysisToggle();
    const statusEl = document.getElementById('load-status');
    statusEl.textContent = 'Cargando datos oficiales del BCRA (API v4.0)…';

    const raw = await fetchAllSeries();
    state.raw = raw;
    for (const id of ALL_IDS) state.maps[id] = toMap(raw[id]?.points || []);
    state.delta198Map = computeDelta198Map();

    const failed = ALL_IDS.filter((id) => !raw[id]?.ok);
    const criticalFailed = [64, 47, 48, 59].filter((id) => !raw[id]?.ok);

    if (criticalFailed.length === ALL_IDS.length || !raw[64]?.ok && !raw[63]?.ok && !raw[150]?.ok && !raw[148]?.ok) {
      statusEl.innerHTML = `⚠ No se pudo conectar con la API oficial del BCRA (posible problema de red o de CORS). Detalle: ${escapeHtml(raw[64]?.error || 'sin respuesta')}. Todas las series se muestran como "Dato no disponible".`;
    } else if (failed.length) {
      statusEl.innerHTML = `Datos cargados desde la API oficial del BCRA. ${failed.length} de ${ALL_IDS.length} series no respondieron y se muestran como "Dato no disponible" (IDs: ${failed.join(', ')}).`;
    } else {
      statusEl.textContent = 'Datos cargados desde la API oficial del BCRA (v4.0).';
    }

    renderAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
