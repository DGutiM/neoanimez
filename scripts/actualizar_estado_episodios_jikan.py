#!/usr/bin/env python3
"""Actualiza episodios y estado de emision sin alterar el contenido curado.

Primero descarga las temporadas del ano indicado para resolver muchos animes
con pocas peticiones. Solo consulta fichas individuales para los titulos que
siguen marcados como en emision o sin total de episodios.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import random
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "anime-lista.json"
DEFAULT_CACHE = ROOT / "cache" / "jikan-airing-cache.json"
JIKAN_BASE = "https://api.jikan.moe/v4"
ANILIST_URL = "https://graphql.anilist.co"
SEASONS = ("winter", "spring", "summer", "fall")
REQUEST_DELAY = 1.15
MAX_RETRIES = 5


def load_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, payload: Any, *, pretty: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(
            payload,
            handle,
            ensure_ascii=False,
            indent=2 if pretty else None,
            separators=None if pretty else (",", ":"),
        )
        handle.write("\n")
    temporary.replace(path)


def safe_int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def fetch_json(url: str) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "NeoAnimeZ airing updater/1.0",
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code == 404:
                raise
            retry_after = error.headers.get("Retry-After")
            try:
                wait = float(retry_after) if retry_after else REQUEST_DELAY * attempt
            except ValueError:
                wait = REQUEST_DELAY * attempt
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            wait = REQUEST_DELAY * attempt

        wait = min(30, wait + random.uniform(0.2, 0.8))
        print(f"[WARN] Reintento {attempt}/{MAX_RETRIES} en {wait:.1f}s: {last_error}")
        time.sleep(wait)

    raise RuntimeError(f"No se pudo descargar {url}: {last_error}")


def fetch_paginated(path: str) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    page = 1
    while True:
        query = urllib.parse.urlencode({"page": page})
        payload = fetch_json(f"{JIKAN_BASE}{path}?{query}")
        output.extend(item for item in (payload.get("data") or []) if item.get("mal_id"))
        if not (payload.get("pagination") or {}).get("has_next_page"):
            break
        page += 1
        time.sleep(REQUEST_DELAY)
    return output


def fetch_anime(anime_id: int) -> dict[str, Any] | None:
    try:
        return (fetch_json(f"{JIKAN_BASE}/anime/{anime_id}") or {}).get("data")
    except urllib.error.HTTPError as error:
        if error.code == 404:
            print(f"[WARN] Jikan ya no devuelve mal_id={anime_id}")
            return None
        raise


def fetch_anilist_batch(anime_ids: list[int]) -> list[dict[str, Any]]:
    query = """
    query ($ids: [Int]) {
      Page(perPage: 50) {
        media(idMal_in: $ids, type: ANIME) {
          idMal
          episodes
          status
          averageScore
          seasonYear
          startDate { year month day }
          endDate { year month day }
          nextAiringEpisode { airingAt episode }
        }
      }
    }
    """
    payload = json.dumps({"query": query, "variables": {"ids": anime_ids}}).encode("utf-8")
    request = urllib.request.Request(
        ANILIST_URL,
        data=payload,
        headers={
            "User-Agent": "NeoAnimeZ airing updater/1.0",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=35) as response:
        body = json.loads(response.read().decode("utf-8"))
    return (((body.get("data") or {}).get("Page") or {}).get("media") or [])


def anilist_record(item: dict[str, Any]) -> dict[str, Any]:
    status = str(item.get("status") or "")
    next_episode = item.get("nextAiringEpisode") or {}
    airing_at = safe_int(next_episode.get("airingAt"))
    broadcast_day = ""
    broadcast_time = ""
    broadcast_string = ""
    if airing_at:
        jst = dt.datetime.fromtimestamp(airing_at, dt.timezone.utc) + dt.timedelta(hours=9)
        broadcast_day = jst.strftime("%A") + "s"
        broadcast_time = jst.strftime("%H:%M")
        broadcast_string = f"{broadcast_day} at {broadcast_time} (JST)"
    status_labels = {
        "RELEASING": "Currently Airing",
        "FINISHED": "Finished Airing",
        "NOT_YET_RELEASED": "Not yet aired",
        "CANCELLED": "Cancelled",
        "HIATUS": "Currently Airing",
    }

    def date_string(value: Any) -> str:
        if not isinstance(value, dict):
            return ""
        year = safe_int(value.get("year"))
        month = safe_int(value.get("month"))
        day = safe_int(value.get("day"))
        if not year or not month or not day:
            return ""
        try:
            return dt.date(year, month, day).isoformat()
        except ValueError:
            return ""

    return {
        "mal_id": safe_int(item.get("idMal")),
        "episodes": safe_int(item.get("episodes")),
        "airing": status in {"RELEASING", "HIATUS"},
        "status": status_labels.get(status, status),
        "year": safe_int(item.get("seasonYear")),
        "broadcast_day": broadcast_day,
        "broadcast_time": broadcast_time,
        "broadcast_timezone": "Asia/Tokyo" if airing_at else "",
        "broadcast_string": broadcast_string,
        "aired_from": date_string(item.get("startDate")),
        "aired_to": date_string(item.get("endDate")),
    }


def cache_record(item: dict[str, Any]) -> dict[str, Any]:
    broadcast = item.get("broadcast") or {}
    aired = item.get("aired") or {}
    return {
        "mal_id": safe_int(item.get("mal_id")),
        "episodes": safe_int(item.get("episodes")),
        "airing": bool(item.get("airing")),
        "status": str(item.get("status") or ""),
        "score": item.get("score"),
        "scored_by": safe_int(item.get("scored_by")),
        "broadcast_day": broadcast.get("day") or item.get("broadcast_day") or "",
        "broadcast_time": broadcast.get("time") or item.get("broadcast_time") or "",
        "broadcast_timezone": broadcast.get("timezone") or item.get("broadcast_timezone") or "",
        "broadcast_string": broadcast.get("string") or item.get("broadcast_string") or "",
        "aired_from": aired.get("from") or item.get("aired_from") or "",
        "aired_to": aired.get("to") or item.get("aired_to") or "",
        "updated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
    }


def update_anime(local: dict[str, Any], remote: dict[str, Any]) -> tuple[bool, list[str]]:
    changed_fields: list[str] = []
    remote_episodes = safe_int(remote.get("episodes"))
    remote_status = str(remote.get("status") or "")
    remote_ongoing = bool(remote.get("airing")) or remote_status == "Currently Airing"
    broadcast = remote.get("broadcast") or {}
    aired = remote.get("aired") or {}

    updates: dict[str, Any] = {
        "ongoing": remote_ongoing,
        "airing_status": remote_status,
    }
    optional_updates = {
        "year": safe_int(remote.get("year")),
        "broadcast_day": broadcast.get("day") or remote.get("broadcast_day"),
        "broadcast_time": broadcast.get("time") or remote.get("broadcast_time"),
        "broadcast_timezone": broadcast.get("timezone") or remote.get("broadcast_timezone"),
        "broadcast_string": broadcast.get("string") or remote.get("broadcast_string"),
        "aired_from": aired.get("from") or remote.get("aired_from"),
        "aired_to": aired.get("to") or remote.get("aired_to"),
    }
    updates.update({field: value for field, value in optional_updates.items() if value not in (None, "")})
    if remote_episodes and remote_episodes > 0:
        updates["episodes"] = remote_episodes
    if remote.get("score") is not None:
        updates["score"] = remote.get("score")
    if safe_int(remote.get("scored_by")) is not None:
        updates["scored_by"] = safe_int(remote.get("scored_by"))

    for field, value in updates.items():
        if local.get(field) == value:
            continue
        local[field] = value
        changed_fields.append(field)

    return bool(changed_fields), changed_fields


def make_backup(path: Path) -> Path:
    backup_dir = ROOT / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = backup_dir / f"{path.stem}.backup-before-airing-refresh.{stamp}{path.suffix}"
    shutil.copy2(path, backup)
    return backup


def anime_year(anime: dict[str, Any]) -> int | None:
    explicit = safe_int(anime.get("year"))
    if explicit:
        return explicit
    aired_from = str(anime.get("aired_from") or "")
    if len(aired_from) >= 4 and aired_from[:4].isdigit():
        return int(aired_from[:4])
    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Actualiza episodios y estado de emision desde Jikan."
    )
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--year", type=int, default=dt.date.today().year)
    parser.add_argument("--apply", action="store_true", help="Guarda los cambios en el JSON maestro.")
    parser.add_argument("--force", action="store_true", help="Ignora la cache de fichas individuales.")
    parser.add_argument("--skip-seasons", action="store_true", help="Consulta directamente las fichas individuales.")
    parser.add_argument("--anilist-only", action="store_true", help="Usa AniList en lotes y no consulta fichas individuales de Jikan.")
    args = parser.parse_args()

    master = load_json(args.input)
    if not isinstance(master, list):
        raise ValueError(f"{args.input} debe contener una lista.")

    cache = load_json(args.cache, default={})
    if not isinstance(cache, dict):
        cache = {}

    candidates = {
        safe_int(anime.get("mal_id"))
        for anime in master
        if anime_year(anime) == args.year
        or anime.get("ongoing")
        or safe_int(anime.get("episodes")) in (None, 0)
    }
    candidates.discard(None)
    print(f"[INFO] Candidatos: {len(candidates)}")

    remote_by_id: dict[int, dict[str, Any]] = {}
    candidate_list = sorted(int(anime_id) for anime_id in candidates)
    for start in range(0, len(candidate_list), 50):
        batch = candidate_list[start:start + 50]
        try:
            anilist_items = fetch_anilist_batch(batch)
        except Exception as error:  # noqa: BLE001
            print(f"[WARN] Fallo temporal de AniList en lote {start // 50 + 1}: {error}")
            anilist_items = []
        for item in anilist_items:
            record = anilist_record(item)
            anime_id = safe_int(record.get("mal_id"))
            if anime_id in candidates:
                remote_by_id[anime_id] = record
        print(f"[INFO] AniList {min(start + 50, len(candidate_list))}/{len(candidate_list)}")
        time.sleep(0.45)
    if not args.skip_seasons and not args.anilist_only:
        for season in SEASONS:
            print(f"[INFO] Jikan {args.year}/{season}")
            try:
                season_items = fetch_paginated(f"/seasons/{args.year}/{season}")
            except RuntimeError as error:
                print(f"[WARN] No se pudo leer la temporada completa: {error}")
                season_items = []
            for item in season_items:
                anime_id = safe_int(item.get("mal_id"))
                if anime_id in candidates:
                    remote_by_id[anime_id] = item
            time.sleep(REQUEST_DELAY)

    remaining = sorted(anime_id for anime_id in candidates if anime_id not in remote_by_id)
    print(f"[INFO] Resueltos por temporada: {len(remote_by_id)}; fichas individuales: {len(remaining)}")
    failed_ids: list[int] = []

    for position, anime_id in enumerate([] if args.anilist_only else remaining, start=1):
        cached = cache.get(str(anime_id))
        if cached and not args.force:
            remote_by_id[anime_id] = cached
        else:
            try:
                item = fetch_anime(anime_id)
            except RuntimeError as error:
                print(f"[WARN] Se pospone mal_id={anime_id}: {error}")
                failed_ids.append(anime_id)
                item = None
            if item:
                remote_by_id[anime_id] = item
                cache[str(anime_id)] = cache_record(item)
            time.sleep(REQUEST_DELAY)
        if position % 25 == 0:
            save_json(args.cache, cache)
            print(f"[INFO] Fichas individuales {position}/{len(remaining)}")

    changed_anime = 0
    episodes_completed = 0
    closed_airing = 0
    for anime in master:
        anime_id = safe_int(anime.get("mal_id"))
        remote = remote_by_id.get(anime_id)
        if not remote:
            continue
        old_episodes = safe_int(anime.get("episodes"))
        old_ongoing = bool(anime.get("ongoing"))
        changed, _ = update_anime(anime, remote)
        if changed:
            changed_anime += 1
        if old_episodes in (None, 0) and safe_int(anime.get("episodes")):
            episodes_completed += 1
        if old_ongoing and not anime.get("ongoing"):
            closed_airing += 1

    save_json(args.cache, cache)
    print(
        f"[RESUMEN] Modificados: {changed_anime}; nuevos totales de episodios: "
        f"{episodes_completed}; emisiones cerradas: {closed_airing}; pendientes: {len(failed_ids)}"
    )
    if failed_ids:
        print("[PENDIENTES] " + ", ".join(str(anime_id) for anime_id in failed_ids))

    if not args.apply:
        print("[INFO] Simulacion terminada. Usa --apply para guardar anime-lista.json.")
        return 0

    backup = make_backup(args.input)
    save_json(args.input, master)
    print(f"[OK] Backup: {backup}")
    print(f"[OK] Actualizado: {args.input}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
