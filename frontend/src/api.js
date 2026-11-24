// Keep local Vite development pointed at the separate FastAPI process. In the
// single-service production container, the browser and API share one origin.
const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:9000/api' : '/api');

export async function api(path, options = {}) {
  const user = JSON.parse(localStorage.getItem('ampwise-user') || 'null');
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
  if (user?.id) headers['X-User-Id'] = String(user.id);
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = result.detail;
    const message = Array.isArray(detail) ? detail.map(item => item.msg).join(', ') : detail || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return result;
}

export { API_BASE };
