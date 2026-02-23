/**
 * Creador de perfiles ECU: catálogo de PIDs y DTCs, arrastrar a perfil, guardar.
 */
import { api, $ } from '../api.js';

let catalogInited = false;
let pidsCatalog = [];
let dtcsCatalog = [];
let protocolsCatalog = [];

const profilePids = [];
const profileDtcs = [];

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPidItem(pid, isInProfile = false) {
  const pidId = (pid.id || '').toString().toUpperCase().padStart(2, '0');
  const desc = pid.desc ? ` — ${esc(pid.desc)}` : '';
  if (isInProfile) {
    return `<div class="creator-item creator-item-pid" data-pid-id="${esc(pidId)}" data-pid-name="${esc(pid.name)}" data-pid-bytes="${pid.bytes || 1}" data-pid-encode="${esc(pid.encode || '')}" data-pid-min="${pid.min != null ? pid.min : ''}" data-pid-max="${pid.max != null ? pid.max : ''}" draggable="true">
      <span class="creator-item-label">01 ${esc(pidId)} ${esc(pid.name)}${desc}</span>
      <button type="button" class="creator-item-remove" title="Quitar">×</button>
    </div>`;
  }
  return `<div class="creator-item creator-item-pid" data-pid-id="${esc(pidId)}" data-pid-name="${esc(pid.name)}" data-pid-bytes="${pid.bytes || 1}" data-pid-encode="${esc(pid.encode || '')}" data-pid-min="${pid.min != null ? pid.min : ''}" data-pid-max="${pid.max != null ? pid.max : ''}" draggable="true">
    <span class="creator-item-label">01 ${esc(pidId)} ${esc(pid.name)}${desc}</span>
  </div>`;
}

function renderDtcItem(dtc, isInProfile = false) {
  const code = esc(dtc.code || '');
  const desc = dtc.desc ? ` — ${esc(dtc.desc)}` : '';
  if (isInProfile) {
    return `<div class="creator-item creator-item-dtc" data-dtc-code="${code}" draggable="true">
      <span class="creator-item-label">${code}${desc}</span>
      <button type="button" class="creator-item-remove" title="Quitar">×</button>
    </div>`;
  }
  return `<div class="creator-item creator-item-dtc" data-dtc-code="${code}" data-dtc-desc="${esc(dtc.desc || '')}" draggable="true">
    <span class="creator-item-label">${code}${desc}</span>
  </div>`;
}

function filterPids(list, query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return list;
  return list.filter((p) => {
    const id = (p.id || '').toString().toLowerCase();
    const name = (p.name || '').toLowerCase();
    const desc = (p.desc || '').toLowerCase();
    return id.includes(q) || name.includes(q) || desc.includes(q);
  });
}

function filterDtcs(list, query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return list;
  return list.filter((d) => {
    const code = (d.code || '').toLowerCase();
    const desc = (d.desc || '').toLowerCase();
    return code.includes(q) || desc.includes(q);
  });
}

function refreshPidsCatalogList() {
  const listEl = $('creator-pids-catalog');
  const search = ($('creator-pid-search') && $('creator-pid-search').value) || '';
  const filtered = filterPids(pidsCatalog, search);
  if (listEl) listEl.innerHTML = filtered.map((p) => renderPidItem(p, false)).join('');
  bindCatalogDrag(listEl, 'pid');
}

function refreshDtcsCatalogList() {
  const listEl = $('creator-dtcs-catalog');
  const search = ($('creator-dtc-search') && $('creator-dtc-search').value) || '';
  const filtered = filterDtcs(dtcsCatalog, search);
  if (listEl) listEl.innerHTML = filtered.map((d) => renderDtcItem(d, false)).join('');
  bindCatalogDrag(listEl, 'dtc');
}

function refreshProfilePidsList() {
  const listEl = $('creator-pids-profile');
  if (!listEl) return;
  listEl.innerHTML = profilePids.length === 0
    ? '<p class="creator-empty">Arrastra PIDs aquí o haz doble clic en uno del catálogo.</p>'
    : profilePids.map((p) => renderPidItem(p, true)).join('');
  listEl.querySelectorAll('.creator-item-remove').forEach((btn) => {
    btn.onclick = () => {
      const item = btn.closest('.creator-item');
      const id = item && item.dataset.pidId;
      if (id != null) {
        const idx = profilePids.findIndex((p) => (p.id || '').toString().toUpperCase().padStart(2, '0') === id);
        if (idx >= 0) profilePids.splice(idx, 1);
        refreshProfilePidsList();
      }
    };
  });
  listEl.querySelectorAll('.creator-item').forEach((el) => {
    el.draggable = true;
    bindDrag(el, 'pid');
  });
}

