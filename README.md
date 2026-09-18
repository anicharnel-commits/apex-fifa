# Gold / Forex Alert Bot — Render Free — MT5 100% manuel

Version de remplacement de l'ancien bot.

## Ce qui a été supprimé

- FMP : supprimé complètement.
- anciens flux RSS FXStreet/Reuters : supprimés complètement.
- aucune variable `FMP_API_KEY` n'est utilisée.

## Sources actuelles

### 1. Calendrier économique

Finance Calendar API :
`https://www.financecalendar.com/wp-json/fc/v1/calendar`

- aucune clé API ;
- filtre `high` côté source ;
- filtre final strict USD ;
- alerte T-30 ;
- attribution vers financecalendar.com incluse dans les alertes Telegram.

Le système ne transforme pas automatiquement une annonce non-US en annonce USD :
les événements USD sont reconnus via les champs USD/US fournis par la source ou,
si ces champs sont absents, via un ensemble explicite de publications US majeures.

### 2. Actualités

Marketaux :
`https://api.marketaux.com/v1/news/all`

Le bot utilise le token `MARKETAUX_API_KEY`, recherche les actualités récentes
liées à Gold/XAU, USD/dollar, Fed, inflation, pétrole et risques géopolitiques,
puis laisse Gemini déterminer si une alerte de volatilité est justifiée.

Le plan gratuit Marketaux est limité à 100 requêtes/jour et 3 articles par
requête. Avec le réglage de 15 minutes, le bot fait au maximum 96 requêtes/jour
si le service reste actif.

### 3. Gemini

Gemini analyse uniquement les candidats Marketaux et renvoie un JSON strict.
Le seuil par défaut est 80% de confiance et la notification n'est envoyée que
pour les sévérités `high` ou `critical`.

### 4. Telegram

Telegram reçoit les alertes économiques et les alertes de volatilité.

## Contrôle MT5 — règle absolue

Le programme est uniquement un radar.

- Aucun ordre MT5.
- Aucune fermeture de position.
- Aucun démarrage/arrêt automatique de robot.
- Aucun changement automatique de SL/TP.
- L'utilisateur prend manuellement toute décision dans MT5.

## Render Free

- Type : Web Service
- Build Command : `pip install -r requirements.txt`
- Start Command : `python forex_gold_alert_bot.py`
- Health Check : `/health`
- Port : fourni automatiquement par Render via `PORT`

### Attention au plan Free

Le plan Free peut mettre le service en veille après une période sans trafic entrant.
Une veille peut empêcher une alerte T-30 d'être envoyée exactement à l'heure prévue.
Cette version ne prétend donc pas garantir une disponibilité 24/7 sur Render Free.

## Variables Render obligatoires

`TELEGRAM_BOT_TOKEN`

`TELEGRAM_CHAT_ID`

`GEMINI_API_KEY`

`MARKETAUX_API_KEY`

## Variables optionnelles

`GEMINI_MODEL=gemini-3.8-flash`

`LOOP_SECONDS=900`

`GEMINI_MIN_CONFIDENCE=0.80`

`TIMEZONE_OFFSET_HOURS=0`

`REQUEST_TIMEOUT=20`

`MARKETAUX_ARTICLE_LIMIT=3`

`MARKETAUX_LOOKBACK_MINUTES=20`

`CALENDAR_API_URL=https://www.financecalendar.com/wp-json/fc/v1/calendar`

`MARKETAUX_NEWS_URL=https://api.marketaux.com/v1/news/all`

## Important sécurité

Ne mets jamais les vraies clés dans le ZIP, GitHub ou le code.
Elles doivent rester dans les Environment Variables de Render.

Si une clé a été exposée dans des logs, captures ou messages, il faut la révoquer
et en créer une nouvelle avant l'utilisation réelle.
