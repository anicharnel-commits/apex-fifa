"""
Gold / Forex Alert Bot — MANUAL CONTROL ONLY

Data sources:
- Finance Calendar: economic calendar, no API key required
- Marketaux: financial/news feed (API token required)
- Gemini: news/risk analysis
- Telegram: alerts

Rules:
- Economic alerts: USD + HIGH IMPACT only
- News: Gold/USD/oil/geopolitical/central-bank drivers
- MT5 is NEVER controlled automatically
- No orders, no position closing, no robot start/stop
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests
from flask import Flask, jsonify
from dateutil import parser as date_parser
from google import genai
from google.genai import types


# =========================
# Configuration
# =========================

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
MARKETAUX_API_KEY = os.getenv("MARKETAUX_API_KEY", "")

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_FALLBACK_MODELS = [
    x.strip() for x in os.getenv(
        "GEMINI_FALLBACK_MODELS",
        "gemini-2.5-flash-lite,gemini-2.5-flash"
    ).split(",") if x.strip()
]
LOOP_SECONDS = int(os.getenv("LOOP_SECONDS", "900"))
CALENDAR_ALERT_MINUTES_BEFORE = 30
GEMINI_MIN_CONFIDENCE = float(os.getenv("GEMINI_MIN_CONFIDENCE", "0.80"))
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "20"))
STATE_FILE = Path(os.getenv("STATE_FILE", "alert_state.json"))
WEB_PORT = int(os.getenv("PORT", os.getenv("WEB_PORT", "10000")))
TIMEZONE_OFFSET_HOURS = int(os.getenv("TIMEZONE_OFFSET_HOURS", "0"))
LOCAL_TZ = timezone(timedelta(hours=TIMEZONE_OFFSET_HOURS))

CALENDAR_API_URL = os.getenv(
    "CALENDAR_API_URL",
    "https://www.financecalendar.com/wp-json/fc/v1/calendar",
)
MARKETAUX_NEWS_URL = os.getenv(
    "MARKETAUX_NEWS_URL",
    "https://api.marketaux.com/v1/news/all",
)

# Marketaux free plan currently allows 100 requests/day and 3 articles/news request.
# One request every 15 minutes = 96 requests/day, leaving a small margin.
MARKETAUX_ARTICLE_LIMIT = min(int(os.getenv("MARKETAUX_ARTICLE_LIMIT", "3")), 3)
MARKETAUX_LOOKBACK_MINUTES = int(os.getenv("MARKETAUX_LOOKBACK_MINUTES", "60"))
MARKETAUX_SEARCH = os.getenv(
    "MARKETAUX_SEARCH",
    '(gold|XAU|dollar|USD|"Federal Reserve"|Fed|"interest rate"|inflation|CPI|PCE|NFP|oil|Brent|WTI|war|attack|sanctions|ceasefire|geopolitical)',
)

# Terms that identify US/USD events when the calendar source does not expose a
# currency/country field. The source's high-impact filter is applied first.
US_EVENT_TERMS = [
    "united states",
    "u.s.",
    "us ",
    "fomc",
    "federal reserve",
    "fed decision",
    "fed rate",
    "nonfarm",
    "non-farm",
    "nfp",
    "adp employment",
    "us cpi",
    "cpi report",
    "consumer price index",
    "core cpi",
    "us ppi",
    "producer price index",
    "core pce",
    "pce price",
    "personal consumption expenditures",
    "us gdp",
    "gross domestic product",
    "us retail sales",
    "retail sales",
    "ism manufacturing",
    "ism services",
    "jolts",
    "jobless claims",
    "initial jobless claims",
    "continuing jobless claims",
    "industrial production",
    "capacity utilization",
    "housing starts",
    "building permits",
    "consumer confidence",
    "michigan sentiment",
    "durable goods",
    "trade balance",
    "personal income",
    "personal spending",
]

PRIORITY_KEYWORDS = [
    "gold", "xau", "dollar", "usd", "oil", "crude", "brent", "wti",
    "fed", "federal reserve", "central bank", "interest rate", "rates",
    "inflation", "cpi", "ppi", "pce", "nfp", "nonfarm", "jobs",
    "war", "invasion", "missile", "attack", "airstrike", "conflict",
    "military", "sanctions", "ceasefire", "geopolitical", "iran", "israel",
    "ukraine", "russia", "china", "taiwan", "banking crisis", "financial crisis",
    "default", "recession",
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("forex-gold-alert")


# =========================
# State / deduplication
# =========================

state_lock = threading.Lock()
scheduled_timers: dict[str, threading.Timer] = {}


def load_state() -> dict[str, Any]:
    if not STATE_FILE.exists():
        return {"sent_calendar": [], "sent_news": []}
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        return {
            "sent_calendar": list(data.get("sent_calendar", [])),
            "sent_news": list(data.get("sent_news", [])),
        }
    except Exception:
        logger.exception("Impossible de lire %s; état réinitialisé.", STATE_FILE)
        return {"sent_calendar": [], "sent_news": []}


def save_state(state: dict[str, Any]) -> None:
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(STATE_FILE)


STATE = load_state()

RUNTIME = {
    "started_at": None,
    "last_cycle_at": None,
    "last_cycle_seconds": None,
    "last_calendar_count": 0,
    "last_news_count": 0,
    "last_error": None,
}
RUNTIME_LOCK = threading.Lock()


def already_sent(kind: str, event_id: str) -> bool:
    with state_lock:
        return event_id in STATE.get(kind, [])


def mark_sent(kind: str, event_id: str) -> None:
    with state_lock:
        STATE.setdefault(kind, [])
        if event_id not in STATE[kind]:
            STATE[kind].append(event_id)
            STATE[kind] = STATE[kind][-2000:]
            save_state(STATE)


# =========================
# Generic helpers
# =========================


def safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        dt = date_parser.parse(str(value))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        logger.warning("Date impossible à parser: %r", value)
        return None


def event_key(prefix: str, *parts: Any) -> str:
    raw = "|".join(safe_text(x) for x in parts)
    return prefix + ":" + hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def normalize_impact(item: dict[str, Any]) -> str:
    raw = (
        item.get("impact")
        or item.get("importance")
        or item.get("priority")
        or item.get("impactLevel")
        or ""
    )
    text = safe_text(raw).lower()
    if text in {"3", "high", "high impact", "red", "3.0"} or "high" in text or "red" in text:
        return "high"
    return text


def extract_calendar_datetime(item: dict[str, Any]) -> datetime | None:
    for key in (
        "time_utc", "datetime_utc", "date_utc", "datetime", "date",
        "eventDate", "releaseDate", "time",
    ):
        dt = parse_datetime(item.get(key))
        if dt:
            return dt
    return None


# =========================
# Telegram
# =========================


def send_telegram(message: str) -> bool:
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        logger.error("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID manquant.")
        return False

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        response = requests.post(
            url,
            json={
                "chat_id": TELEGRAM_CHAT_ID,
                "text": message,
                "disable_web_page_preview": True,
            },
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        return True
    except requests.RequestException:
        logger.exception("Erreur Telegram.")
        return False


# =========================
# Economic calendar — Finance Calendar
# =========================


def fetch_economic_calendar() -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    start = now.date().isoformat()
    end = (now + timedelta(days=2)).date().isoformat()

    response = requests.get(
        CALENDAR_API_URL,
        params={
            "from": start,
            "to": end,
            "impact": "high",
            "limit": 500,
        },
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    data = response.json()

    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("events", "data", "results", "calendar"):
            if isinstance(data.get(key), list):
                return data[key]
    return []


def is_usd_event(item: dict[str, Any]) -> bool:
    """Strict USD filter, with fallbacks for calendar response variants."""
    currency = safe_text(
        item.get("currency")
        or item.get("countryCurrency")
        or item.get("currency_code")
    ).upper()
    if currency == "USD":
        return True
    if currency and currency not in {"US", "USA", "USD"}:
        return False

    country = safe_text(
        item.get("country")
        or item.get("country_code")
        or item.get("countryCode")
        or item.get("region")
    ).lower()
    if country in {"us", "usa", "united states", "united states of america"}:
        return True
    if country and country not in {"global", "world", "international"}:
        # Do not infer USD from a non-US country.
        return False

    title = safe_text(
        item.get("title")
        or item.get("name")
        or item.get("event")
        or item.get("description")
    ).lower()
    return any(term in title for term in US_EVENT_TERMS)


def filter_usd_high_impact(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        item for item in items
        if normalize_impact(item) == "high" and is_usd_event(item)
    ]


def schedule_exact_t30_alert(item: dict[str, Any]) -> None:
    event_dt = extract_calendar_datetime(item)
    if not event_dt:
        return

    now = datetime.now(timezone.utc)
    target = event_dt - timedelta(minutes=CALENDAR_ALERT_MINUTES_BEFORE)
    delay = (target - now).total_seconds()
    if delay < 0:
        return

    name = safe_text(
        item.get("title")
        or item.get("name")
        or item.get("event")
        or item.get("description")
        or "Annonce USD"
    )
    key = event_key("calendar", name, event_dt.isoformat(), "USD")

    if already_sent("sent_calendar", key):
        return

    with state_lock:
        if key in scheduled_timers:
            return

        def fire() -> None:
            try:
                if already_sent("sent_calendar", key):
                    return
                event_local = event_dt.astimezone(LOCAL_TZ)
                source_url = safe_text(item.get("url"))
                message = (
                    "⚠️ ALERTE ÉCONOMIQUE USD\n\n"
                    f"🇺🇸 {name}\n"
                    f"⏰ Heure : {event_local:%H:%M:%S}\n"
                    "🟥 Impact : HIGH\n"
                    "⏳ Dans 30 minutes\n\n"
                    "👤 ACTION MANUELLE : vérifie tes positions et décide toi-même si tu veux couper tes bots MT5.\n\n"
                    "📅 Source calendrier : https://www.financecalendar.com/api/"
                )
                if source_url:
                    message += f"\n🔗 Événement : {source_url}"
                if send_telegram(message):
                    mark_sent("sent_calendar", key)
            except Exception:
                logger.exception("Erreur lors de l'envoi de l'alerte T-30.")
            finally:
                with state_lock:
                    scheduled_timers.pop(key, None)

        timer = threading.Timer(delay, fire)
        timer.daemon = True
        scheduled_timers[key] = timer
        timer.start()

    logger.info(
        "Alerte T-30 programmée: %s à %s (dans %.1f min)",
        name,
        event_dt.isoformat(),
        delay / 60,
    )


def process_economic_calendar() -> None:
    try:
        items = fetch_economic_calendar()
        events = filter_usd_high_impact(items)
        logger.info(
            "Finance Calendar: %d événement(s) USD High Impact détecté(s).",
            len(events),
        )
        with RUNTIME_LOCK:
            RUNTIME["last_calendar_count"] = len(events)
        for item in events:
            schedule_exact_t30_alert(item)
    except Exception:
        logger.exception("Module calendrier économique indisponible.")


# =========================
# Marketaux news
# =========================


def keyword_score(title: str, summary: str = "") -> int:
    text = f"{title} {summary}".lower()
    return sum(1 for keyword in PRIORITY_KEYWORDS if keyword in text)


def fetch_marketaux_items() -> list[dict[str, str]]:
    if not MARKETAUX_API_KEY:
        raise RuntimeError("MARKETAUX_API_KEY manquant.")

    after = datetime.now(timezone.utc) - timedelta(minutes=MARKETAUX_LOOKBACK_MINUTES)
    params = {
        "api_token": MARKETAUX_API_KEY,
        "search": MARKETAUX_SEARCH,
        "language": "en",
        "published_after": after.strftime("%Y-%m-%dT%H:%M:%S"),
        "limit": MARKETAUX_ARTICLE_LIMIT,
        "group_similar": "true",
        "sort": "published_at",
    }
    try:
        response = requests.get(
            MARKETAUX_NEWS_URL,
            params=params,
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as exc:
        raise RuntimeError(f"Marketaux réseau: {exc}") from exc

    if not response.ok:
        # Never log the token. Marketaux error bodies are useful for diagnosing
        # bad parameters or an exhausted plan.
        try:
            detail = response.json()
        except Exception:
            detail = response.text[:500]
        raise RuntimeError(f"Marketaux HTTP {response.status_code}: {detail}")

    try:
        data = response.json()
    except ValueError as exc:
        raise RuntimeError("Marketaux a renvoyé une réponse JSON invalide.") from exc

    meta = data.get("meta", {}) if isinstance(data, dict) else {}
    raw_items = data.get("data", []) if isinstance(data, dict) else []
    logger.info(
        "Marketaux: found=%s returned=%s (fenêtre %d min).",
        meta.get("found", "?"),
        meta.get("returned", len(raw_items)),
        MARKETAUX_LOOKBACK_MINUTES,
    )
    items: list[dict[str, str]] = []
    for entry in raw_items:
        if not isinstance(entry, dict):
            continue
        title = safe_text(entry.get("title"))
        if not title:
            continue
        items.append({
            "id": safe_text(entry.get("uuid")),
            "title": title,
            "link": safe_text(entry.get("url")),
            "summary": safe_text(
                entry.get("description")
                or entry.get("snippet")
                or entry.get("keywords")
            ),
            "published": safe_text(entry.get("published_at")),
            "source": safe_text(entry.get("source")),
        })

    return sorted(
        items,
        key=lambda x: keyword_score(x["title"], x["summary"]),
        reverse=True,
    )


# =========================
# Gemini geopolitical analysis
# =========================


def build_gemini_client() -> genai.Client:
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY manquant.")
    return genai.Client(api_key=GEMINI_API_KEY)


def analyze_with_gemini(client: genai.Client, title: str, summary: str) -> dict[str, Any]:
    prompt = f"""
