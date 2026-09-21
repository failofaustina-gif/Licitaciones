/* =========================================================================
   Agenda macroeconómica — Monitor Monetario Argentina

   Módulo independiente del módulo BCRA ("Liquidez diaria"): no comparte
   estado ni funciones con app.js. Se agrega como sección propia arriba de
   "Liquidez diaria" en la misma página.

   Reglas duras de este módulo:
   - Cero eventos inventados. Cada evento sale de liquidez-diaria/events.json,
     una capa LOCAL generada offline a partir de calendarios oficiales
     (ver tools/generate_events.js) — el navegador NUNCA hace fetch en vivo
     a BCRA, INDEC ni Tesoro para armar esta agenda.
   - Un evento sin fecha respaldada por fuente oficial no se crea. La
     ausencia de fecha es ausencia del evento, no una fecha estimada.
   - No se hacen inferencias sobre la importancia de un evento ni relaciones
     causales automáticas con movimientos de mercado.
   - Los eventos pasados no se eliminan: quedan disponibles para usarse como
     marcadores sobre series temporales en una etapa posterior (no
     implementada todavía).
   ========================================================================= */

(() => {
  'use strict';

  const EVENTS_URL = 'events.json';
  const PROXIMOS_LIMIT = 8;

  const CATEGORY_LABEL = { TESORO: 'Tesoro', BCRA: 'BCRA', INDEC: 'INDEC' };

  const MESES_CORTOS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  const state = {
    events: [],
    loadError: null,
    view: 'proximos', // 'proximos' | 'mes'
    mesCursor: null,  // { year, month } — month es 0-11
    expanded: new Set(),
  };

  function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function parseISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return { y, m, d };
  }

  function formatDayMonth(iso) {
    const { m, d } = parseISO(iso);
    return `${String(d).padStart(2, '0')} ${MESES_CORTOS[m - 1]}`;
  }

  function formatDMY(iso) {
    const { y, m, d } = parseISO(iso);
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  async function loadEvents() {
    try {
      const resp = await fetch(EVENTS_URL, { headers: { Accept: 'application/json' } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (!Array.isArray(data)) throw new Error('events.json no es un array');
      // Nunca se corrige/inventa una fecha faltante: un evento sin "date"
      // válido se descarta silenciosamente en vez de mostrarse con un dato
      // fabricado.
      state.events = data.filter((e) => e && typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
      state.loadError = null;
    } catch (err) {
      state.events = [];
      state.loadError = (err && err.message) || 'Error desconocido';
    }
  }

  function eventRowHtml(ev, isExpanded) {
    const cat = (ev.category || '').toUpperCase();
    const catClass = cat === 'TESORO' ? 'agenda-tag--tesoro' : cat === 'BCRA' ? 'agenda-tag--bcra' : cat === 'INDEC' ? 'agenda-tag--indec' : 'agenda-tag--otros';
    const catLabel = CATEGORY_LABEL[cat] || cat || 'Otros';
    const statusLabel = ev.status === 'TENTATIVE' ? 'TENTATIVA' : 'CONFIRMADA';
    const statusClass = ev.status === 'TENTATIVE' ? 'agenda-status--tentative' : 'agenda-status--confirmed';

    let detail = '';
    if (isExpanded) {
      const sourceLink = ev.source_url
        ? `<a href="${escapeHtml(ev.source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ev.source_name || ev.source_url)}</a>`
        : escapeHtml(ev.source_name || 'Dato no disponible');
      detail = `
        <div class="agenda-detail">
          <div class="agenda-detail__row"><span>Fuente</span><span>${sourceLink}</span></div>
          <div class="agenda-detail__row"><span>Institución</span><span>${escapeHtml(ev.institution || 'Dato no disponible')}</span></div>
          <div class="agenda-detail__row"><span>Categoría</span><span>${escapeHtml(catLabel)}</span></div>
          <div class="agenda-detail__row"><span>Estado</span><span class="agenda-status ${statusClass}">${statusLabel}</span></div>
          ${ev.source_reference ? `<div class="agenda-detail__ref">${escapeHtml(ev.source_reference)}</div>` : ''}
        </div>`;
    }

    return `
      <li class="agenda-row${isExpanded ? ' agenda-row--open' : ''}">
        <button type="button" class="agenda-row__btn" data-event-id="${escapeHtml(ev.id)}" aria-expanded="${isExpanded ? 'true' : 'false'}">
          <span class="agenda-tag ${catClass}">${escapeHtml(catLabel)}</span>
          <span class="agenda-row__date">${escapeHtml(formatDayMonth(ev.date))}</span>
          <span class="agenda-row__title">${escapeHtml(ev.title)}</span>
        </button>
        ${detail}
      </li>`;
  }

  function renderList(container, events) {
    if (!events.length) {
      container.innerHTML = '<p class="agenda-empty">No hay eventos cargados para este período.</p>';
      return;
    }
    const today = todayISO();
    const parts = [];
    let printedHoy = false;
    for (const ev of events) {
      if (!printedHoy && ev.date === today) {
        parts.push('<li class="agenda-divider">HOY</li>');
        printedHoy = true;
      }
      parts.push(eventRowHtml(ev, state.expanded.has(ev.id)));
    }
    container.innerHTML = `<ul class="agenda-list">${parts.join('')}</ul>`;
    container.querySelectorAll('.agenda-row__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.eventId;
        if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
        renderCurrentView();
      });
    });
  }

  function renderProximos() {
    const container = document.getElementById('agenda-body');
    if (!container) return;
    const today = todayISO();
    const upcoming = state.events
      .filter((e) => e.date >= today)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .slice(0, PROXIMOS_LIMIT);
    renderList(container, upcoming);
  }

  function renderMes() {
    const container = document.getElementById('agenda-body');
    const labelEl = document.getElementById('agenda-mes-label');
    if (!container) return;
    if (!state.mesCursor) {
      const { y, m } = parseISO(todayISO());
      state.mesCursor = { year: y, month: m - 1 };
    }
    const { year, month } = state.mesCursor;
    if (labelEl) labelEl.textContent = `${MESES_LARGOS[month]} ${year}`;
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const inMonth = state.events
      .filter((e) => e.date.startsWith(prefix))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    renderList(container, inMonth);
  }

  function renderCurrentView() {
    if (state.view === 'mes') renderMes(); else renderProximos();
  }

  function setView(view) {
    state.view = view;
    document.querySelectorAll('.agenda-view-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.agendaView === view);
      b.setAttribute('aria-pressed', String(b.dataset.agendaView === view));
    });
    const mesNav = document.getElementById('agenda-mes-nav');
    if (mesNav) mesNav.hidden = view !== 'mes';
    renderCurrentView();
  }

  function shiftMonth(delta) {
    if (!state.mesCursor) return;
    let { year, month } = state.mesCursor;
    month += delta;
    if (month < 0) { month = 11; year -= 1; }
    if (month > 11) { month = 0; year += 1; }
    state.mesCursor = { year, month };
    renderMes();
  }

  function wireControls() {
    document.querySelectorAll('.agenda-view-btn').forEach((btn) => {
      btn.addEventListener('click', () => setView(btn.dataset.agendaView));
    });
    const prevBtn = document.getElementById('agenda-mes-prev');
    const nextBtn = document.getElementById('agenda-mes-next');
    if (prevBtn) prevBtn.addEventListener('click', () => shiftMonth(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => shiftMonth(1));
  }

  async function init() {
    wireControls();
    const container = document.getElementById('agenda-body');
    if (container) container.innerHTML = '<p class="agenda-empty">Cargando agenda…</p>';
    await loadEvents();
    if (state.loadError) {
      if (container) container.innerHTML = `<p class="agenda-empty">Dato no disponible: no se pudo cargar la agenda local (${escapeHtml(state.loadError)}).</p>`;
      return;
    }
    renderCurrentView();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
