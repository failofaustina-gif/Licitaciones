# Agenda macro — actualización de la capa local de eventos

`liquidez-diaria/events.json` es la única fuente que lee el frontend (`agenda.js`).
Es un archivo estático, generado offline con `generate_events.js` — **no es un
scraper que corre en el navegador**. Se actualiza manualmente, corriendo el
script de nuevo cuando cambian los calendarios oficiales, y commiteando el
`events.json` resultante.

## Cómo correr

```
node generate_events.js > ../events.json
```

## Regla dura

Cada fecha en `generate_events.js` fue extraída de la fuente oficial citada en
su propio `source_url`, y cruzada con un chequeo de día de la semana (ningún
organismo publica en fin de semana) antes de cargarla. Si una fecha no
aparece explícitamente en la fuente oficial, **no se agrega el evento** — no
se completa por continuidad de patrón ni se estima.

## Estado por categoría (última actualización: 22/09/2026)

- **BCRA** (REM, Informe Monetario Mensual, IPOM, Informe de Evolución del
  Mercado de Cambios y Balance Cambiario): cargado completo para 2026 desde
  `bcra.gob.ar/calendario-de-informes/` (tabla HTML). REM no tiene fecha de
  diciembre 2026 publicada todavía — no se inventó. IPOM solo tiene 2 de las
  ~4 fechas trimestrales esperadas publicadas por el BCRA a la fecha de esta
  carga — no se completaron las 2 restantes.
- **INDEC** (IPC, EMAE, PIB trimestral / Informe de avance del nivel de
  actividad): cargado completo para 2026 desde los calendarios semestrales
  en PDF de `indec.gob.ar`.
- **TESORO** (llamado a licitación, licitación, liquidación): cargado
  completo para 2026 (23 llamados, 23 licitaciones, 23 liquidaciones) desde
  el `Cronograma de Licitaciones 2026` de la Secretaría de Finanzas
  (`argentina.gob.ar/sites/default/files/calendario_prensa_0.pdf`). El fetch
  en vivo de ese PDF sigue bloqueado por `robots.txt` para las herramientas
  de esta sesión; el usuario adjuntó el archivo directamente en la
  conversación. El PDF es una grilla de calendario coloreada (no una tabla
  de texto), así que las fechas no se leyeron "a ojo": el PDF se rasterizó a
  300dpi y cada celda de día se clasificó programáticamente contra los 4
  colores exactos de la leyenda (Llamado=celeste, Licitación=verde,
  Liquidación=naranja, Feriados/Otros=azul marino) muestreando píxeles con
  Pillow. Las 69 celdas coloreadas coincidieron exactamente (distancia de
  color 0) con uno de los 4 colores — ninguna quedó ambigua. Se validó
  además que las 16 celdas "Feriados/Otros" detectadas coinciden 1 a 1 con
  la lista de feriados en texto al pie de cada mini-calendario, y que las 23
  cadencias Llamado→Licitación→Liquidación respetan el patrón T+2 días
  hábiles (ajustado por feriados) que usa el Tesoro. No se cargaron
  vencimientos de deuda ni otras categorías del Tesoro no solicitadas.

## Schema de cada evento

Ver el objeto que arma la función `ev()` en `generate_events.js`: `id`,
`event_type`, `title`, `date` (YYYY-MM-DD), `time` (nullable), `institution`,
`category` (`TESORO` | `BCRA` | `INDEC` por ahora), `status` (`CONFIRMED` |
`TENTATIVE`), `source_name`, `source_url`, `source_reference`, `created_at`,
`updated_at`.