Analyze this financial/geopolitical news item for a Forex + Gold risk-monitoring bot.

TITLE:
{title}

SUMMARY:
{summary[:3000]}

Priority drivers:
1. Gold / XAU and USD / dollar
2. Oil / crude / Brent / WTI
3. Wars, attacks, invasions, military escalation, sanctions, ceasefires
4. Federal Reserve and other central banks
5. Inflation, CPI/PPI/PCE, interest rates and jobs data
6. Banking/financial crises and sovereign default risk

Does this indicate a sudden or major event that could create significant short-term
volatility in USD-related Forex pairs and/or Gold?

Be conservative. Routine commentary, ordinary market analysis, old/recycled stories,
and minor incidents are NOT enough.

Return ONLY valid JSON with exactly:
{{
  "alert": true or false,
  "confidence": number between 0 and 1,
  "severity": "low" | "medium" | "high" | "critical",
  "reason": "short explanation",
  "gold_forex_impact": "short explanation"
}}
"""

    models_to_try = []
    for model_name in [GEMINI_MODEL, *GEMINI_FALLBACK_MODELS]:
        if model_name and model_name not in models_to_try:
            models_to_try.append(model_name)

    last_error = None
    response = None
    for model_name in models_to_try:
        try:
            logger.info("Gemini: tentative avec %s", model_name)
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.1,
                    max_output_tokens=300,
                ),
            )
            logger.info("Gemini: réponse reçue avec %s", model_name)
            break
        except Exception as exc:
            last_error = exc
            message = str(exc)
            transient = any(code in message for code in ("503", "429", "500", "504"))
            if transient and model_name != models_to_try[-1]:
                logger.warning(
                    "Gemini indisponible avec %s (%s). Passage au modèle de secours.",
                    model_name,
                    message[:180],
                )
                continue
            raise

    if response is None:
        raise last_error or RuntimeError("Gemini n'a renvoyé aucune réponse.")

    text = safe_text(response.text)
    text = re.sub(r"^```json\s*", "", text, flags=re.I)
    text = re.sub(r"^```\s*", "", text)
    text = re.sub(r"\s*```$", "", text).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.S)
        if not match:
            raise ValueError(f"Gemini JSON invalide: {text[:500]}")
        return json.loads(match.group(0))


def process_news() -> None:
    try:
        client = build_gemini_client()
        items = fetch_marketaux_items()
        candidates = [
            item for item in items
            if keyword_score(item["title"], item["summary"]) > 0
        ]
        logger.info("Marketaux: %d titre(s) reçu(s) à analyser.", len(candidates))
        with RUNTIME_LOCK:
            RUNTIME["last_news_count"] = len(candidates)

        for item in candidates:
            key = event_key("news", item.get("id"), item["title"], item["link"])
            if already_sent("sent_news", key):
                continue

            try:
                result = analyze_with_gemini(client, item["title"], item["summary"])
                alert = bool(result.get("alert", False))
                confidence = float(result.get("confidence", 0))
                severity = safe_text(result.get("severity", "low")).lower()

                if alert and confidence >= GEMINI_MIN_CONFIDENCE and severity in {"high", "critical"}:
                    reason = safe_text(result.get("reason", "Risque détecté"))
                    impact = safe_text(result.get("gold_forex_impact", "Impact potentiel Gold/Forex."))
                    message = (
                        "🚨 ALERTE VOLATILITÉ — GOLD / FOREX\n\n"
                        f"📰 {item['title']}\n"
                        f"🗞 Source : {item['source'] or 'Marketaux'}\n"
                        f"🔥 Sévérité : {severity.upper()}\n"
                        f"🎯 Confiance IA : {confidence:.0%}\n\n"
                        f"⚠️ {reason}\n"
                        f"📈 Impact potentiel : {impact}\n\n"
                        "👤 ACTION MANUELLE : vérifie tes positions et décide toi-même de l’action à prendre sur MT5."
                    )
                    if item["link"]:
                        message += f"\n\n🔗 {item['link']}"
                    if send_telegram(message):
                        mark_sent("sent_news", key)
            except Exception:
                logger.exception("Gemini a échoué pour le titre: %s", item["title"])

    except Exception:
        logger.exception("Module Marketaux/Gemini indisponible.")


# =========================
# Render Free web service
# =========================

app = Flask(__name__)


@app.get("/")
def home() -> Any:
    return jsonify({
        "status": "ok",
        "service": "Gold / Forex Alert Bot",
        "mode": "manual_mt5_only",
        "calendar": "Finance Calendar — USD + High Impact",
        "news": "Marketaux + Gemini",
        "message": "Monitoring active. MT5 is never controlled automatically.",
    })


@app.get("/health")
def health() -> Any:
    return jsonify({
        "status": "healthy",
        "mode": "manual_mt5_only",
        "loop_seconds": LOOP_SECONDS,
        "calendar_source": "financecalendar.com",
        "news_source": "marketaux.com",
    })


@app.get("/status")
def status() -> Any:
    with RUNTIME_LOCK:
        runtime = dict(RUNTIME)
    return jsonify({
        "status": "ok",
        "mode": "manual_mt5_only",
        "runtime": runtime,
        "sources": {
            "calendar": "Finance Calendar — USD + High Impact",
            "news": "Marketaux + Gemini",
            "telegram": "configured" if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID else "missing",
        },
    })


# =========================
# Main loop
# =========================


def validate_configuration() -> None:
    missing = [
        name for name, value in {
            "TELEGRAM_BOT_TOKEN": TELEGRAM_BOT_TOKEN,
            "TELEGRAM_CHAT_ID": TELEGRAM_CHAT_ID,
            "GEMINI_API_KEY": GEMINI_API_KEY,
            "MARKETAUX_API_KEY": MARKETAUX_API_KEY,
        }.items() if not value
    ]
    if missing:
        raise RuntimeError("Variables d'environnement manquantes: " + ", ".join(missing))


def monitor_loop() -> None:
    started = datetime.now(timezone.utc).isoformat()
    with RUNTIME_LOCK:
        RUNTIME["started_at"] = started
    logger.info("Boucle de surveillance démarrée.")
    while True:
        cycle_started = time.time()
        try:
            process_economic_calendar()
        except Exception:
            logger.exception("Erreur calendrier pendant le cycle principal.")
        try:
            process_news()
        except Exception:
            logger.exception("Erreur news pendant le cycle principal.")

        elapsed = time.time() - cycle_started
        with RUNTIME_LOCK:
            RUNTIME["last_cycle_at"] = datetime.now(timezone.utc).isoformat()
            RUNTIME["last_cycle_seconds"] = round(elapsed, 2)
        sleep_for = max(5, LOOP_SECONDS - int(elapsed))
        logger.info("Cycle terminé en %.1fs. Prochain cycle dans %ss.", elapsed, sleep_for)
        time.sleep(sleep_for)


def start_background_monitor() -> None:
    thread = threading.Thread(target=monitor_loop, name="monitor-loop", daemon=True)
    thread.start()


if __name__ == "__main__":
    validate_configuration()
    start_background_monitor()
    logger.info("Serveur web Render sur 0.0.0.0:%s", WEB_PORT)
    app.run(host="0.0.0.0", port=WEB_PORT)
