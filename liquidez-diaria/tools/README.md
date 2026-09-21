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

## Estado por categoría (carga inicial, 21/09/2026)

- **BCRA** (REM, Informe Monetario Mensual, IPOM, Informe de Evolución del
  Mercado de Cambios y Balance Cambiario): cargado completo para 2026 desde
  `bcra.gob.ar/calendario-de-informes/` (tabla HTML). REM no tiene fecha de
  diciembre 2026 publicada todavía — no se inventó. IPOM solo tiene 2 de las
  ~4 fechas trimestrales esperadas publicadas por el BCRA a la fecha de esta
  carga — no se completaron las 2 restantes.
- **INDEC** (IPC, EMAE, PIB trimestral / Informe de avance del nivel de
  actividad): cargado completo para 2026 desde los calendarios semestrales
  en PDF de `indec.gob.ar`.
- **TESORO** (llamado a licitación, licitación, liquidación): **sin cargar**.
  El PDF del cronograma anual
  (`argentina.gob.ar/sites/default/files/calendario_prensa_0.pdf`) está
  bloqueado por `robots.txt` para las herramientas de fetch disponibles en
  esta sesión de Claude — no se pudo leer su contenido de forma confiable, y
  no se va a adivinar. Opciones para cargarlo:
  1. Adjuntar el PDF (o pegar su contenido) en la conversación con Claude
     para que lo extraiga y valide con el mismo método (chequeo de día de
     semana + revisión fila por fila) usado para BCRA/INDEC.
  2. Cargar los eventos a mano siguiendo el schema de `events.json`, citando
     siempre `source_url` = la URL del cronograma oficial.

## Schema de cada evento

Ver el objeto que arma la función `ev()` en `generate_events.js`: `id`,
`event_type`, `title`, `date` (YYYY-MM-DD), `time` (nullable), `institution`,
`category` (`TESORO` | `BCRA` | `INDEC` por ahora), `status` (`CONFIRMED` |
`TENTATIVE`), `source_name`, `source_url`, `source_reference`, `created_at`,
`updated_at`.
