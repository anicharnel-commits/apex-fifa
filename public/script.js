// ================================================================
//  CLIENT - FIFA PREDICTIONS
// ================================================================

const API_BASE = '/api';
let currentUserId = null;

const loginScreen = document.getElementById('loginScreen');
const dashboardScreen = document.getElementById('dashboardScreen');
const loginForm = document.getElementById('loginForm');
const userIdInput = document.getElementById('userIdInput');
const codeInput = document.getElementById('codeInput');
const loginMessage = document.getElementById('loginMessage');
const userStatus = document.getElementById('userStatus');
const statusBadge = document.getElementById('statusBadge');
const planBadge = document.getElementById('planBadge');
const daysRemaining = document.getElementById('daysRemaining');
const quotaInfo = document.getElementById('quotaInfo');
const matchCount = document.getElementById('matchCount');
const predictionsContainer = document.getElementById('predictionsContainer');
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

function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

async function login(userId, code) {
    try {
        const response = await fetch(`${API_BASE}/auth/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, code })
        });
        const data = await response.json();
        if (!response.ok) {
            loginMessage.textContent = '❌ ' + (data.error || 'Erreur');
            loginMessage.className = 'message error';
            return false;
        }
        currentUserId = userId;
        loginMessage.textContent = '✅ Connexion réussie !';
        loginMessage.className = 'message success';
        localStorage.setItem('fifa_user_id', userId);
        await loadDashboard();
        return true;
    } catch (err) {
        loginMessage.textContent = '❌ Erreur: ' + err.message;
        loginMessage.className = 'message error';
        return false;
    }
}

async function checkStatus(userId) {
    try {
        const response = await fetch(`${API_BASE}/auth/check-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId })
        });
        return await response.json();
    } catch { return { isActive: false }; }
}

function logout() {
    currentUserId = null;
    localStorage.removeItem('fifa_user_id');
    showScreen('loginScreen');
}

async function loadDashboard() {
    showScreen('dashboardScreen');
    userStatus.textContent = `👤 ${currentUserId}`;
    const status = await checkStatus(currentUserId);
    if (status.isActive) {
        statusBadge.textContent = `✅ Actif`;
        statusBadge.className = 'status-badge active';
        planBadge.textContent = status.label || status.plan || 'Abonnement';
        daysRemaining.textContent = `${status.daysRemaining || 0} jours`;
        quotaInfo.textContent = `${status.dailyQuota || 0} matchs aujourd'hui`;
    } else {
        statusBadge.textContent = '🔒 Abonnement expiré';
        statusBadge.className = 'status-badge expired';
        planBadge.textContent = 'Expiré';
        daysRemaining.textContent = '0 jours';
        quotaInfo.textContent = '0 matchs aujourd\'hui';
    }
    await loadPredictions();
}

async function loadPredictions() {
    predictionsContainer.innerHTML = '<div class="loading">⏳ Chargement des pronostics...</div>';
    try {
        const response = await fetch(`${API_BASE}/predictions?userId=${currentUserId}`, {
            headers: { 'x-user-id': currentUserId }
        });
        if (!response.ok) {
            const error = await response.json();
            predictionsContainer.innerHTML = `<div class="loading" style="color:#ef4444;">❌ ${error.error || 'Erreur'}</div>`;
            return;
        }
        const data = await response.json();
        if (!data.predictions || data.predictions.length === 0) {
            predictionsContainer.innerHTML = '<div class="loading">📭 Aucun match FIFA programmé aujourd\'hui.</div>';
            matchCount.textContent = '0 matchs';
            return;
        }
        matchCount.textContent = `${data.predictions.length} matchs`;
        let html = '';
        data.predictions.forEach(p => {
            const date = new Date(p.scheduled_at);
            const dateStr = date.toLocaleDateString('fr-FR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
            const confClass = p.confidence >= 75 ? '' : (p.confidence >= 60 ? 'medium' : 'low');
            
            html += `
                <div class="prediction-card">
                    <div class="match-teams">
                        ${p.player1_name} <span class="vs">VS</span> ${p.player2_name}
                        <span class="match-time">${dateStr}</span>
                    </div>
                    <div class="bet-box">
                        <div class="bet-type">🏆 Pronostic recommandé</div>
                        <div class="bet-value">${p.best_bet_value}</div>
                        <div style="display:flex; gap:8px; margin-top:6px; flex-wrap:wrap;">
                            <span class="bet-confidence ${confClass}">🔥 ${p.confidence}%</span>
                            <span style="font-size:0.7rem; color:#94a3b8;">Cote estimée : ${p.estimated_odds}</span>
                        </div>
                    </div>
                </div>
            `;
        });
        predictionsContainer.innerHTML = html;
    } catch (err) {
        predictionsContainer.innerHTML = `<div class="loading" style="color:#ef4444;">❌ ${err.message}</div>`;
    }
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userId = userIdInput.value.trim();
    const code = codeInput.value.trim();
    if (!userId || !code) {
        loginMessage.textContent = '⚠️ Veuillez remplir tous les champs.';
        loginMessage.className = 'message error';
        return;
    }
    await login(userId, code);
});

logoutBtn.addEventListener('click', logout);

const savedUserId = localStorage.getItem('fifa_user_id');
if (savedUserId) {
    userIdInput.value = savedUserId;
    checkStatus(savedUserId).then(status => {
        if (status.isActive) {
            currentUserId = savedUserId;
            loadDashboard();
        } else {
            showScreen('loginScreen');
        }
    });
} else {
    showScreen('loginScreen');
}