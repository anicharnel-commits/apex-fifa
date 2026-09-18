# Gold / Forex Alert Bot — contrôle MT5 100% manuel

Système de **veille et d'alerte** pour XAU/USD et les principaux facteurs de volatilité.
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

## Installation

Python 3.11+ recommandé.

```bash
python -m venv .venv
# Windows
.venv\\Scripts\\activate
# Linux/macOS
source .venv/bin/activate

pip install -r requirements.txt
python forex_gold_alert_bot.py
```

Configurer les variables d'environnement avec vos propres clés. **Ne mettez jamais
les vraies clés dans le code ou dans GitHub.**

Variables :

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `GEMINI_API_KEY`
- `FMP_API_KEY`

## Fonctionnement

Le programme effectue un cycle environ toutes les 15 minutes. Il vérifie le calendrier,
programme les alertes T-30 et analyse les actualités prioritaires.

Le fichier `alert_state.json` évite les doublons.

## Important

Une alerte est une information de surveillance, pas une garantie de mouvement du marché.
Les sources peuvent être indisponibles ou retardées. Avant d'utiliser ce système avec de
l'argent réel, testez-le avec des événements historiques et simulés.
