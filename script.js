/* =====================================================================
   Calendar website — script.js
   Sections:
   1. Storage layer — plain browser localStorage. This is the ONLY
      backend: no cloud service, no Google Sheet, nothing server-side.
   2. Date / week-number helpers
   3. App state
   4. Calendar rendering
   5. Event modal (add / edit / delete)
   6. All-events drawer
   7. CSV import from a local file (no export — localStorage is the
      single source of truth now)
   8. Theme toggle
   9. Wiring / init
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. Storage layer — plain browser localStorage, nothing else
   ------------------------------------------------------------------ */
function storageGet(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.error('Could not read', key, e);
    return null;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.error('Could not save', key, e);
    return false;
  }
}

/* ---------------------------------------------------------------------
   1b. Local event storage helpers (no cloud backend — everything lives
   in the browser's localStorage, same place the theme preference is kept)
   ------------------------------------------------------------------ */
function makeLocalId() {
  return 'evt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

async function loadEventsFromStorage() {
  const raw = await storageGet('calendar-events');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('Could not parse stored events', e);
    return [];
  }
}

/* ---------------------------------------------------------------------
   2. Date / week helpers
   ------------------------------------------------------------------ */
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function pad2(n) { return String(n).padStart(2, '0'); }

function formatDateISO(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

// Parses a 'YYYY-MM-DD' string into a local Date (avoids UTC off-by-one issues).
function parseDateISO(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isoShortLabel(str) {
  const d = parseDateISO(str);
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

// Standard ISO-8601 week number + week-year (the year the Thursday of that week falls in).
function getISOWeekInfo(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // move to Thursday of this week
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
  return { week, year: isoYear };
}

/* ---------------------------------------------------------------------
   3. App state
   ------------------------------------------------------------------ */
const today = new Date();
const todayISO = formatDateISO(today);
const DEFAULT_EVENT_COLOR = '#ff9a62';

const state = {
  viewYear: today.getFullYear(),
  viewMonth: today.getMonth(), // 0-indexed
  events: [],       // { id, startDate, endDate, title, time, notes }
  theme: 'dark',
  drawerOpen: false,
  modalOpen: false,
  sheetModalOpen: false,
};

/* ---------------------------------------------------------------------
   Element references
   ------------------------------------------------------------------ */
const el = {
  monthYearLabel: document.getElementById('monthYearLabel'),
  todayInfo: document.getElementById('todayInfo'),
  monthSelect: document.getElementById('monthSelect'),
  yearSelect: document.getElementById('yearSelect'),
  prevMonth: document.getElementById('prevMonth'),
  nextMonth: document.getElementById('nextMonth'),
  todayBtn: document.getElementById('todayBtn'),
  calendarGrid: document.getElementById('calendarGrid'),
  addEventBtn: document.getElementById('addEventBtn'),
  allEventsBtn: document.getElementById('allEventsBtn'),

  drawer: document.getElementById('eventsDrawer'),
  closeDrawer: document.getElementById('closeDrawer'),
  eventsList: document.getElementById('eventsList'),
  sheetConnectBtn: document.getElementById('sheetConnectBtn'),

  sheetModal: document.getElementById('sheetModal'),
  closeSheetModal: document.getElementById('closeSheetModal'),
  importCsvFileInput: document.getElementById('importCsvFileInput'),
  importCsvBtn: document.getElementById('importCsvBtn'),
  syncStatus: document.getElementById('syncStatus'),

  backdrop: document.getElementById('backdrop'),

  modal: document.getElementById('eventModal'),
  closeModal: document.getElementById('closeModal'),
  modalDateLabel: document.getElementById('modalDateLabel'),
  existingEventsList: document.getElementById('existingEventsList'),
  eventForm: document.getElementById('eventForm'),
  eventId: document.getElementById('eventId'),
  eventStartDate: document.getElementById('eventStartDate'),
  eventTitle: document.getElementById('eventTitle'),
  eventColor: document.getElementById('eventColor'),
  eventEndDate: document.getElementById('eventEndDate'),
  eventNotes: document.getElementById('eventNotes'),
  deleteEventBtn: document.getElementById('deleteEventBtn'),

  themeToggle: document.getElementById('themeToggle'),
  iconMoon: document.getElementById('iconMoon'),
  iconSun: document.getElementById('iconSun'),

  toast: document.getElementById('toast'),
};

let toastTimer = null;
function showToast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
}

/* ---------------------------------------------------------------------
   4. Calendar rendering
   ------------------------------------------------------------------ */
function populateMonthYearSelectors() {
  el.monthSelect.innerHTML = MONTH_NAMES.map((m, i) => `<option value="${i}">${m}</option>`).join('');
  const startYear = today.getFullYear() - 30;
  const endYear = today.getFullYear() + 30;
  let opts = '';
  for (let y = startYear; y <= endYear; y++) opts += `<option value="${y}">${y}</option>`;
  el.yearSelect.innerHTML = opts;
}

function eventsForDate(dateStr) {
  return state.events.filter(e => dateStr >= e.startDate && dateStr <= (e.endDate || e.startDate));
}

function renderCalendar() {
  el.monthSelect.value = String(state.viewMonth);
  el.yearSelect.value = String(state.viewYear);
  el.monthYearLabel.textContent = `${MONTH_NAMES[state.viewMonth]} ${state.viewYear}`;

  el.todayInfo.innerHTML = `Today is ${today.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`;

  // Build the 42-cell (6 week) grid, always starting on a Sunday.
  const firstOfMonth = new Date(state.viewYear, state.viewMonth, 1);
  const gridStart = new Date(state.viewYear, state.viewMonth, 1 - firstOfMonth.getDay());

  el.calendarGrid.innerHTML = '';
  for (let row = 0; row < 6; row++) {
    const rowEl = document.createElement('div');
    rowEl.className = 'calendar-row';

    for (let col = 0; col < 7; col++) {
      const cellDate = new Date(gridStart);
      cellDate.setDate(gridStart.getDate() + row * 7 + col);
      const cellISO = formatDateISO(cellDate);
      const isMuted = cellDate.getMonth() !== state.viewMonth;
      const isToday = cellISO === todayISO;
      const dayEvents = eventsForDate(cellISO);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day-cell' + (isMuted ? ' muted' : '') + (isToday ? ' today' : '');
      btn.dataset.date = cellISO;
      btn.setAttribute('aria-label', cellDate.toDateString());

      const num = document.createElement('span');
      num.className = 'day-num';
      num.textContent = cellDate.getDate();
      btn.appendChild(num);

      if (dayEvents.length) {
        btn.classList.add('has-event');
        // Use the first event's color as the background of the day circle
        const eventColor = dayEvents[0].color || DEFAULT_EVENT_COLOR;
        if (!isToday) {
          num.style.background = eventColor;
        }
      }

      btn.addEventListener('click', () => openModalForDate(cellISO));
      rowEl.appendChild(btn);
    }

    el.calendarGrid.appendChild(rowEl);
  }
}

/* ---------------------------------------------------------------------
   5. Event modal
   ------------------------------------------------------------------ */
function updateBackdrop() {
  const visible = state.modalOpen || state.sheetModalOpen;
  el.backdrop.hidden = !visible;
  requestAnimationFrame(() => el.backdrop.classList.toggle('visible', visible));
}

function resetFormForNewEvent(dateStr) {
  el.eventId.value = '';
  el.eventStartDate.value = dateStr;
  el.eventTitle.value = '';
  el.eventColor.value = DEFAULT_EVENT_COLOR;
  el.eventEndDate.value = '';
  el.eventEndDate.min = dateStr;
  el.eventNotes.value = '';
  el.deleteEventBtn.hidden = true;
}

function loadEventIntoForm(evt) {
  el.eventId.value = evt.id;
  el.eventStartDate.value = evt.startDate;
  el.eventTitle.value = evt.title;
  el.eventColor.value = evt.color || DEFAULT_EVENT_COLOR;
  el.eventEndDate.value = (evt.endDate && evt.endDate !== evt.startDate) ? evt.endDate : '';
  el.eventEndDate.min = evt.startDate;
  el.eventNotes.value = evt.notes || '';
  el.deleteEventBtn.hidden = false;
}

function renderExistingEventsForModal(dateStr) {
  const list = eventsForDate(dateStr).sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (!list.length) {
    el.existingEventsList.innerHTML = '';
    return;
  }
  el.existingEventsList.innerHTML = list.map(evt => `
    <div class="existing-event-item" data-id="${evt.id}">
      <span class="dot" style="background:${evt.color || DEFAULT_EVENT_COLOR}"></span>
      <div class="info">
        <div class="t">${escapeHTML(evt.title)}</div>
        <div class="s">${isoShortLabel(evt.startDate)}${evt.endDate && evt.endDate !== evt.startDate ? ' &ndash; ' + isoShortLabel(evt.endDate) : ''}</div>
      </div>
    </div>
  `).join('');

  el.existingEventsList.querySelectorAll('.existing-event-item').forEach(item => {
    item.addEventListener('click', () => {
      const evt = state.events.find(e => e.id === item.dataset.id);
      if (evt) loadEventIntoForm(evt);
    });
  });
}

function formatTime12(t) {
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${pad2(m)} ${period}`;
}

function escapeHTML(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function openModalForDate(dateStr) {
  const d = parseDateISO(dateStr);
  el.modalDateLabel.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  renderExistingEventsForModal(dateStr);
  resetFormForNewEvent(dateStr);
  state.modalOpen = true;
  el.modal.hidden = false;
  updateBackdrop();
  el.eventTitle.focus();
}

function closeEventModal() {
  state.modalOpen = false;
  el.modal.hidden = true;
  updateBackdrop();
}

async function saveEvents() {
  await storageSet('calendar-events', JSON.stringify(state.events));
}

el.eventForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = el.eventTitle.value.trim();
  if (!title) return;

  const startDate = el.eventStartDate.value;
  let endDate = el.eventEndDate.value || startDate;
  if (endDate < startDate) endDate = startDate;

  const id = el.eventId.value;
  const payload = {
    startDate,
    endDate,
    title,
    color: el.eventColor.value,
    time: '',
    notes: el.eventNotes.value.trim(),
  };

  try {
    if (id) {
      const idx = state.events.findIndex(ev => ev.id === id);
      if (idx !== -1) state.events[idx] = { ...state.events[idx], ...payload, id };
    } else {
      payload.id = makeLocalId();
      state.events.push(payload);
    }
    await saveEvents();
  } catch (err) {
    console.error(err);
    showToast("Couldn't save the event");
    return;
  }

  renderCalendar();
  renderEventsList();
  renderExistingEventsForModal(startDate);
  resetFormForNewEvent(startDate);
  showToast('Event saved');
});

el.deleteEventBtn.addEventListener('click', async () => {
  const id = el.eventId.value;
  if (!id) return;
  try {
    state.events = state.events.filter(ev => ev.id !== id);
    await saveEvents();
  } catch (err) {
    console.error(err);
    showToast("Couldn't delete the event");
    return;
  }
  renderCalendar();
  renderEventsList();
  const dateStr = el.eventStartDate.value;
  renderExistingEventsForModal(dateStr);
  resetFormForNewEvent(dateStr);
  showToast('Event deleted');
});

// Changing the start date re-points the modal at the new date and keeps
// the "Ends" field from going earlier than the start.
el.eventStartDate.addEventListener('change', () => {
  const v = el.eventStartDate.value;
  if (!v) return;
  el.eventEndDate.min = v;
  if (el.eventEndDate.value && el.eventEndDate.value < v) el.eventEndDate.value = '';
  el.modalDateLabel.textContent = parseDateISO(v).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  renderExistingEventsForModal(v);
});

el.closeModal.addEventListener('click', closeEventModal);
el.addEventBtn.addEventListener('click', () => openModalForDate(todayISO));

/* ---------------------------------------------------------------------
   6. All-events drawer
   ------------------------------------------------------------------ */
function openDrawer() {
  state.drawerOpen = true;
  el.drawer.classList.add('open');
  el.drawer.setAttribute('aria-hidden', 'false');
  el.allEventsBtn.hidden = true;
  renderEventsList();
}

function closeDrawerFn() {
  state.drawerOpen = false;
  el.drawer.classList.remove('open');
  el.drawer.setAttribute('aria-hidden', 'true');
  el.allEventsBtn.hidden = false;
}

function renderEventsList() {
  if (!state.events.length) {
    el.eventsList.innerHTML = '<p class="empty-state">No events yet.<br>Click a date on the calendar to add one.</p>';
    return;
  }

  const sorted = [...state.events].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title));

  const groups = [];
  let currentKey = null;
  sorted.forEach(evt => {
    const d = parseDateISO(evt.startDate);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    if (key !== currentKey) {
      groups.push({ key, label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`, events: [] });
      currentKey = key;
    }
    groups[groups.length - 1].events.push(evt);
  });

  el.eventsList.innerHTML = groups.map(group => `
    <div class="month-group">
      <h3 class="month-heading">${group.label}</h3>
      ${group.events.map(evt => `
        <div class="event-row" data-id="${evt.id}">
          <span class="event-date">${isoShortLabel(evt.startDate)}${evt.endDate && evt.endDate !== evt.startDate ? '&ndash;' + isoShortLabel(evt.endDate) : ''}</span>
          <div class="event-info">
            <span class="event-title">${escapeHTML(evt.title)}</span>
            ${evt.time ? `<span class="event-time">${formatTime12(evt.time)}</span>` : ''}
          </div>
          <button class="event-delete" type="button" aria-label="Delete event" data-id="${evt.id}">&times;</button>
        </div>
      `).join('')}
    </div>
  `).join('');

  el.eventsList.querySelectorAll('.event-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.event-delete')) return;
      const evt = state.events.find(ev => ev.id === row.dataset.id);
      if (!evt) return;
      const d = parseDateISO(evt.startDate);
      state.viewYear = d.getFullYear();
      state.viewMonth = d.getMonth();
      renderCalendar();
      openModalForDate(evt.startDate);
      loadEventIntoForm(evt);
    });
  });

  el.eventsList.querySelectorAll('.event-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        state.events = state.events.filter(ev => ev.id !== btn.dataset.id);
        await saveEvents();
      } catch (err) {
        console.error(err);
        showToast("Couldn't delete the event");
        return;
      }
      renderCalendar();
      renderEventsList();
      showToast('Event deleted');
    });
  });
}

