# Gold / Forex Alert Bot — Render Free — Manual MT5 only

Système de surveillance pour XAU/USD. Il **n'exécute aucune action dans MT5**.
Il envoie uniquement des alertes Telegram afin que l'utilisateur décide lui-même.

## Modules
- **Finance Calendar** : annonces **USD + High Impact uniquement**, avec alerte Telegram exacte **T-30**.
- **Marketaux** : recherche élargie des nouvelles liées à l'or, USD/dollar, Fed, inflation, pétrole et risques géopolitiques.
- **Gemini** : analyse de chaque titre retenu et alerte seulement si l'événement est évalué comme important et à forte confiance.
- **Telegram** : réception des alertes.
- **Render Free Web Service** : serveur Flask + boucle de surveillance en arrière-plan.
- `/health` : état simple.
- `/status` : état du dernier cycle et compteurs.

## Pourquoi la version Marketaux a été corrigée
La recherche précédente était trop restrictive : elle imposait `must_have_entities=true` et une fenêtre de seulement 20 minutes. Cette version :
- retire `must_have_entities` ;
- utilise une fenêtre de 60 minutes ;
- conserve une seule requête Marketaux par cycle ;
- utilise la syntaxe officielle `|` (OR) et `()` pour la recherche ;
- journalise `found` et `returned` de Marketaux pour faciliter le diagnostic.

## Variables Render
Obligatoires :
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `GEMINI_API_KEY`
- `MARKETAUX_API_KEY`

Ne pas mettre les clés dans GitHub ou dans le code.

## Render
- Root Directory : vide
- Build Command : `pip install -r requirements.txt`
- Start Command : `python forex_gold_alert_bot.py`
- Plan : Free Web Service

## Important
Le plan Free de Render peut mettre le service en veille. Ce projet n'utilise donc pas de promesse de fonctionnement 24/7.

Le système ne démarre/arrête jamais un robot MT5, n'ouvre aucune position et ne ferme aucune position.

Finance Calendar demande un lien vers financecalendar.com lorsque ses données sont affichées.
