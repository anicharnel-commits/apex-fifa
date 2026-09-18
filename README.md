# Gold / Forex Alert Bot — Render Free + contrôle MT5 100% manuel

Système de **veille et d’alerte** pour XAU/USD et les principaux facteurs de volatilité.
Il surveille les annonces économiques USD et les actualités financières/géopolitiques,
puis envoie des alertes Telegram.

## Règle fondamentale

**Le système ne contrôle jamais MT5.**

- Aucun ordre envoyé.
- Aucune position fermée.
- Aucun robot MT5 arrêté ou démarré automatiquement.
- Aucune modification automatique de stop-loss/take-profit.
- L'utilisateur reçoit l'information et garde entièrement la décision.

## Surveillance économique

- Calendrier FMP.
- Filtre strict : **USD + High Impact uniquement**.
- EUR exclu volontairement.
- Alerte programmée à **T-30 minutes** lorsque l'événement est connu suffisamment à l'avance.

## Surveillance des actualités

Les flux RSS sont filtrés sur les facteurs pouvant fortement affecter Gold/Forex :

- pétrole / Brent / WTI ;
- dollar / USD ;
- Federal Reserve et banques centrales ;
- inflation / CPI / PPI ;
- guerres, attaques, sanctions et escalades militaires ;
- crises bancaires et financières.

Gemini analyse les candidats et Telegram reçoit uniquement les alertes répondant
aux seuils configurés.

## Render Free

Cette version est préparée comme **Web Service Render** :

- `requirements.txt` inclut Flask ;
- le serveur écoute automatiquement le port fourni par Render via `PORT` ;
- `/` affiche l'état du service ;
- `/health` sert de health check ;
- le monitoring tourne dans un thread séparé ;
- `render.yaml` contient la configuration de déploiement Free.

### Limite importante du plan Free

Render peut mettre un service Free en veille après une période sans trafic entrant.
Cette adaptation permet de **tester et héberger gratuitement** le bot, mais elle ne garantit
pas une surveillance continue 24h/24. Lorsqu'il redémarre, le bot refait immédiatement un cycle.

Pour les alertes T-30, une mise en veille au mauvais moment peut empêcher l'alerte exacte
d'être envoyée. Il faut donc considérer Render Free comme une solution de test/veille, pas
comme une garantie de disponibilité continue.

## Déploiement

1. Créer un **Web Service** sur Render.
2. Choisir le plan **Free**.
3. Build Command : `pip install -r requirements.txt`
4. Start Command : `python forex_gold_alert_bot.py`
5. Ajouter les variables d'environnement dans Render.
6. Health Check Path : `/health`

Variables obligatoires :

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `GEMINI_API_KEY`
- `FMP_API_KEY`

Variables optionnelles :

- `GEMINI_MODEL`
- `LOOP_SECONDS` (900 par défaut)
- `GEMINI_MIN_CONFIDENCE` (0.80 par défaut)
- `TIMEZONE_OFFSET_HOURS` (0 par défaut)
- `RSS_FEEDS`
- `REQUEST_TIMEOUT`
- `STATE_FILE`

**Ne mets jamais tes vraies clés API dans GitHub ou dans le code.**

## Test local

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/macOS
source .venv/bin/activate

pip install -r requirements.txt
python forex_gold_alert_bot.py
```

Puis ouvrir `/health` sur le port indiqué dans le terminal.

## Important

Une alerte est une information de surveillance, pas une garantie de mouvement du marché.
Les sources peuvent être indisponibles ou retardées. Avant d'utiliser ce système avec de
l'argent réel, testez-le avec des événements historiques et simulés.