function refreshProfileDtcsList() {
  const listEl = $('creator-dtcs-profile');
  if (!listEl) return;
  listEl.innerHTML = profileDtcs.length === 0
    ? '<p class="creator-empty">Arrastra DTCs aquí o haz doble clic en uno del catálogo.</p>'
    : profileDtcs.map((d) => renderDtcItem(d, true)).join('');
  listEl.querySelectorAll('.creator-item-remove').forEach((btn) => {
    btn.onclick = () => {
      const item = btn.closest('.creator-item');
      const code = item && item.dataset.dtcCode;
      if (code != null) {
        const idx = profileDtcs.findIndex((d) => (d.code || '') === code);
        if (idx >= 0) profileDtcs.splice(idx, 1);
        refreshProfileDtcsList();
      }
    };
  });
  listEl.querySelectorAll('.creator-item').forEach((el) => {
    el.draggable = true;
    bindDrag(el, 'dtc');
  });
}

function bindCatalogDrag(container, type) {
  if (!container) return;
  container.querySelectorAll('.creator-item').forEach((el) => {
    el.draggable = true;
    el.ondragstart = (e) => {
      e.dataTransfer.setData('application/json', JSON.stringify({ type, el: el.outerHTML }));
      e.dataTransfer.setData('text/plain', type === 'pid' ? el.dataset.pidId : el.dataset.dtcCode);
      e.dataTransfer.effectAllowed = 'copy';
    };
    el.ondblclick = () => {
      if (type === 'pid') {
        const pid = pidsCatalog.find((p) => (p.id || '').toString().toUpperCase().padStart(2, '0') === (el.dataset.pidId || ''));
        if (pid && !profilePids.some((x) => (x.id || '').toString().toUpperCase().padStart(2, '0') === (pid.id || '').toString().toUpperCase().padStart(2, '0'))) {
          profilePids.push({ ...pid });
          refreshProfilePidsList();
        }
      } else {
        const code = el.dataset.dtcCode;
        const dtc = dtcsCatalog.find((d) => (d.code || '') === code);
        if (dtc && !profileDtcs.some((d) => (d.code || '') === code)) {
          profileDtcs.push({ ...dtc });
          refreshProfileDtcsList();
        }
      }
    };
  });
}

function bindDrag(el, type) {
  if (!el) return;
  el.ondragstart = (e) => {
    e.dataTransfer.setData('application/json', JSON.stringify({ type, fromProfile: true }));
    e.dataTransfer.effectAllowed = 'move';
  };
}

function setupDropZone(zoneEl, type) {
  if (!zoneEl) return;
  zoneEl.ondragover = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    zoneEl.classList.add('creator-drop-over');
  };
  zoneEl.ondragleave = () => zoneEl.classList.remove('creator-drop-over');
  zoneEl.ondrop = (e) => {
    e.preventDefault();
    zoneEl.classList.remove('creator-drop-over');
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.type !== type) return;
      if (data.fromProfile) return;
      if (type === 'pid' && data.el) {
        const id = e.dataTransfer.getData('text/plain') || '';
        const pid = pidsCatalog.find((p) => (p.id || '').toString().toUpperCase().padStart(2, '0') === id.toUpperCase().padStart(2, '0'));
        if (pid && !profilePids.some((p) => (p.id || '').toString().toUpperCase().padStart(2, '0') === (pid.id || '').toString().toUpperCase().padStart(2, '0'))) {
          profilePids.push({ ...pid });
          refreshProfilePidsList();
        }
      } else if (type === 'dtc') {
        const code = e.dataTransfer.getData('text/plain') || '';
        const dtc = dtcsCatalog.find((d) => (d.code || '') === code);
        if (dtc && !profileDtcs.some((d) => (d.code || '') === code)) {
          profileDtcs.push({ ...dtc });
          refreshProfileDtcsList();
        }
      }
    } catch (_) {}
  };
}

