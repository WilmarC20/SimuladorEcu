/**
 * Cliente API del dashboard (Raspberry Pi).
 */
export function api(path, opts = {}) {
  const { timeout, ...fetchOpts } = opts;
  const doFetch = (signal) =>
    fetch('/api' + path, { ...fetchOpts, signal })
      .then(async (r) => {
        const text = await r.text();
        if (!r.ok) throw new Error('HTTP ' + r.status + (text ? ': ' + text.slice(0, 80) : ''));
        try {
          return text ? JSON.parse(text) : {};
        } catch (e) {
          throw new Error('Respuesta no válida del servidor');
        }
      });
  if (timeout && timeout > 0) {
    const ac = new AbortController();
    const id = setTimeout(() => ac.abort(), timeout);
    return doFetch(ac.signal).finally(() => clearTimeout(id));
  }
  return doFetch();
}

export function postWithTimeout(path, body, timeoutMs = 8000) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), timeoutMs);
  const postBody = body == null ? '' : (body instanceof URLSearchParams ? body : new URLSearchParams(body));
  return fetch('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: postBody,
    signal: ac.signal,
  }).then(r => r.json()).finally(() => clearTimeout(id));
}

export function $(id) {
  return document.getElementById(id);
}
