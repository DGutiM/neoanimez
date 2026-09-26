#!/usr/bin/env python3
"""Genera anime-news.json para el pop-up mensual de NeoAnimeZ.

El script intenta leer feeds RSS/Atom públicos y crea una selección corta.
Si no encuentra suficientes noticias fiables, conserva/usa una selección manual
para que la web nunca dependa de una API en vivo.
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import time
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "anime-news.json"

DEFAULT_FEEDS = [
    "https://www.animenewsnetwork.com/all/rss.xml?ann-edition=us",
    "https://www.animenewsnetwork.com/news/rss.xml?ann-edition=us",
    "https://www.crunchyroll.com/news/rss",
]

IMPORTANT_KEYWORDS = (
    "anime",
    "jujutsu",
    "chainsaw",
    "attack on titan",
    "shingeki",
    "demon slayer",
    "kimetsu",
    "one piece",
    "frieren",
    "mappa",
    "crunchyroll",
    "trailer",
    "season",
    "movie",
    "premiere",
    "release",
    "announced",
    "event",
)

SPANISH_MONTHS = {
    1: "Enero",
    2: "Febrero",
    3: "Marzo",
    4: "Abril",
    5: "Mayo",
    6: "Junio",
    7: "Julio",
    8: "Agosto",
    9: "Septiembre",
    10: "Octubre",
    11: "Noviembre",
    12: "Diciembre",
}


def clean_text(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def fetch_url(url: str, timeout: int = 20) -> bytes:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "NeoAnimeZ monthly news builder/1.0",
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read()


def parse_date(value: str) -> dt.datetime | None:
    text = clean_text(value)
    if not text:
        return None
    try:
        return parsedate_to_datetime(text)
    except Exception:
        pass
    try:
        return dt.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except Exception:
        return None


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def child_text(node: ET.Element, *names: str) -> str:
    wanted = {name.lower() for name in names}
    for child in list(node):
        if local_name(child.tag) in wanted:
            return clean_text(child.text)
    return ""


def item_link(node: ET.Element) -> str:
    for child in list(node):
        if local_name(child.tag) != "link":
            continue
        href = child.attrib.get("href")
        if href:
            return href.strip()
        if child.text:
            return clean_text(child.text)
    return ""


def parse_feed(content: bytes, source_name: str) -> list[dict[str, Any]]:
    root = ET.fromstring(content)
    nodes = [node for node in root.iter() if local_name(node.tag) in {"item", "entry"}]
    output: list[dict[str, Any]] = []
    for node in nodes:
        title = child_text(node, "title")
        summary = child_text(node, "description", "summary", "content")
        published = child_text(node, "pubDate", "published", "updated")
        date = parse_date(published)
        output.append(
            {
                "title": title,
                "summary": summary,
                "date": date.date().isoformat() if date else "",
                "source": source_name,
                "url": item_link(node),
                "tags": [],
                "priority": score_item(title, summary),
            }
        )
    return output


def score_item(title: str, summary: str) -> int:
    haystack = f"{title} {summary}".casefold()
    score = 0
    for keyword in IMPORTANT_KEYWORDS:
        if keyword in haystack:
            score += 12
    if "trailer" in haystack or "teaser" in haystack:
        score += 10
    if "release date" in haystack or "premiere" in haystack:
        score += 8
    return score


def infer_tags(title: str, summary: str) -> list[str]:
    haystack = f"{title} {summary}".casefold()
    tags = []
    known = {
        "Jujutsu Kaisen": ("jujutsu",),
        "Chainsaw Man": ("chainsaw",),
        "Attack on Titan": ("attack on titan", "shingeki"),
        "Demon Slayer": ("demon slayer", "kimetsu"),
        "One Piece": ("one piece",),
        "Frieren": ("frieren",),
        "MAPPA": ("mappa",),
        "Crunchyroll": ("crunchyroll",),
        "Tráiler": ("trailer", "teaser"),
        "Estrenos": ("premiere", "release", "season"),
    }
    for label, needles in known.items():
        if any(needle in haystack for needle in needles):
            tags.append(label)
    return tags[:4]


def load_existing_manual(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    items = payload.get("items")
    return items if isinstance(items, list) else []


def source_from_url(url: str) -> str:
    if "animenewsnetwork" in url:
        return "Anime News Network"
    if "crunchyroll" in url:
        return "Crunchyroll"
    return "Fuente anime"


def build_payload(items: list[dict[str, Any]], target: dt.date, limit: int) -> dict[str, Any]:
    month_key = f"{target.year}-{target.month:02d}"
    month_name = SPANISH_MONTHS.get(target.month, target.strftime("%B"))
    dedup: dict[str, dict[str, Any]] = {}

    for item in items:
        title = clean_text(item.get("title"))
        if not title:
            continue
        date_text = clean_text(item.get("date"))
        if date_text and not date_text.startswith(month_key):
            continue
        summary = clean_text(item.get("summary"))
        key = re.sub(r"\W+", "", title.casefold())[:90]
        if key in dedup:
            continue
        tags = item.get("tags") if isinstance(item.get("tags"), list) else []
        dedup[key] = {
            "title": title,
            "summary": summary[:260],
            "date": date_text,
            "source": clean_text(item.get("source")),
            "url": clean_text(item.get("url")),
            "tags": tags or infer_tags(title, summary),
            "priority": int(item.get("priority") or score_item(title, summary)),
        }

    selected = sorted(dedup.values(), key=lambda item: (-int(item["priority"]), item.get("date") or ""))[:limit]
    return {
        "month": month_key,
        "title": f"Novedades de {month_name}",
        "subtitle": "Noticias y eventos de anime que estamos siguiendo este mes en NeoAnimeZ.",
        "updated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "source_note": "Selección editorial de titulares enlazados. NeoAnimeZ muestra resumen propio y no copia artículos completos.",
        "items": selected,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera anime-news.json desde feeds RSS/Atom y selección manual.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--month", default=dt.date.today().strftime("%Y-%m"))
    parser.add_argument("--limit", type=int, default=6)
    parser.add_argument("--feed", action="append", default=[])
    parser.add_argument("--timeout", type=int, default=20)
    args = parser.parse_args()

    year, month = [int(part) for part in args.month.split("-", 1)]
    target = dt.date(year, month, 1)
    output = Path(args.output)
    feed_urls = args.feed or DEFAULT_FEEDS

    collected: list[dict[str, Any]] = []
    for url in feed_urls:
        try:
            content = fetch_url(url, timeout=args.timeout)
            collected.extend(parse_feed(content, source_from_url(url)))
            time.sleep(0.4)
        except Exception as exc:  # noqa: BLE001
            print(f"[WARN] No se pudo leer {url}: {exc}")

    manual_items = load_existing_manual(output)
    payload = build_payload([*collected, *manual_items], target, args.limit)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"OK: {output} ({len(payload['items'])} novedades)")
    if len(payload["items"]) < args.limit:
      print("[INFO] Hay pocas noticias automáticas; revisa o añade selección manual en anime-news.json.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
