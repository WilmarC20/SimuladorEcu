import { api, $ } from '../api.js';

function renderNetwork(container, network) {
  const w = network.wifi ? `WiFi: ${network.wifi.name} (${network.wifi.mac})` : 'WiFi: no';
  const b = network.bt ? `BT: ${network.bt.name} (${network.bt.mac})` : 'BT: no';
  container.innerHTML = `<div class="kv"><span class="k">Interfaces</span><div class="v">${w}<br>${b}</div></div>`;
}

function renderPorts(container, ports) {
  if (!ports || !ports.length) {
    container.innerHTML = '<div class="kv"><span class="v">No se detectaron puertos</span></div>';
    return;
  }
  container.innerHTML = ports
    .map(
      p => `
    <div class="kv">
      <span class="k">${p.path}</span>
      <div class="v">${p.manufacturer || '—'}</div>
    </div>
  `
    )
    .join('');
}

export async function loadBtAdapters() {
  const sel = $('bt-adapter');
  const msgEl = $('bt-start-msg');
  if (!sel) return;
  try {
    const data = await api('/bt/adapters', { timeout: 8000 });
    const adapters = data.adapters || [];
    const label = (a) => {
      const tag = a.classic === true ? ' — Clásico' : a.classic === false ? ' — BLE' : '';
      return `${a.name} (${a.mac})${tag}`;
    };
    sel.innerHTML = adapters.length
      ? '<option value="">— Elige adaptador —</option>' +
        adapters.map(a => `<option value="${a.name}">${label(a)}</option>`).join('')
      : '<option value="">No hay adaptadores BT</option>';
    if (msgEl) msgEl.textContent = '';
  } catch (e) {
    const isTimeout = e.name === 'AbortError';
    sel.innerHTML = '<option value="">Error al cargar</option>';
    if (msgEl) msgEl.textContent = isTimeout ? 'Timeout. Vuelve a abrir Sistema o recarga.' : '';
  }
}

function renderBtStartedTable(list) {
  const tbody = $('bt-started-tbody');
  if (!tbody) return;
  if (!list || list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="bt-started-empty">Ninguno en modo visible</td></tr>';
    return;
  }
  tbody.innerHTML = list
    .map(
      (row) => `
    <tr data-mac="${row.mac}">
      <td>${escapeHtml(row.name)}</td>
      <td><code>${escapeHtml(row.mac)}</code></td>
      <td>${row.alias ? escapeHtml(row.alias) : '—'}</td>
      <td><button type="button" class="btn btn-ghost bt-stop-row" data-mac="${escapeHtml(row.mac)}">Detener</button></td>
    </tr>
  `
    )
    .join('');
  tbody.querySelectorAll('.bt-stop-row').forEach((btn) => {
    btn.onclick = () => stopBtAdapter(btn.dataset.mac);
  });
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

async function stopBtAdapter(mac) {
  const tbody = $('bt-started-tbody');
  if (!tbody) return;
  try {
    const r = await fetch('/api/bt/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac }),
    });
    const data = await r.json();
    if (data.ok && data.started !== undefined) {
      renderBtStartedTable(data.started);
    } else {
      await loadBtStarted();
    }
    const msgEl = $('bt-start-msg');
    if (msgEl) msgEl.textContent = data.msg || (data.ok ? 'Listo.' : 'Error');
  } catch (e) {
    const msgEl = $('bt-start-msg');
    if (msgEl) msgEl.textContent = 'Error: ' + (e.message || 'sin conexión');
  }
}

export async function loadBtStarted() {
  try {
    const data = await api('/bt/started', { timeout: 5000 });
    renderBtStartedTable(data.started || []);
  } catch (e) {
    const tbody = $('bt-started-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="bt-started-empty">Error al cargar</td></tr>';
  }
}

function bindBtAgentLog() {
  const btn = $('bt-show-log');
  const pre = $('bt-agent-log');
  if (!btn || !pre) return;
  btn.onclick = async () => {
    if (pre.style.display === 'block') {
      pre.style.display = 'none';
      return;
    }
    pre.textContent = 'Cargando…';
    pre.style.display = 'block';
    try {
      const r = await fetch('/api/bt/agent-log');
      const text = await r.text();
      pre.textContent = text || '(vacío)';
    } catch (e) {
      pre.textContent = 'Error: ' + (e.message || 'sin conexión');
    }
  };
}

export async function loadSystem() {
  try {
    const data = await api('/system', { timeout: 10000 });
    renderNetwork($('sistema-network'), data.network);
    renderPorts($('sistema-ports'), data.serialPorts);
  } catch (e) {
    $('sistema-network').innerHTML = $('sistema-ports').innerHTML = '<span class="v">Error</span>';
  }
  await loadBtAdapters();
  await loadBtStarted();
  bindBtAgentLog();
}
