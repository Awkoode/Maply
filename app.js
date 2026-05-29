/* ============================================
   Maply — app.js
   Shared logic, auth and API helpers
   ============================================ */

// ─── HELPERS ─────────────────────────────────
const $ = (sel, ctx=document) => ctx.querySelector(sel);
const $$ = (sel, ctx=document) => [...ctx.querySelectorAll(sel)];

function formatDate(str) {
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
}

// ─── TOAST ───────────────────────────────────
let toastContainer;
function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}
function showToast(msg, type='info', duration=3000) {
  const icons = {
    info: '<i class="fa-solid fa-bolt"></i>',
    success: '<i class="fa-solid fa-check"></i>',
    error: '<i class="fa-solid fa-xmark"></i>'
  };
  const c = getToastContainer();
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon">${icons[type]||'<i class="fa-solid fa-circle-info"></i>'}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => {
    t.classList.add('toast-out');
    setTimeout(() => t.remove(), 300);
  }, duration);
}

// ─── NAV ACTIVE LINK ─────────────────────────
function setActiveNav() {
  const page = location.pathname.split('/').pop() || 'index.html';
  $$('.nav-links a, .nav-drawer a, .sidebar-item').forEach(a => {
    const href = a.getAttribute('href') || '';
    if (href && page.includes(href.replace('.html',''))) a.classList.add('active');
    else a.classList.remove('active');
  });
}

// ─── MOBILE NAV ──────────────────────────────
function initMobileNav() {
  const btn = $('#nav-mobile-btn');
  const drawer = $('#nav-drawer');
  if (!btn || !drawer) return;
  btn.addEventListener('click', () => {
    drawer.classList.toggle('open');
    btn.innerHTML = drawer.classList.contains('open')
      ? '<i class="fa-solid fa-xmark"></i>'
      : '<i class="fa-solid fa-bars"></i>';
  });
}

// ─── AUTH / API ──────────────────────────────
const Auth = {
  get token() { return localStorage.getItem('maply_token'); },
  set token(value) {
    if (value) localStorage.setItem('maply_token', value);
    else localStorage.removeItem('maply_token');
  },
  get user() { return JSON.parse(localStorage.getItem('maply_user') || 'null'); },
  set user(value) {
    if (value) localStorage.setItem('maply_user', JSON.stringify(value));
    else localStorage.removeItem('maply_user');
  },
  get loggedIn() { return !!this.token; },
  login(token, user) { this.token = token; this.user = user; },
  logout() { this.token = null; this.user = null; }
};

async function api(path, options = {}) {
  const url = path.startsWith('/api/') ? path : `/api/${path.replace(/^\//,'')}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (Auth.token) headers.Authorization = `Bearer ${Auth.token}`;
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) {
      Auth.logout();
      if (!location.pathname.endsWith('login.html')) location.href = 'login.html';
    }
    throw new Error((data && data.error) || `Erro ${res.status}`);
  }
  return data;
}

function requireAuth() {
  if (!Auth.loggedIn) {
    location.href = 'login.html';
    return false;
  }
  return true;
}

function renderUserNav() {
  const u = Auth.user;
  const el = $('#nav-user');
  if (!el || !u) return;
  const initials = u.nome.split(' ').map(w => w[0]).slice(0,2).join('').toUpperCase();
  el.innerHTML = `
    <div class="avatar" title="${u.nome}">${initials}</div>
    <span style="font-size:.85rem;color:var(--text-2)">${u.nome.split(' ')[0]}</span>
    <button class="btn btn-secondary btn-sm" onclick="logout()">Sair</button>
  `;
}

function logout() {
  Auth.logout();
  location.href = 'index.html';
}

// ─── STATUS BADGE ────────────────────────────
function badgeHtml(status) {
  const map = {
    'aberto':    ['badge-aberto',    '<i class="fa-solid fa-circle"></i> Aberto'],
    'analise':   ['badge-analise',   '<i class="fa-solid fa-clock"></i> Em análise'],
    'resolvido': ['badge-resolvido', '<i class="fa-solid fa-check-circle"></i> Resolvido'],
  };
  const [cls, label] = map[status] || ['badge-info', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function tipoBadge(tipo) {
  const iconMap = {
    'Buraco na via':'fa-solid fa-road-circle-exclamation',
    'Semáforo quebrado':'fa-solid fa-traffic-light',
    'Sinalização ausente':'fa-solid fa-exclamation-triangle',
    'Alagamento':'fa-solid fa-water',
    'Obra sem sinalização':'fa-solid fa-hard-hat',
    'Lixo na pista':'fa-solid fa-trash',
  };
  const iconClass = iconMap[tipo] || 'fa-solid fa-map-pin';
  return `<span style="display:inline-flex;align-items:center;gap:4px;font-size:.82rem;color:var(--text-2)"><i class="${iconClass}"></i> ${tipo}</span>`;
}

// ─── MODAL HELPERS ───────────────────────────
function openModal(id) { $(`#${id}`)?.classList.add('open'); }
function closeModal(id) { $(`#${id}`)?.classList.remove('open'); }

// ─── CONFIRM DELETE ──────────────────────────
function confirmDelete(id, cb) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay open';
  modal.id = 'confirm-delete-modal';
  modal.innerHTML = `
    <div class="modal" style="max-width:400px">
      <div class="modal-header">
        <span class="modal-title" style="color:var(--red)">Excluir Ocorrência</span>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="modal-body">
        <p style="color:var(--text-2);font-size:.9rem">
          Tem certeza que deseja excluir a ocorrência <strong style="color:var(--text)">${id}</strong>?
          Esta ação não pode ser desfeita.
        </p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
        <button class="btn btn-danger" id="confirm-del-btn">Excluir</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#confirm-del-btn').addEventListener('click', () => { cb(); modal.remove(); });
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// ─── BOOTSTRAP ───────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setActiveNav();
  initMobileNav();
  renderUserNav();
});