el.allEventsBtn.addEventListener('click', openDrawer);
el.closeDrawer.addEventListener('click', closeDrawerFn);
el.backdrop.addEventListener('click', () => {
  if (state.modalOpen) closeEventModal();
  if (state.sheetModalOpen) closeSheetModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (state.modalOpen) closeEventModal();
  else if (state.sheetModalOpen) closeSheetModal();
  else if (state.drawerOpen) closeDrawerFn();
});

/* ---------------------------------------------------------------------
   7. Google Sheet modal + CSV import / export
   ------------------------------------------------------------------ */
function openSheetModal() {
  state.sheetModalOpen = true;
  el.sheetModal.hidden = false;
  updateBackdrop();
}

function closeSheetModal() {
  state.sheetModalOpen = false;
  el.sheetModal.hidden = true;
  updateBackdrop();
}

el.sheetConnectBtn.addEventListener('click', openSheetModal);
el.closeSheetModal.addEventListener('click', closeSheetModal);
function parseCSVText(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c === '\r') {
      // skip
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function normalizeDateStr(raw) {
  if (!raw) return null;
  raw = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return formatDateISO(d);
}

el.importCsvBtn.addEventListener('click', () => el.importCsvFileInput.click());

el.importCsvFileInput.addEventListener('change', () => {
  const file = el.importCsvFileInput.files && el.importCsvFileInput.files[0];
  if (!file) return;

  el.syncStatus.className = 'sync-status';
  el.syncStatus.textContent = 'Importing…';

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const text = String(reader.result || '');
      const rows = parseCSVText(text);
      if (!rows.length) throw new Error('The file looks empty.');

      let dataRows = rows;
      if (normalizeDateStr(rows[0][0]) === null) dataRows = rows.slice(1); // drop header row

      const imported = [];
      dataRows.forEach((row) => {
        const startDate = normalizeDateStr(row[0]);
        const title = (row[2] || '').trim();
        if (!startDate || !title) return;
        const endDateRaw = normalizeDateStr(row[1]);
        imported.push({
          id: makeLocalId(),
          startDate,
          endDate: endDateRaw && endDateRaw >= startDate ? endDateRaw : startDate,
          title,
          time: (row[3] || '').trim(),
          notes: (row[4] || '').trim(),
        });
      });

      state.events = state.events.concat(imported);
      await saveEvents();
      renderCalendar();
      renderEventsList();

      el.syncStatus.className = 'sync-status ok';
      el.syncStatus.textContent = `Imported ${imported.length} event(s) from the file.`;
      setTimeout(() => closeSheetModal(), 1200);
    } catch (err) {
      console.error(err);
      el.syncStatus.className = 'sync-status error';
      el.syncStatus.textContent = "Couldn't read that file. Make sure it's a CSV exported from this app.";
    } finally {
      el.importCsvFileInput.value = '';
    }
  };
  reader.onerror = () => {
    el.syncStatus.className = 'sync-status error';
    el.syncStatus.textContent = 'Could not read the file.';
  };
  reader.readAsText(file);
});

