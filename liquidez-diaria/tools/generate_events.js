/* =========================================================================
   generate_events.js — Agenda macroeconómica: generador de la capa local
   de eventos (liquidez-diaria/events.json)

   Esto NO es un scraper que corre en el navegador. Es un script que se
   corre manualmente, offline, cada vez que se quiere actualizar la capa
   local de eventos a partir de los calendarios oficiales. El frontend
   (agenda.js) SOLO lee events.json — nunca hace fetch en vivo a BCRA,
   INDEC ni Tesoro.

   Cada fecha de este archivo fue extraída de la fuente oficial indicada en
   su propio "source_url"/"source_reference" y validada con un chequeo de
   día de la semana (ningún organismo publica en fin de semana) antes de
   cargarla. Ninguna fecha fue estimada, inferida ni completada por
   continuidad de patrón: donde la fuente no listaba una fecha (p. ej. REM
   de diciembre 2026, que no aparece en el calendario oficial del BCRA a la
   fecha de esta carga), directamente no se generó el evento.

   TESORO: el PDF del cronograma de licitaciones está bloqueado por
   robots.txt para las herramientas de fetch disponibles en esta sesión de
   Claude (ver liquidez-diaria/tools/README.md); el usuario lo adjuntó
   directamente en la conversación y sus fechas se cargaron extrayendo el
   color de cada celda del calendario de forma programática (ver el
   comentario junto a TESORO_SOURCE más abajo para el detalle del método).

   Cómo correr: node generate_events.js > ../events.json
   ========================================================================= */

const GENERATED_AT = '2026-09-22T01:05:00Z';

const BCRA_SOURCE = {
  source_name: 'BCRA — Calendario de informes 2026',
  source_url: 'https://www.bcra.gob.ar/calendario-de-informes/',
};

const INDEC_SOURCE_H1 = {
  source_name: 'INDEC — Calendario de difusión de indicadores, 1er semestre 2026',
  source_url: 'https://www.indec.gob.ar/ftp/cuadros/publicaciones/calendario_1sem2026.pdf',
};

const INDEC_SOURCE_H2 = {
  source_name: 'INDEC — Calendario de difusión de indicadores, 2do semestre 2026',
  source_url: 'https://www.indec.gob.ar/ftp/cuadros/publicaciones/calendario_2sem2026.pdf',
};

const TESORO_SOURCE = {
  source_name: 'Secretaría de Finanzas — Cronograma de Licitaciones 2026',
  source_url: 'https://www.argentina.gob.ar/sites/default/files/calendario_prensa_0.pdf',
};

function ev({ id, event_type, title, date, time, institution, category, status, source, source_reference }) {
  return {
    id,
    event_type,
    title,
    date,
    time: time || null,
    institution,
    category,
    status,
    source_name: source.source_name,
    source_url: source.source_url,
    source_reference,
    created_at: GENERATED_AT,
    updated_at: GENERATED_AT,
  };
}

const events = [];

// ---------------------------------------------------------------------
// BCRA — REM (Relevamiento de Expectativas de Mercado)
// Fechas tal como figuran en la fila "Relevamiento de Expectativas de
// Mercado (REM)" del calendario oficial. No hay fecha de diciembre 2026
// publicada en el calendario a la fecha de esta carga: no se generó ese
// evento.
// ---------------------------------------------------------------------
const REM_DATES = ['2026-01-07', '2026-02-05', '2026-03-05', '2026-04-08', '2026-05-07', '2026-06-04', '2026-07-06', '2026-08-06', '2026-09-04', '2026-10-06', '2026-11-05'];
for (const date of REM_DATES) {
  events.push(ev({
    id: `bcra-rem-${date}`,
    event_type: 'REM',
    title: 'REM — Relevamiento de Expectativas de Mercado',
    date,
    institution: 'BCRA',
    category: 'BCRA',
    status: 'CONFIRMED',
    source: BCRA_SOURCE,
    source_reference: `Fila "Relevamiento de Expectativas de Mercado (REM)", calendario 2026`,
  }));
}

// ---------------------------------------------------------------------
// BCRA — Informe Monetario Mensual
// ---------------------------------------------------------------------
const INFORME_MONETARIO_DATES = ['2026-01-08', '2026-02-06', '2026-03-06', '2026-04-09', '2026-05-08', '2026-06-05', '2026-07-07', '2026-08-07', '2026-09-07', '2026-10-07', '2026-11-09', '2026-12-09'];
for (const date of INFORME_MONETARIO_DATES) {
  events.push(ev({
    id: `bcra-monetary_report-${date}`,
    event_type: 'MONETARY_REPORT',
    title: 'Informe Monetario Mensual (BCRA)',
    date,
    institution: 'BCRA',
    category: 'BCRA',
    status: 'CONFIRMED',
    source: BCRA_SOURCE,
    source_reference: `Fila "Informe Monetario Mensual", calendario 2026`,
  }));
}

