// ================================================================
//  ADMIN - FIFA PREDICTIONS
// ================================================================

const API_BASE = '/api';
let isAdmin = false;

const adminLogin = document.getElementById('adminLogin');
const adminPanel = document.getElementById('adminPanel');
const adminLoginForm = document.getElementById('adminLoginForm');
const adminSecretInput = document.getElementById('adminSecretInput');
const adminLoginMessage = document.getElementById('adminLoginMessage');
const generateCodeForm = document.getElementById('generateCodeForm');
const planSelect = document.getElementById('planSelect');
const durationDays = document.getElementById('durationDays');
const generatedCodeDisplay = document.getElementById('generatedCodeDisplay');
const newCode = document.getElementById('newCode');
const newCodePlan = document.getElementById('newCodePlan');
const copyCodeBtn = document.getElementById('copyCodeBtn');
const codesContainer = document.getElementById('codesContainer');
const usersContainer = document.getElementById('usersContainer');
const syncBtn = document.getElementById('syncBtn');
const syncMessage = document.getElementById('syncMessage');
const logoutBtn = document.getElementById('logoutBtn');

function showToast(msg, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.cssText = `
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        background: rgba(10,10,10,0.95); backdrop-filter: blur(12px);
        padding: 12px 24px; border-radius: 12px;
        border: 1px solid ${type === 'error' ? '#ef4444' : '#FFD700'};
        color: #fff; z-index: 999; font-weight: 500; max-width: 90%; text-align: center;
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

adminLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const secretKey = adminSecretInput.value.trim();
    if (!secretKey) {
        adminLoginMessage.textContent = '⚠️ Entrez la clé secrète.';
        adminLoginMessage.className = 'message error';
        return;
    }
    localStorage.setItem('admin_secret_key', secretKey);
    try {
        const response = await fetch(`${API_BASE}/admin/generate-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secretKey, durationDays: 1, plan: 'STARTER_5000' })
        });
        if (response.ok) {
            isAdmin = true;
            adminLogin.style.display = 'none';
            adminPanel.style.display = 'block';
            adminLoginMessage.textContent = '✅ Connexion réussie !';
            adminLoginMessage.className = 'message success';
            loadCodes();
            loadUsers();
        } else {
            const error = await response.json();
            adminLoginMessage.textContent = '❌ ' + (error.error || 'Clé invalide');
            adminLoginMessage.className = 'message error';
            localStorage.removeItem('admin_secret_key');
        }
    } catch (err) {
        adminLoginMessage.textContent = '❌ Erreur: ' + err.message;
        adminLoginMessage.className = 'message error';
    }
});

generateCodeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const secretKey = localStorage.getItem('admin_secret_key');
    const plan = planSelect.value;
    const duration = parseInt(durationDays.value) || 7;
    try {
        const response = await fetch(`${API_BASE}/admin/generate-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secretKey, durationDays: duration, plan })
        });
        const data = await response.json();
        if (!response.ok) {
            showToast('❌ ' + (data.error || 'Erreur'), 'error');
            return;
        }
        newCode.textContent = data.code;
        newCodePlan.textContent = plan === 'STARTER_5000' ? 'Starter (7 matchs/jour)' : 'Premium (15 matchs/jour)';
        generatedCodeDisplay.style.display = 'block';
        showToast('✅ Code généré !', 'success');
        loadCodes();
    } catch (err) {
        showToast('❌ Erreur: ' + err.message, 'error');
    }
});

copyCodeBtn.addEventListener('click', () => {
    const code = newCode.textContent;
    navigator.clipboard?.writeText(code) || alert('Code: ' + code);
    showToast('✅ Copié !', 'success');
});

async function loadCodes() {
    codesContainer.innerHTML = '<div class="loading">⏳ Chargement...</div>';
    try {
        const response = await fetch('/api/admin/codes', {
            headers: { 'x-admin-key': localStorage.getItem('admin_secret_key') }
        });
        if (!response.ok) {
            codesContainer.innerHTML = '<div class="loading" style="color:#ef4444;">❌ Erreur</div>';
            return;
        }
        const data = await response.json();
        if (!data.codes || data.codes.length === 0) {
            codesContainer.innerHTML = '<div class="loading">📭 Aucun code généré.</div>';
            return;
        }
        let html = `<div class="table-wrap"><table><thead><tr><th>Code</th><th>Plan</th><th>Durée</th><th>Statut</th><th>Utilisé par</th></tr></thead><tbody>`;
        data.codes.forEach(c => {
            const planLabel = c.plan === 'STARTER_5000' ? 'Starter' : 'Premium';
            const status = c.is_used ? '✅ Utilisé' : '🟢 Actif';
            html += `<tr><td style="font-family:monospace; color:#f59e0b;">${c.code}</td><td>${planLabel}</td><td>${c.duration_days} j</td><td>${status}</td><td>${c.used_by_user || '—'}</td></tr>`;
        });
        html += `</tbody></table></div>`;
        codesContainer.innerHTML = html;
    } catch (err) {
        codesContainer.innerHTML = `<div class="loading" style="color:#ef4444;">❌ ${err.message}</div>`;
    }
}

async function loadUsers() {
    usersContainer.innerHTML = '<div class="loading">⏳ Chargement...</div>';
    try {
        const response = await fetch('/api/admin/users', {
            headers: { 'x-admin-key': localStorage.getItem('admin_secret_key') }
        });
        if (!response.ok) {
            usersContainer.innerHTML = '<div class="loading" style="color:#ef4444;">❌ Erreur</div>';
            return;
        }
        const data = await response.json();
        if (!data.users || data.users.length === 0) {
            usersContainer.innerHTML = '<div class="loading">👤 Aucun utilisateur.</div>';
            return;
        }
        let html = `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Plan</th><th>Statut</th><th>Valide jusqu\'à</th><th>Jours restants</th></tr></thead><tbody>`;
        data.users.forEach(u => {
            const now = new Date();
            const validUntil = new Date(u.valid_until);
            const daysLeft = Math.ceil((validUntil - now) / (1000 * 60 * 60 * 24));
            const isActive = u.subscription_status === 'active' && validUntil > now;
            const planLabel = u.plan === 'STARTER_5000' ? 'Starter' : (u.plan === 'PREMIUM_7000' ? 'Premium' : 'Essai');
            html += `<tr><td style="font-size:0.7rem;">${u.id}</td><td>${planLabel}</td><td style="color:${isActive ? '#10b981' : '#ef4444'};">${isActive ? '✅ Actif' : '🔒 Expiré'}</td><td>${validUntil.toLocaleDateString('fr-FR')}</td><td>${isActive ? daysLeft + ' j' : '—'}</td></tr>`;
        });
        html += `</tbody></table></div>`;
        usersContainer.innerHTML = html;
    } catch (err) {
        usersContainer.innerHTML = `<div class="loading" style="color:#ef4444;">❌ ${err.message}</div>`;
    }
}

syncBtn.addEventListener('click', async () => {
    syncMessage.textContent = '⏳ Synchronisation...';
    syncMessage.className = 'message';
    syncBtn.disabled = true;
    try {
        const response = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secretKey: localStorage.getItem('admin_secret_key') })
        });
        const data = await response.json();
        if (!response.ok) {
            syncMessage.textContent = '❌ ' + (data.error || 'Erreur');
            syncMessage.className = 'message error';
        } else {
            syncMessage.textContent = '✅ Synchronisation déclenchée !';
            syncMessage.className = 'message success';
            setTimeout(() => { loadCodes(); loadUsers(); }, 2000);
        }
    } catch (err) {
        syncMessage.textContent = '❌ Erreur: ' + err.message;
        syncMessage.className = 'message error';
    }
    syncBtn.disabled = false;
});

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('admin_secret_key');
    isAdmin = false;
    adminLogin.style.display = 'block';
    adminPanel.style.display = 'none';
    adminSecretInput.value = '';
});

const savedKey = localStorage.getItem('admin_secret_key');
if (savedKey) {
    adminSecretInput.value = savedKey;
    adminLoginForm.dispatchEvent(new Event('submit'));
}