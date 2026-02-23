/**
 * Entrada del dashboard. Navegación, inicialización y intervalos.
 * Versión UI: 2.0.0
 */
import { $ } from './api.js';
import { loadResumen } from './pages/resumen.js';
import { loadSystem, loadBtStarted } from './pages/sistema.js';
import { loadGpsPorts, bindGps } from './pages/gps.js';
import { pollObd2, bindObd2, loadGpsT38 } from './pages/obd2.js';
import { initEcuProfileCreator } from './pages/ecu-profile-creator.js';
import { initRouteCreator, bindRouteCreator } from './pages/route-creator.js';
import { initImportTorque } from './pages/import-torque.js';

const UI_VERSION = '2.1.0';

function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function initKioskMode() {
  if (isTouchDevice()) {
    document.documentElement.classList.add('touch-device');
    document.body.classList.add('touch-device');
  }
}

const PAGE_TITLES = {
  resumen: 'Resumen',
  sistema: 'Sistema (Pi)',
  obd2: 'Emulador OBD2',
  gps: 'Emulador GPS NEO',
  routes: 'Creador de rutas',
  hardware: 'Hardware (Pi 4)',
  'import-torque': 'Importar Torque',
  ayuda: 'Ayuda',
};

function setPageTitle(page) {
  const el = document.getElementById('topbar-title');
  if (el) el.textContent = PAGE_TITLES[page] || 'OBD2 + GPS NEO';
}

function closeMenu() {
  document.body.classList.remove('menu-open');
}

function initMenu() {
  const btn = document.getElementById('btn-menu');
  const overlay = document.getElementById('menu-overlay');
  const sidebar = document.getElementById('sidebar');
  if (btn) btn.addEventListener('click', () => document.body.classList.toggle('menu-open'));
  if (overlay) overlay.addEventListener('click', closeMenu);
  // Evitar que arrastrar el menú o el overlay desplace la página (táctil)
  function preventMove(e) {
    if (e.target === overlay || (sidebar && sidebar.contains(e.target))) e.preventDefault();
  }
  overlay && overlay.addEventListener('touchmove', preventMove, { passive: false });
  sidebar && sidebar.addEventListener('touchmove', preventMove, { passive: false });
}

function initTabs() {
  const container = document.querySelector('.tabs-obd2');
  if (!container) return;
  container.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      if (!tabId) return;
      container.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      container.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const panel = document.getElementById(tabId);
      if (panel) panel.classList.add('active');
      if (tabId === 'obd2-crear-perfil') initEcuProfileCreator();
    });
  });
}

function initNav() {
  document.querySelectorAll('.nav a').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const page = a.dataset.page;
      if (!page) return;
      closeMenu();
      document.querySelectorAll('.nav a').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
      a.classList.add('active');
      const pageEl = $('page-' + page);
      if (pageEl) pageEl.classList.add('active');
      setPageTitle(page);
      if (page === 'sistema') loadSystem();
      if (page === 'gps') { loadGpsPorts(); loadGpsT38(); }
      if (page === 'routes') initRouteCreator();
    });
  });
}

function bindBtStart() {
  const btn = $('bt-start');
  const msgEl = $('bt-start-msg');
  if (!btn) return;
  btn.onclick = async () => {
    const sel = $('bt-adapter');
    const name = sel ? sel.value : '';
    if (!name) {
      if (msgEl) msgEl.textContent = 'Elige un adaptador.';
      return;
    }
    if (msgEl) msgEl.textContent = 'Enviando…';
    try {
      const r = await fetch('/api/bt/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await r.json();
      if (msgEl) {
        msgEl.textContent = data.msg || (data.ok ? 'Listo.' : 'Error al activar BT');
        msgEl.style.color = data.ok ? 'var(--accent)' : 'var(--danger)';
      }
      if (data.ok && data.started !== undefined) loadBtStarted();
    } catch (e) {
      if (msgEl) {
        msgEl.textContent = 'Error: ' + (e.message || 'sin conexión');
        msgEl.style.color = 'var(--danger)';
      }
    }
  };
  const stopBtn = $('bt-stop');
  if (stopBtn && msgEl) {
    stopBtn.onclick = async () => {
      msgEl.textContent = 'Enviando…';
      try {
        const r = await fetch('/api/bt/stop', { method: 'POST' });
        const data = await r.json();
        msgEl.textContent = data.msg || (data.ok ? 'Listo.' : 'Error');
        msgEl.style.color = data.ok ? 'var(--accent)' : 'var(--danger)';
        if (data.ok) loadBtStarted();
      } catch (e) {
        msgEl.textContent = 'Error: ' + (e.message || 'sin conexión');
        msgEl.style.color = 'var(--danger)';
      }
    };
  }
}

const RESUMEN_INTERVAL_MS = 20000;
const OBD2_POLL_INTERVAL_MS = 4000;

function scheduleResumen() {
  loadResumen().finally(() => {
    setTimeout(scheduleResumen, RESUMEN_INTERVAL_MS);
  });
}

function scheduleObd2Poll() {
  pollObd2().finally(() => {
    setTimeout(scheduleObd2Poll, OBD2_POLL_INTERVAL_MS);
  });
}

function bindReload() {
  const btn = document.getElementById('btn-reload');
  if (btn) btn.addEventListener('click', () => location.reload());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) {
      e.preventDefault();
      location.reload();
    }
  });
}

function initImgModal() {
  const overlay = document.getElementById('img-modal-overlay');
  const modalImg = document.getElementById('img-modal-img');
  const closeBtn = document.querySelector('.img-modal-close');
  if (!overlay || !modalImg) return;
  document.querySelectorAll('.btn-img-large').forEach(btn => {
    btn.addEventListener('click', () => {
      const fig = btn.closest('.diagram-img-wrap');
      const img = fig && fig.querySelector('img');
      if (img && img.src) {
        modalImg.src = img.src;
        modalImg.alt = img.alt || 'Imagen ampliada';
        overlay.classList.add('is-open');
        overlay.setAttribute('aria-hidden', 'false');
      }
    });
  });
  function closeModal() {
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
  }
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

function init() {
  initKioskMode();
  const verEl = document.getElementById('version-badge');
  if (verEl) verEl.textContent = 'v' + UI_VERSION;
  initMenu();
  initTabs();
  initNav();
  initImgModal();
  setPageTitle('resumen');
  bindObd2();
  bindGps();
  bindRouteCreator();
  initImportTorque();
  bindBtStart();
  bindReload();

  scheduleResumen();
  scheduleObd2Poll();
}

init();
