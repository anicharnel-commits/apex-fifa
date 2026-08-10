const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'database.sqlite'));

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    elo_rating INTEGER DEFAULT 1500,
    total_matches INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    goals_scored INTEGER DEFAULT 0,
    goals_conceded INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS matches_history (
    match_id INTEGER PRIMARY KEY,
    player1_id INTEGER NOT NULL,
    player2_id INTEGER NOT NULL,
    winner_id INTEGER,
    score_player1 INTEGER,
    score_player2 INTEGER,
    match_date DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player1_id) REFERENCES players(id),
    FOREIGN KEY (player2_id) REFERENCES players(id),
    FOREIGN KEY (winner_id) REFERENCES players(id)
  );

  CREATE TABLE IF NOT EXISTS predictions (
    match_id INTEGER PRIMARY KEY,
    player1_name TEXT NOT NULL,
    player2_name TEXT NOT NULL,
    predicted_winner TEXT NOT NULL,
    win_probability_p1 REAL NOT NULL,
    win_probability_p2 REAL NOT NULL,
    total_goals_estimate REAL NOT NULL,
    most_likely_score TEXT NOT NULL,
    best_bet_type TEXT NOT NULL,
    best_bet_value TEXT NOT NULL,
    confidence INTEGER NOT NULL,
    estimated_odds REAL NOT NULL,
    scheduled_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS subscription_codes (
    code TEXT PRIMARY KEY,
    duration_days INTEGER NOT NULL,
    plan TEXT NOT NULL,
    is_used INTEGER DEFAULT 0,
    used_by_user TEXT,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    plan TEXT NOT NULL,
    subscription_status TEXT DEFAULT 'active',
    valid_until DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

console.log('✅ Base de données initialisée avec succès !');
db.close();