function buildProfilePayload() {
  const vehicleName = ($('creator-vehicle-name') && $('creator-vehicle-name').value.trim()) || 'Sin nombre';
  const profileId = ($('creator-profile-id') && $('creator-profile-id').value.trim()).replace(/\.json$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'perfil_nuevo';
  const pids = profilePids.map((p) => ({
    id: (p.id || '').toString().toUpperCase().replace(/^0X/, '').padStart(2, '0'),
    name: p.name || '',
    bytes: p.bytes != null ? p.bytes : 1,
    encode: p.encode != null ? p.encode : 'value',
    min: p.min,
    max: p.max,
  }));
  const typicalDtcs = profileDtcs.map((d) => d.code || '').filter(Boolean);
  return {
    profileId,
    vehicleName,
    protocol: ($('creator-protocol') && $('creator-protocol').value) || 'ISO15765-4_CAN_11BIT_500K',
    requestId: ($('creator-request-id') && $('creator-request-id').value.trim()) || '0x7DF',
    responseId: ($('creator-response-id') && $('creator-response-id').value.trim()) || '0x7E8',
    pids,
    typicalDtcs: typicalDtcs.length ? typicalDtcs : undefined,
  };
}

function setStatus(msg, isError = false) {
  const el = $('creator-status');
  if (el) {
    el.textContent = msg;
    el.style.color = isError ? 'var(--danger)' : 'var(--text-muted)';
  }
}

export async function initEcuProfileCreator() {
  if (catalogInited) {
    refreshPidsCatalogList();
    refreshDtcsCatalogList();
    refreshProfilePidsList();
    refreshProfileDtcsList();
    return;
  }

  const protocolSelect = $('creator-protocol');
  if (protocolSelect) {
    try {
      const r = await api('/ecu-profiles/catalog/protocols', { timeout: 5000 });
      const protocols = (r && r.protocols) || [];
      protocolSelect.innerHTML = protocols.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    } catch (_) {
      protocolSelect.innerHTML = '<option value="ISO15765-4_CAN_11BIT_500K">ISO15765-4_CAN_11BIT_500K</option>';
    }
  }

  try {
    const [pidsRes, dtcsRes] = await Promise.all([
      api('/ecu-profiles/catalog/pids', { timeout: 5000 }),
      api('/ecu-profiles/catalog/dtcs', { timeout: 5000 }),
    ]);
    pidsCatalog = (pidsRes && pidsRes.pids) || [];
    dtcsCatalog = (dtcsRes && dtcsRes.dtcs) || [];
  } catch (e) {
    setStatus('Error al cargar catálogos: ' + (e.message || ''), true);
    return;
  }

  catalogInited = true;
  refreshPidsCatalogList();
  refreshDtcsCatalogList();
  refreshProfilePidsList();
  refreshProfileDtcsList();

  const pidSearch = $('creator-pid-search');
  if (pidSearch) pidSearch.oninput = () => refreshPidsCatalogList();
  const dtcSearch = $('creator-dtc-search');
  if (dtcSearch) dtcSearch.oninput = () => refreshDtcsCatalogList();

  setupDropZone($('creator-pids-profile'), 'pid');
  setupDropZone($('creator-dtcs-profile'), 'dtc');

  const saveBtn = $('creator-save');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const payload = buildProfilePayload();
      if (!payload.profileId) {
        setStatus('Escribe un ID de perfil (nombre de archivo).', true);
        return;
      }
      if (payload.pids.length === 0) {
        setStatus('Añade al menos un PID al perfil.', true);
        return;
      }
      setStatus('Guardando…');
      try {
        const r = await fetch('/api/ecu-profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await r.json();
        if (data.ok) {
          setStatus('Guardado: ' + data.name + '.json');
        } else {
          setStatus(data.error || 'Error al guardar', true);
        }
      } catch (e) {
        setStatus('Error: ' + (e.message || 'sin conexión'), true);
      }
    };
  }

  const downloadBtn = $('creator-download');
  if (downloadBtn) {
    downloadBtn.onclick = () => {
      const payload = buildProfilePayload();
      const profile = {
        vehicleName: payload.vehicleName,
        protocol: payload.protocol,
        requestId: payload.requestId,
        responseId: payload.responseId,
        pids: payload.pids,
      };
      if (payload.typicalDtcs && payload.typicalDtcs.length) profile.typicalDtcs = payload.typicalDtcs;
      const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (payload.profileId || 'perfil') + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus('Descarga iniciada.');
    };
  }
}