/* ---------------------------------------------------------------------
   8. Theme toggle
   ------------------------------------------------------------------ */
async function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  el.iconMoon.hidden = theme !== 'dark';
  el.iconSun.hidden = theme === 'dark';
  await storageSet('calendar-theme', theme);
}

el.themeToggle.addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));

/* ---------------------------------------------------------------------
   9. Navigation wiring
   ------------------------------------------------------------------ */
el.prevMonth.addEventListener('click', () => {
  state.viewMonth--;
  if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear--; }
  renderCalendar();
});

el.nextMonth.addEventListener('click', () => {
  state.viewMonth++;
  if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear++; }
  renderCalendar();
});

el.monthSelect.addEventListener('change', () => {
  state.viewMonth = parseInt(el.monthSelect.value, 10);
  renderCalendar();
});

el.yearSelect.addEventListener('change', () => {
  state.viewYear = parseInt(el.yearSelect.value, 10);
  renderCalendar();
});

el.todayBtn.addEventListener('click', () => {
  state.viewYear = today.getFullYear();
  state.viewMonth = today.getMonth();
  renderCalendar();
});

/* ---------------------------------------------------------------------
   Init
   ------------------------------------------------------------------ */
async function init() {
  populateMonthYearSelectors();

  const savedTheme = await storageGet('calendar-theme');
  await setTheme(savedTheme === 'light' ? 'light' : 'dark');

  state.events = await loadEventsFromStorage();

  renderCalendar();
}

init();