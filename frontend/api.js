const API_BASE = 'https://faktura-rs-worker.REPLACE_SUBDOMAIN.workers.dev';

function getToken() {
  return localStorage.getItem('faktura_token') || '';
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getToken()}`,
  };
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Greška na serveru');
  return data;
}

export const api = {
  async login(password) {
    const res = await fetch(`${API_BASE}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Pogrešna lozinka');
    return data;
  },

  getKlijenti: () => apiFetch('/api/klijenti'),
  createKlijent: (b) => apiFetch('/api/klijenti', { method: 'POST', body: JSON.stringify(b) }),
  updateKlijent: (id, b) => apiFetch(`/api/klijenti/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteKlijent: (id) => apiFetch(`/api/klijenti/${id}`, { method: 'DELETE' }),

  getFakture: () => apiFetch('/api/fakture'),
  getFaktura: (id) => apiFetch(`/api/fakture/${id}`),
  createFaktura: (b) => apiFetch('/api/fakture', { method: 'POST', body: JSON.stringify(b) }),
  updateStatus: (id, status) => apiFetch(`/api/fakture/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  deleteFaktura: (id) => apiFetch(`/api/fakture/${id}`, { method: 'DELETE' }),

  getKpo: (od, do_) => apiFetch(`/api/kpo?od=${od}&do=${do_}`),
};

export function requireAuth() {
  if (!localStorage.getItem('faktura_token')) {
    window.location.href = 'login.html';
    return false;
  }
  return true;
}

let toastContainer;
export function toast(msg, type = 'success') {
  if (!toastContainer) {
    toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      document.body.appendChild(toastContainer);
    }
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

export function formatDate(d) {
  if (!d) return '—';
  return d.slice(0, 10).split('-').reverse().join('.');
}

export function formatAmount(n, valuta = 'RSD') {
  if (n === null || n === undefined) return '—';
  const fmt = new Intl.NumberFormat('sr-RS', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${fmt.format(n)} ${valuta}`;
}

export function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function isOverdue(faktura) {
  return faktura.status === 'neplacena' && faktura.datum_valute && faktura.datum_valute < today();
}
