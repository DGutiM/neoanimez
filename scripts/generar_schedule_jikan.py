#!/usr/bin/env python3
"""Genera anime-schedule.json desde el calendario semanal de Jikan.

La web lo usa como dato estatico: no llama a Jikan en vivo, asi que si Jikan
va lento o falla, NeoAnimeZ sigue funcionando con el ultimo JSON subido.
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / "anime-schedule.json"
MASTER_PATH = ROOT / "anime-lista.json"
API_URL = "https://api.jikan.moe/v4/schedules"
SEASON_NOW_URL = "https://api.jikan.moe/v4/seasons/now"
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "unknown"]
DAY_LABELS = {
    "monday": "Lunes",
    "tuesday": "Martes",
    "wednesday": "Miercoles",
    "thursday": "Jueves",
    "friday": "Viernes",
    "saturday": "Sabado",
    "sunday": "Domingo",
    "unknown": "Sin dia",
}
ADULT_MARKERS = ("hentai", "rx - hentai")


def is_adult(item: dict) -> bool:
    values: list[str] = []
    for field in ("genres", "themes", "source_tags_original"):
        raw = item.get(field)
        if isinstance(raw, list):
            values.extend(str(value or "").strip().casefold() for value in raw)
        else:
            values.append(str(raw or "").strip().casefold())
    values.append(str(item.get("rating") or "").strip().casefold())
    return any(marker in value for value in values for marker in ADULT_MARKERS)


def normalize_day(value: str) -> str:
    clean = str(value or "").strip().lower()
    aliases = {
        "mondays": "monday",
        "tuesdays": "tuesday",
        "wednesdays": "wednesday",
        "thursdays": "thursday",
        "fridays": "friday",
        "saturdays": "saturday",
        "sundays": "sunday",
        "lunes": "monday",
        "martes": "tuesday",
        "miercoles": "wednesday",
        "miércoles": "wednesday",
        "jueves": "thursday",
        "viernes": "friday",
        "sabado": "saturday",
        "sábado": "saturday",
        "domingo": "sunday",
    }
    return aliases.get(clean, clean if clean in DAYS else "unknown")


def fetch_json(url: str, retries: int = 6) -> dict:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "NeoAnimeZ schedule builder"})
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt == 0:
                curl = shutil.which("curl")
                if curl:
                    try:
                        result = subprocess.run(
                            [
                                curl,
                                "-fsSL",
                                "--retry",
                                "2",
                                "--retry-all-errors",
                                "--connect-timeout",
                                "10",
                                "--max-time",
                                "30",
                                "-A",
                                "NeoAnimeZ schedule builder",
                                url,
                            ],
                            check=True,
                            capture_output=True,
                            text=True,
                            timeout=40,
                        )
                        payload = json.loads(result.stdout)
                        if isinstance(payload, dict):
                            print("INFO: descarga recuperada mediante curl")
                            return payload
                    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
                        pass
            retry_after = ""
            if isinstance(exc, urllib.error.HTTPError):
                retry_after = exc.headers.get("Retry-After", "")
            try:
                wait_seconds = float(retry_after) if retry_after else 1.8 * (attempt + 1)
            except ValueError:
                wait_seconds = 1.8 * (attempt + 1)
            time.sleep(min(24, wait_seconds + random.uniform(0.2, 0.9)))
    raise RuntimeError(f"No se pudo descargar {url}: {last_error}")


def get_image(item: dict) -> str:
    images = item.get("images") or {}
    jpg = images.get("jpg") or {}
    return (
        jpg.get("large_image_url")
        or jpg.get("image_url")
        or jpg.get("small_image_url")
        or ""
    )


def normalize_item(item: dict, day: str) -> dict:
    broadcast = item.get("broadcast") or {}
    return {
        "mal_id": item.get("mal_id"),
        "title": item.get("title") or "",
        "title_english": item.get("title_english") or "",
        "title_japanese": item.get("title_japanese") or "",
        "image": get_image(item),
        "type": item.get("type") or "",
        "episodes": item.get("episodes"),
        "score": item.get("score"),
        "day": day,
        "broadcast": {
            "day": broadcast.get("day") or day,
            "time": broadcast.get("time") or "",
            "timezone": broadcast.get("timezone") or "",
            "string": broadcast.get("string") or "",
        },
        "broadcast_string": broadcast.get("string") or "",
    }


def load_local_schedule() -> dict[str, list[dict]]:
    days: dict[str, list[dict]] = {day: [] for day in DAYS}
    if not MASTER_PATH.exists():
        return days
    try:
        master = json.loads(MASTER_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return days

    for anime in master if isinstance(master, list) else []:
        if not anime.get("ongoing") or not anime.get("mal_id") or is_adult(anime):
            continue
        day = normalize_day(anime.get("broadcast_day"))
        if day == "unknown":
            continue
        days[day].append({
            "mal_id": anime.get("mal_id"),
            "title": anime.get("title") or "",
            "title_english": anime.get("title_english") or "",
            "title_japanese": anime.get("title_japanese") or "",
            "title_es": anime.get("title_es") or "",
            "image": anime.get("image") or "",
            "type": anime.get("type") or "",
            "episodes": anime.get("episodes"),
            "score": anime.get("score"),
            "scored_by": anime.get("scored_by"),
            "day": day,
            "broadcast": {
                "day": anime.get("broadcast_day") or day,
                "time": anime.get("broadcast_time") or "",
                "timezone": anime.get("broadcast_timezone") or "",
                "string": anime.get("broadcast_string") or "",
            },
            "broadcast_string": anime.get("broadcast_string") or "",
        })
    return days


def fetch_remote_days(url: str) -> dict[str, list[dict]]:
    days: dict[str, list[dict]] = {day: [] for day in DAYS}
    page = 1
    while True:
        payload = fetch_json(f"{url}?page={page}", retries=2)
        data = payload.get("data") or []
        for item in data:
            if not item.get("mal_id") or is_adult(item):
                continue
            broadcast = item.get("broadcast") or {}
            day = normalize_day(broadcast.get("day"))
            days[day].append(normalize_item(item, day))
        pagination = payload.get("pagination") or {}
        if not pagination.get("has_next_page"):
            break
        page += 1
        time.sleep(0.8)
    return days


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera el calendario semanal de NeoAnimeZ.")
    parser.add_argument("--local-only", action="store_true", help="Usa el maestro local sin consultar Jikan.")
    args = parser.parse_args()
    days: dict[str, list[dict]] = {}
    local_days = load_local_schedule()
    seen: set[tuple[str, int]] = set()
    total = 0
    fallback_days: list[str] = []
    remote_source = "local"
    remote_days: dict[str, list[dict]] = {day: [] for day in DAYS}

    if not args.local_only:
        print("Descargando calendario semanal de Jikan...")
        try:
            remote_days = fetch_remote_days(API_URL)
            remote_source = API_URL
        except RuntimeError as schedule_error:
            print(f"AVISO: {schedule_error}. Se probara la temporada actual.")
            try:
                remote_days = fetch_remote_days(SEASON_NOW_URL)
                remote_source = SEASON_NOW_URL
            except RuntimeError as season_error:
                print(f"AVISO: {season_error}. Se usara el maestro local.")
                fallback_days = list(DAYS)
    else:
        fallback_days = list(DAYS)

    for day in DAYS:
        raw_items = list(remote_days.get(day, []))
        remote_ids = {int(item["mal_id"]) for item in raw_items if item.get("mal_id")}
        raw_items.extend(item for item in local_days.get(day, []) if int(item["mal_id"]) not in remote_ids)
        unique_items = []
        for item in raw_items:
            key = (day, int(item["mal_id"]))
            if key in seen:
                continue
            seen.add(key)
            unique_items.append(item)
        days[day] = unique_items
        total += len(unique_items)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": remote_source,
        "timezone_note": "Los horarios vienen de MyAnimeList/Jikan y normalmente estan en JST.",
        "day_order": DAYS,
        "day_labels": DAY_LABELS,
        "days": days,
        "stats": {
            "days": len(DAYS),
            "items": total,
            "local_fallback_days": fallback_days,
            "remote_source": remote_source,
        },
    }

    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"OK: {OUT_PATH} ({total} emisiones)")


if __name__ == "__main__":
    main()
