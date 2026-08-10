require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;
const PANDASCORE_TOKEN = process.env.PANDASCORE_TOKEN;
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY;

const db = new Database(path.join(__dirname, 'database.sqlite'));
db.pragma('journal_mode = WAL');

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ================================================================
//  FONCTIONS UTILITAIRES
// ================================================================

function generateSubscriptionCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'FIFA-VIP-';
    for (let i = 0; i < 12; i++) {
        if (i > 0 && i % 4 === 0) code += '-';
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

function calculateElo(rating1, rating2, score1, score2) {
    const kFactor = 32;
    const expected1 = 1 / (1 + Math.pow(10, (rating2 - rating1) / 400));
    const expected2 = 1 / (1 + Math.pow(10, (rating1 - rating2) / 400));
    const result1 = score1 > score2 ? 1 : (score1 === score2 ? 0.5 : 0);
    const result2 = score2 > score1 ? 1 : (score1 === score2 ? 0.5 : 0);
    return {
        newRating1: Math.round(rating1 + kFactor * (result1 - expected1)),
        newRating2: Math.round(rating2 + kFactor * (result2 - expected2))
    };
}

function poissonProbability(lambda, k) {
    if (lambda <= 0) return 0;
    return (Math.pow(lambda, k) * Math.pow(Math.E, -lambda)) / factorial(k);
}

function factorial(n) {
    if (n === 0 || n === 1) return 1;
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
}

// ================================================================
//  GET USER PLAN INFO (QUOTAS)
// ================================================================

function getUserPlanInfo(userData) {
    // SUPER-ADMIN
    if (userData && (userData.email === "koffimono5@gmail.com" || userData.id === "koffimono5@gmail.com")) {
        return {
            plan: "SUPER_ADMIN",
            dailyQuota: 999,
            weeklyQuota: 999,
            label: "👑 Super Admin (Accès total)",
            badge: "admin",
            isAdmin: true
        };
    }

    // Abonnement Starter (7 matchs/jour - 7 jours)
    if (userData.plan === "STARTER_5000" && userData.subscriptionEnd) {
        const endDate = userData.subscriptionEnd.toDate ? userData.subscriptionEnd.toDate() : new Date(userData.subscriptionEnd);
        if (endDate > new Date()) {
            return {
                plan: "STARTER",
                dailyQuota: 7,
                weeklyQuota: 49,
                label: "👑 Starter 5 000 FCFA (7 matchs/jour)",
                badge: "starter",
                duration: "7 jours"
            };
        }
    }

    // Abonnement Premium (15 matchs/jour - 7 jours)
    if (userData.plan === "PREMIUM_7000" && userData.subscriptionEnd) {
        const endDate = userData.subscriptionEnd.toDate ? userData.subscriptionEnd.toDate() : new Date(userData.subscriptionEnd);
        if (endDate > new Date()) {
            return {
                plan: "PREMIUM",
                dailyQuota: 15,
                weeklyQuota: 105,
                label: "💎 Premium 7 000 FCFA (15 matchs/jour)",
                badge: "premium",
                duration: "7 jours"
            };
        }
    }

    // Essai gratuit (2 matchs/jour - 7 jours)
    const regDate = userData.createdAt ? (userData.createdAt.toDate ? userData.createdAt.toDate() : new Date(userData.createdAt)) : new Date();
    const diffDays = Math.ceil((new Date() - regDate) / (1000 * 60 * 60 * 24));

    if (diffDays <= 7 && !userData.plan) {
        return {
            plan: "TRIAL",
            dailyQuota: 2,
            weeklyQuota: 14,
            label: "⭐ Essai Gratuit (2 matchs/jour)",
            badge: "trial",
            duration: "7 jours"
        };
    }

    return {
        plan: "EXPIRED",
        dailyQuota: 0,
        weeklyQuota: 0,
        label: "🔒 Abonnement Expiré",
        badge: "expired"
    };
}

// ================================================================
//  DÉTERMINER LE MEILLEUR PARI
// ================================================================

function determineBestBet(homeGoalsAvg, awayGoalsAvg, predictedWinner, p1WinProb, p2WinProb, homeName, awayName) {
    const totalGoals = homeGoalsAvg + awayGoalsAvg;

    const scoreProbs = [];
    for (let i = 0; i <= 5; i++) {
        for (let j = 0; j <= 5; j++) {
            const prob = poissonProbability(homeGoalsAvg, i) * poissonProbability(awayGoalsAvg, j);
            scoreProbs.push({ home: i, away: j, prob });
        }
    }
    scoreProbs.sort((a, b) => b.prob - a.prob);
    const mostLikely = scoreProbs[0];

    let bestBetType = '';
    let bestBetValue = '';
    let confidence = 0;

    if (p1WinProb >= 70) {
        bestBetType = 'VICTOIRE';
        bestBetValue = `🏆 Victoire de ${predictedWinner}`;
        confidence = Math.round(p1WinProb);
    } else if (p2WinProb >= 70) {
        bestBetType = 'VICTOIRE';
        bestBetValue = `🏆 Victoire de ${predictedWinner}`;
        confidence = Math.round(p2WinProb);
    } else if (totalGoals >= 3.5) {
        bestBetType = 'OVER';
        bestBetValue = `📈 Plus de 3.5 buts (${totalGoals.toFixed(1)} attendus)`;
        confidence = Math.round(Math.min(70 + (totalGoals - 3.5) * 10, 90));
    } else if (totalGoals <= 2.0) {
        bestBetType = 'UNDER';
        bestBetValue = `📉 Moins de 2.5 buts (${totalGoals.toFixed(1)} attendus)`;
        confidence = Math.round(Math.min(70 + (2.0 - totalGoals) * 10, 90));
    } else if (mostLikely.prob > 0.15) {
        bestBetType = 'SCORE_EXACT';
        bestBetValue = `⚽ Score exact : ${mostLikely.home}-${mostLikely.away}`;
        confidence = Math.round(mostLikely.prob * 100);
    } else {
        bestBetType = 'DOUBLE_CHANCE';
        bestBetValue = `🔄 Double chance : ${homeName} ou Nul (1X)`;
        confidence = Math.round(60 + (p1WinProb / 10));
    }

    confidence = Math.min(confidence, 95);
    const estimatedOdds = Math.round((100 / confidence) * 10) / 10;

    return {
        bestBetType,
        bestBetValue,
        confidence,
        estimatedOdds,
        mostLikelyScore: `${mostLikely.home}-${mostLikely.away}`,
        totalGoals: totalGoals
    };
}

// ================================================================
//  SYNCHRONISATION PANDASCORE
// ================================================================

async function syncPandaScore() {
    console.log('🔄 Synchronisation PandaScore...');

    try {
        const pastRes = await fetch(
            `https://api.pandascore.co/fifa/matches/past?token=${PANDASCORE_TOKEN}&per_page=50`
        );
        const pastMatches = await pastRes.json();

        const insertPlayer = db.prepare(`INSERT OR IGNORE INTO players (id, name) VALUES (?, ?)`);
        const updatePlayerStats = db.prepare(`
            UPDATE players 
            SET total_matches = total_matches + 1,
                wins = wins + ?,
                losses = losses + ?,
                goals_scored = goals_scored + ?,
                goals_conceded = goals_conceded + ?,
                elo_rating = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        const insertMatch = db.prepare(`
            INSERT OR REPLACE INTO matches_history 
            (match_id, player1_id, player2_id, winner_id, score_player1, score_player2, match_date)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (const match of pastMatches) {
            if (!match.players || match.players.length < 2) continue;
            const p1 = match.players[0];
            const p2 = match.players[1];
            const p1Score = match.results?.[0]?.score || 0;
            const p2Score = match.results?.[1]?.score || 0;

            insertPlayer.run(p1.id, p1.name);
            insertPlayer.run(p2.id, p2.name);

            const getElo = db.prepare('SELECT elo_rating FROM players WHERE id = ?');
            const elo1 = getElo.get(p1.id)?.elo_rating || 1500;
            const elo2 = getElo.get(p2.id)?.elo_rating || 1500;

            const { newRating1, newRating2 } = calculateElo(elo1, elo2, p1Score, p2Score);
            let winnerId = null;
            if (p1Score > p2Score) winnerId = p1.id;
            else if (p2Score > p1Score) winnerId = p2.id;

            updatePlayerStats.run(
                p1Score > p2Score ? 1 : 0,
                p1Score < p2Score ? 1 : 0,
                p1Score, p2Score, newRating1, p1.id
            );
            updatePlayerStats.run(
                p2Score > p1Score ? 1 : 0,
                p2Score < p1Score ? 1 : 0,
                p2Score, p1Score, newRating2, p2.id
            );

            insertMatch.run(
                match.id, p1.id, p2.id, winnerId, p1Score, p2Score,
                match.begin_at || new Date().toISOString()
            );
        }

        const upcomingRes = await fetch(
            `https://api.pandascore.co/fifa/matches/upcoming?token=${PANDASCORE_TOKEN}&per_page=50`
        );
        const upcomingMatches = await upcomingRes.json();

        const insertPrediction = db.prepare(`
            INSERT OR REPLACE INTO predictions 
            (match_id, player1_name, player2_name, predicted_winner, win_probability_p1, win_probability_p2, 
             total_goals_estimate, most_likely_score, best_bet_type, best_bet_value, confidence, estimated_odds, scheduled_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const getPlayerStats = db.prepare(`
            SELECT goals_scored, goals_conceded, total_matches FROM players WHERE name = ?
        `);

        for (const match of upcomingMatches) {
            if (!match.players || match.players.length < 2) continue;
            const p1 = match.players[0];
            const p2 = match.players[1];

            const stats1 = getPlayerStats.get(p1.name);
            const stats2 = getPlayerStats.get(p2.name);

            const avgGoals1 = stats1 ? stats1.goals_scored / Math.max(stats1.total_matches, 1) : 1.5;
            const avgGoals2 = stats2 ? stats2.goals_scored / Math.max(stats2.total_matches, 1) : 1.5;
            const avgConceded1 = stats1 ? stats1.goals_conceded / Math.max(stats1.total_matches, 1) : 1.5;
            const avgConceded2 = stats2 ? stats2.goals_conceded / Math.max(stats2.total_matches, 1) : 1.5;

            const homeGoals = (avgGoals1 + avgConceded2) / 2;
            const awayGoals = (avgGoals2 + avgConceded1) / 2;

            let p1WinProb = 0, p2WinProb = 0;
            for (let i = 1; i <= 5; i++) {
                for (let j = 0; j < i; j++) {
                    p1WinProb += poissonProbability(homeGoals, i) * poissonProbability(awayGoals, j);
                }
            }
            for (let i = 0; i < 5; i++) {
                for (let j = i + 1; j <= 5; j++) {
                    p2WinProb += poissonProbability(homeGoals, i) * poissonProbability(awayGoals, j);
                }
            }
            const totalProb = p1WinProb + p2WinProb;
            if (totalProb > 0) {
                p1WinProb = (p1WinProb / totalProb) * 100;
                p2WinProb = (p2WinProb / totalProb) * 100;
            }

            const predictedWinner = p1WinProb >= p2WinProb ? p1.name : p2.name;
            const bestBet = determineBestBet(homeGoals, awayGoals, predictedWinner, p1WinProb, p2WinProb, p1.name, p2.name);

            insertPrediction.run(
                match.id,
                p1.name,
                p2.name,
                predictedWinner,
                Math.round(p1WinProb * 10) / 10,
                Math.round(p2WinProb * 10) / 10,
                Math.round((homeGoals + awayGoals) * 10) / 10,
                bestBet.mostLikelyScore,
                bestBet.bestBetType,
                bestBet.bestBetValue,
                bestBet.confidence,
                bestBet.estimatedOdds,
                match.begin_at || new Date().toISOString()
            );
        }

        console.log('✅ Synchronisation terminée !');
    } catch (error) {
        console.error('❌ Erreur synchronisation:', error);
    }
}

// ================================================================
//  CRON JOB (toutes les 3 heures)
// ================================================================
cron.schedule('0 */3 * * *', syncPandaScore);

// ================================================================
//  ROUTES API
// ================================================================

app.post('/api/admin/generate-code', (req, res) => {
    const { secretKey, durationDays = 7, plan = 'STARTER_5000' } = req.body;
    if (secretKey !== ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Clé admin invalide' });
    }
    const code = generateSubscriptionCode();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);
    const stmt = db.prepare(`
        INSERT INTO subscription_codes (code, duration_days, plan, expires_at)
        VALUES (?, ?, ?, ?)
    `);
    stmt.run(code, durationDays, plan, expiresAt.toISOString());
    res.json({ success: true, code, durationDays, plan, expiresAt: expiresAt.toISOString() });
});

app.post('/api/auth/activate', (req, res) => {
    const { userId, code } = req.body;
    if (!userId || !code) {
        return res.status(400).json({ error: 'User ID et code requis' });
    }
    const getCode = db.prepare('SELECT * FROM subscription_codes WHERE code = ? AND is_used = 0');
    const codeData = getCode.get(code);
    if (!codeData) {
        return res.status(404).json({ error: 'Code invalide ou déjà utilisé' });
    }
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + codeData.duration_days);
    const updateCode = db.prepare(`
        UPDATE subscription_codes SET is_used = 1, used_by_user = ? WHERE code = ?
    `);
    updateCode.run(userId, code);
    const upsertUser = db.prepare(`
        INSERT INTO users (id, access_token, plan, valid_until)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET 
            access_token = excluded.access_token,
            plan = excluded.plan,
            valid_until = excluded.valid_until,
            subscription_status = 'active'
    `);
    upsertUser.run(userId, code, codeData.plan, expiresAt.toISOString());
    res.json({
        success: true,
        userId,
        plan: codeData.plan,
        validUntil: expiresAt.toISOString(),
        durationDays: codeData.duration_days
    });
});

app.post('/api/auth/check-status', (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ error: 'User ID requis' });
    }
    const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
    const user = getUser.get(userId);
    if (!user) {
        return res.json({ exists: false, isActive: false, message: 'Utilisateur non trouvé' });
    }
    const now = new Date();
    const validUntil = new Date(user.valid_until);
    const isActive = user.subscription_status === 'active' && validUntil > now;
    const userPlanInfo = getUserPlanInfo(user);
    res.json({
        exists: true,
        isActive,
        plan: user.plan || 'TRIAL',
        validUntil: user.valid_until,
        subscriptionStatus: user.subscription_status,
        daysRemaining: isActive ? Math.ceil((validUntil - now) / (1000 * 60 * 60 * 24)) : 0,
        dailyQuota: userPlanInfo.dailyQuota,
        label: userPlanInfo.label
    });
});

app.get('/api/predictions', (req, res) => {
    const userId = req.query.userId || req.headers['x-user-id'];
    if (!userId) {
        return res.status(401).json({ error: 'User ID requis' });
    }
    const getUser = db.prepare('SELECT * FROM users WHERE id = ?');
    const user = getUser.get(userId);
    if (!user) {
        return res.status(403).json({ error: 'Accès refusé. Abonnement requis.' });
    }
    const now = new Date();
    const validUntil = new Date(user.valid_until);
    const isActive = user.subscription_status === 'active' && validUntil > now;
    if (!isActive) {
        return res.status(403).json({ error: 'Abonnement expiré', validUntil: user.valid_until });
    }
    const userPlanInfo = getUserPlanInfo(user);
    const limit = userPlanInfo.dailyQuota || 2;
    const getPredictions = db.prepare(`
        SELECT * FROM predictions 
        WHERE scheduled_at > datetime('now')
        ORDER BY scheduled_at ASC
        LIMIT ?
    `);
    const predictions = getPredictions.all(limit);
    res.json({
        success: true,
        predictions,
        user: {
            id: user.id,
            plan: user.plan || 'TRIAL',
            validUntil: user.valid_until,
            daysRemaining: Math.ceil((validUntil - now) / (1000 * 60 * 60 * 24)),
            dailyQuota: limit,
            label: userPlanInfo.label
        }
    });
});

app.get('/api/leaderboard', (req, res) => {
    const getLeaderboard = db.prepare(`
        SELECT id, name, elo_rating, total_matches, wins, losses,
               ROUND(CAST(wins AS FLOAT) / total_matches * 100, 1) as win_rate
        FROM players 
        WHERE total_matches > 0
        ORDER BY elo_rating DESC
        LIMIT 20
    `);
    const leaderboard = getLeaderboard.all();
    res.json({ success: true, leaderboard });
});

app.post('/api/sync', (req, res) => {
    const { secretKey } = req.body;
    if (secretKey !== ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Clé admin invalide' });
    }
    syncPandaScore().then(() => {
        res.json({ success: true, message: 'Synchronisation déclenchée' });
    }).catch(err => {
        res.status(500).json({ error: err.message });
    });
});

app.get('/api/admin/codes', (req, res) => {
    const key = req.headers['x-admin-key'];
    if (key !== ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Non autorisé' });
    }
    const getCodes = db.prepare('SELECT * FROM subscription_codes ORDER BY created_at DESC');
    const codes = getCodes.all();
    res.json({ success: true, codes });
});

app.get('/api/admin/users', (req, res) => {
    const key = req.headers['x-admin-key'];
    if (key !== ADMIN_SECRET_KEY) {
        return res.status(401).json({ error: 'Non autorisé' });
    }
    const getUsers = db.prepare('SELECT * FROM users ORDER BY created_at DESC');
    const users = getUsers.all();
    res.json({ success: true, users });
});

app.use(express.static('public'));

app.listen(PORT, () => {
    console.log(`🚀 FIFA Predictions démarré sur http://localhost:${PORT}`);
    console.log(`🔑 Admin: http://localhost:${PORT}/admin.html`);
    console.log(`🔐 Clé admin: ${ADMIN_SECRET_KEY}`);
    console.log(`📊 Essai: 2 matchs/jour | Starter: 7 matchs/jour | Premium: 15 matchs/jour`);
    setTimeout(syncPandaScore, 3000);
});