// ---------------------------------------------------------------------
// BCRA — IPOM (Informe de Política Monetaria)
// Trimestral por diseño, pero el calendario oficial 2026 solo tiene
// publicadas 2 fechas a la fecha de esta carga (mayo y agosto). No se
// completaron las 2 restantes por continuidad de patrón.
// ---------------------------------------------------------------------
const IPOM_DATES = ['2026-05-13', '2026-08-06'];
for (const date of IPOM_DATES) {
  events.push(ev({
    id: `bcra-ipom-${date}`,
    event_type: 'IPOM',
    title: 'IPOM — Informe de Política Monetaria (BCRA)',
    date,
    institution: 'BCRA',
    category: 'BCRA',
    status: 'CONFIRMED',
    source: BCRA_SOURCE,
    source_reference: `Fila "Informe de Política Monetaria (IPOM)", calendario 2026`,
  }));
}

// ---------------------------------------------------------------------
// BCRA — Informe de Evolución del Mercado de Cambios y Balance Cambiario
// ---------------------------------------------------------------------
const FX_BALANCE_DATES = ['2026-01-30', '2026-02-27', '2026-03-27', '2026-04-24', '2026-05-29', '2026-06-26', '2026-07-31', '2026-08-28', '2026-09-25', '2026-10-30', '2026-11-27', '2026-12-31'];
for (const date of FX_BALANCE_DATES) {
  events.push(ev({
    id: `bcra-fx_balance-${date}`,
    event_type: 'FX_BALANCE',
    title: 'Informe de Evolución del Mercado de Cambios y Balance Cambiario (BCRA)',
    date,
    institution: 'BCRA',
    category: 'BCRA',
    status: 'CONFIRMED',
    source: BCRA_SOURCE,
    source_reference: `Fila "Informe de Evolución del Mercado de Cambios y Balance Cambiario", calendario 2026`,
  }));
}

// ---------------------------------------------------------------------
// INDEC — IPC (Índice de Precios al Consumidor)
// ---------------------------------------------------------------------
const IPC_DATES = [
  ['2026-01-13', INDEC_SOURCE_H1], ['2026-02-10', INDEC_SOURCE_H1], ['2026-03-12', INDEC_SOURCE_H1],
  ['2026-04-14', INDEC_SOURCE_H1], ['2026-05-14', INDEC_SOURCE_H1], ['2026-06-11', INDEC_SOURCE_H1],
  ['2026-07-14', INDEC_SOURCE_H2], ['2026-08-13', INDEC_SOURCE_H2], ['2026-09-10', INDEC_SOURCE_H2],
  ['2026-10-13', INDEC_SOURCE_H2], ['2026-11-12', INDEC_SOURCE_H2], ['2026-12-15', INDEC_SOURCE_H2],
];
for (const [date, source] of IPC_DATES) {
  events.push(ev({
    id: `indec-cpi-${date}`,
    event_type: 'CPI',
    title: 'IPC — Índice de Precios al Consumidor (INDEC)',
    date,
    institution: 'INDEC',
    category: 'INDEC',
    status: 'CONFIRMED',
    source,
    source_reference: 'Fila "Índice de precios al consumidor (IPC). Cobertura nacional."',
  }));
}

// ---------------------------------------------------------------------
// INDEC — EMAE (Estimador Mensual de Actividad Económica)
// ---------------------------------------------------------------------
const EMAE_DATES = [
  ['2026-01-21', INDEC_SOURCE_H1], ['2026-02-24', INDEC_SOURCE_H1], ['2026-03-26', INDEC_SOURCE_H1],
  ['2026-04-22', INDEC_SOURCE_H1], ['2026-05-21', INDEC_SOURCE_H1], ['2026-06-29', INDEC_SOURCE_H1],
  ['2026-07-22', INDEC_SOURCE_H2], ['2026-08-20', INDEC_SOURCE_H2], ['2026-09-24', INDEC_SOURCE_H2],
  ['2026-10-21', INDEC_SOURCE_H2], ['2026-11-24', INDEC_SOURCE_H2], ['2026-12-21', INDEC_SOURCE_H2],
];
for (const [date, source] of EMAE_DATES) {
  events.push(ev({
    id: `indec-emae-${date}`,
    event_type: 'EMAE',
    title: 'EMAE — Estimador Mensual de Actividad Económica (INDEC)',
    date,
    institution: 'INDEC',
    category: 'INDEC',
    status: 'CONFIRMED',
    source,
    source_reference: 'Fila "Estimador mensual de actividad económica (EMAE)"',
  }));
}

// ---------------------------------------------------------------------
// INDEC — PIB trimestral (Informe de avance del nivel de actividad)
// ---------------------------------------------------------------------
const PIB_DATES = [
  ['2026-03-20', INDEC_SOURCE_H1, 'Cuarto trimestre de 2025'],
  ['2026-06-23', INDEC_SOURCE_H1, 'Primer trimestre de 2026'],
  ['2026-09-17', INDEC_SOURCE_H2, 'Segundo trimestre de 2026'],
  ['2026-12-16', INDEC_SOURCE_H2, 'Tercer trimestre de 2026'],
];
for (const [date, source, periodo] of PIB_DATES) {
  events.push(ev({
    id: `indec-gdp-${date}`,
    event_type: 'GDP',
    title: `PIB trimestral — Informe de avance del nivel de actividad (${periodo})`,
    date,
    institution: 'INDEC',
    category: 'INDEC',
    status: 'CONFIRMED',
    source,
    source_reference: `Fila "Informe de avance del nivel de actividad. ${periodo}"`,
  }));
}

// ---------------------------------------------------------------------
// TESORO — Cronograma de Licitaciones 2026 (Llamado / Licitación / Liquidación)
//
// El PDF oficial es una grilla de calendario coloreada (no una tabla de
// texto): cada día resaltado indica el tipo de evento según la leyenda
// (Llamado=celeste, Licitación=verde, Liquidación=naranja, Feriados/Otros=
// azul marino). El fetch en vivo del PDF está bloqueado por robots.txt
// (ver tools/README.md); el usuario adjuntó el archivo en la conversación
// con Claude y las fechas de abajo se extrajeron rasterizando el PDF
// (pdftoppm, 300dpi) y clasificando programáticamente el color de fondo de
// cada celda de día contra los 4 colores exactos de la leyenda (muestreo de
// píxeles con Pillow, sin interpretación visual). Las 69 celdas coloreadas
// del calendario (23 Llamado + 23 Licitación + 23 Liquidación) coincidieron
// exactamente (distancia de color 0) con uno de los 4 colores de leyenda —
// ninguna quedó ambigua. Se validó además que las 16 celdas "Feriados/Otros"
// detectadas en la grilla coinciden 1 a 1 con la lista de feriados en texto
// al pie de cada mini-calendario mensual, y que las 23 cadencias
// Llamado→Licitación→Liquidación respetan el patrón T+2 días hábiles
// (ajustado por feriados) usado por el Tesoro. No se cargó ningún evento de
// vencimientos de deuda, resultado fiscal ni otra categoría no solicitada.
// ---------------------------------------------------------------------
const LLAMADO_DATES = ['2026-01-12', '2026-01-26', '2026-02-09', '2026-02-23', '2026-03-10', '2026-03-25', '2026-04-13', '2026-04-24', '2026-05-11', '2026-05-22', '2026-06-08', '2026-06-24', '2026-07-13', '2026-07-27', '2026-08-10', '2026-08-25', '2026-09-09', '2026-09-24', '2026-10-09', '2026-10-26', '2026-11-09', '2026-11-24', '2026-12-09'];
const LICITACION_DATES = ['2026-01-14', '2026-01-28', '2026-02-11', '2026-02-25', '2026-03-12', '2026-03-27', '2026-04-15', '2026-04-28', '2026-05-13', '2026-05-27', '2026-06-10', '2026-06-26', '2026-07-15', '2026-07-29', '2026-08-12', '2026-08-27', '2026-09-11', '2026-09-28', '2026-10-14', '2026-10-28', '2026-11-11', '2026-11-26', '2026-12-11'];
const LIQUIDACION_DATES = ['2026-01-16', '2026-01-30', '2026-02-13', '2026-02-27', '2026-03-16', '2026-03-31', '2026-04-17', '2026-04-30', '2026-05-15', '2026-05-29', '2026-06-12', '2026-06-30', '2026-07-17', '2026-07-31', '2026-08-14', '2026-08-31', '2026-09-15', '2026-09-30', '2026-10-16', '2026-10-30', '2026-11-13', '2026-11-30', '2026-12-15'];

for (const date of LLAMADO_DATES) {
  events.push(ev({
    id: `tesoro-auction_announcement-${date}`,
    event_type: 'AUCTION_ANNOUNCEMENT',
    title: 'Llamado a licitación de Títulos del Tesoro',
    date,
    institution: 'Secretaría de Finanzas',
    category: 'TESORO',
    status: 'CONFIRMED',
    source: TESORO_SOURCE,
    source_reference: 'Celda "Llamado" (celeste), Cronograma de Licitaciones 2026',
  }));
}
for (const date of LICITACION_DATES) {
  events.push(ev({
    id: `tesoro-auction-${date}`,
    event_type: 'AUCTION',
    title: 'Licitación de Títulos del Tesoro',
    date,
    institution: 'Secretaría de Finanzas',
    category: 'TESORO',
    status: 'CONFIRMED',
    source: TESORO_SOURCE,
    source_reference: 'Celda "Licitación" (verde), Cronograma de Licitaciones 2026',
  }));
}
for (const date of LIQUIDACION_DATES) {
  events.push(ev({
    id: `tesoro-settlement-${date}`,
    event_type: 'SETTLEMENT',
    title: 'Liquidación de licitación de Títulos del Tesoro',
    date,
    institution: 'Secretaría de Finanzas',
    category: 'TESORO',
    status: 'CONFIRMED',
    source: TESORO_SOURCE,
    source_reference: 'Celda "Liquidación" (naranja), Cronograma de Licitaciones 2026',
  }));
}

events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1)));

process.stdout.write(JSON.stringify(events, null, 2) + '\n');
