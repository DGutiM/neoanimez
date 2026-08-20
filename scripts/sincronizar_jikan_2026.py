#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import datetime as dt
import json
import os
import random
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, List, Optional, Tuple


JIKAN_BASE = "https://api.jikan.moe/v4"
ANILIST_URL = "https://graphql.anilist.co"
DEFAULT_INPUT = "anime-lista.json"
DEFAULT_OUTPUT = "anime-lista.json"
DEFAULT_YEAR = 2026
REQUEST_DELAY_SECONDS = 2.2
MAX_RETRIES = 5
TIMEOUT_SECONDS = 30


def load_json(path: str, default: Any = None) -> Any:
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: str, data: Any) -> None:
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp_path, path)


def make_backup(path: str) -> str:
    os.makedirs("backups", exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    base = os.path.basename(os.path.splitext(path)[0])
    backup_path = os.path.join("backups", f"{base}.backup-before-jikan-sync.{stamp}.json")
    shutil.copy2(path, backup_path)
    return backup_path


def safe_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    try:
        if value is None:
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def safe_float(value: Any, default: Optional[float] = None) -> Optional[float]:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def unique_values(values: Iterable[Any]) -> List[str]:
    seen = set()
    output = []
    for value in values:
        text = clean_text(value)
        key = text.casefold()
        if not text or key in seen:
            continue
        seen.add(key)
        output.append(text)
    return output


def fetch_json_with_curl(url: str) -> Optional[Dict[str, Any]]:
    curl = shutil.which("curl")
    if not curl:
        return None
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
                str(TIMEOUT_SECONDS),
                "-H",
                "Accept: application/json",
                "-A",
                "NeoAnimeZ-JikanSync/1.0",
                url,
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS + 10,
        )
        payload = json.loads(result.stdout)
        if isinstance(payload, dict):
            print("[INFO] Descarga recuperada mediante curl")
            return payload
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return None
    return None


def fetch_json(url: str) -> Dict[str, Any]:
    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "NeoAnimeZ-JikanSync/1.0 (+local script)",
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            last_error = error
            status = error.code
            if status == 404:
                raise

            retry_after = error.headers.get("Retry-After")
            try:
                wait_seconds = float(retry_after) if retry_after else REQUEST_DELAY_SECONDS * attempt
            except ValueError:
                wait_seconds = REQUEST_DELAY_SECONDS * attempt
            wait_seconds = min(35, wait_seconds + random.uniform(0.25, 1.1))

            if status in (429, 500, 502, 503, 504):
                if attempt == 1:
                    curl_payload = fetch_json_with_curl(url)
                    if curl_payload is not None:
                        return curl_payload
                print(f"[WARN] HTTP {status}. Reintento {attempt}/{MAX_RETRIES} en {wait_seconds:.1f}s")
                time.sleep(wait_seconds)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            if attempt == 1:
                curl_payload = fetch_json_with_curl(url)
                if curl_payload is not None:
                    return curl_payload
            wait_seconds = min(35, REQUEST_DELAY_SECONDS * attempt + random.uniform(0.25, 1.1))
            print(f"[WARN] Error temporal: {error}. Reintento {attempt}/{MAX_RETRIES} en {wait_seconds:.1f}s")
            time.sleep(wait_seconds)

    raise RuntimeError(f"No se pudo leer {url}: {last_error}")


def fetch_paginated(path: str, params: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    page = 1
    items: List[Dict[str, Any]] = []
    params = dict(params or {})

    while True:
        query = urllib.parse.urlencode({**params, "page": page})
        url = f"{JIKAN_BASE}{path}?{query}"
        try:
            payload = fetch_json(url)
        except urllib.error.HTTPError as error:
            if error.code == 404:
                print(f"[WARN] No existe endpoint: {path} page={page}")
                return items
            raise

        page_items = payload.get("data") or []
        items.extend(page_items)
        pagination = payload.get("pagination") or {}
        if not pagination.get("has_next_page"):
            break

        page += 1
        time.sleep(REQUEST_DELAY_SECONDS)

    time.sleep(REQUEST_DELAY_SECONDS)
    return items


def anilist_date(value: Any) -> Tuple[Optional[int], Optional[int], Optional[int]]:
    if not isinstance(value, dict):
        return None, None, None
    return safe_int(value.get("year")), safe_int(value.get("month")), safe_int(value.get("day"))


def anilist_iso_date(value: Any) -> Optional[str]:
    year, month, day = anilist_date(value)
    if not year or not month or not day:
        return None
    try:
        return dt.date(year, month, day).isoformat()
    except ValueError:
        return None


def anilist_to_jikan(item: Dict[str, Any]) -> Dict[str, Any]:
    titles = item.get("title") or {}
    status = clean_text(item.get("status"))
    status_map = {
        "RELEASING": "Currently Airing",
        "FINISHED": "Finished Airing",
        "NOT_YET_RELEASED": "Not yet aired",
        "CANCELLED": "Cancelled",
        "HIATUS": "Currently Airing",
    }
    format_map = {
        "TV": "TV",
        "TV_SHORT": "TV",
        "MOVIE": "Movie",
        "SPECIAL": "Special",
        "OVA": "OVA",
        "ONA": "ONA",
        "MUSIC": "Music",
    }
    start = item.get("startDate") or {}
    end = item.get("endDate") or {}
    start_iso = anilist_iso_date(start)
    end_iso = anilist_iso_date(end)
    next_airing = item.get("nextAiringEpisode") or {}
    airing_at = safe_int(next_airing.get("airingAt"))
    broadcast: Dict[str, Any] = {"day": None, "time": None, "timezone": None, "string": None}
    if airing_at:
        jst = dt.datetime.fromtimestamp(airing_at, dt.timezone.utc) + dt.timedelta(hours=9)
        day_name = jst.strftime("%A") + "s"
        time_text = jst.strftime("%H:%M")
        broadcast = {
            "day": day_name,
            "time": time_text,
            "timezone": "Asia/Tokyo",
            "string": f"{day_name} at {time_text} (JST)",
        }

    genres = [{"name": clean_text(name)} for name in (item.get("genres") or []) if clean_text(name)]
    tags = [
        {"name": clean_text(tag.get("name"))}
        for tag in (item.get("tags") or [])
        if isinstance(tag, dict)
        and safe_int(tag.get("rank"), 0) >= 70
        and not tag.get("isMediaSpoiler")
        and not tag.get("isGeneralSpoiler")
        and clean_text(tag.get("name"))
    ][:12]
    description = re.sub(r"<[^>]+>", " ", clean_text(item.get("description")))
    description = re.sub(r"\s+", " ", description).strip()
    average_score = safe_float(item.get("averageScore"))
    popularity = safe_int(item.get("popularity"), 0) or 0
    favourites = safe_int(item.get("favourites"), 0) or 0
    cover = item.get("coverImage") or {}
    start_year = safe_int(start.get("year")) or safe_int(item.get("seasonYear"))

    return {
        "mal_id": safe_int(item.get("idMal")),
        "url": clean_text(item.get("siteUrl")),
        "images": {"jpg": {"large_image_url": cover.get("extraLarge") or cover.get("large") or ""}},
        "title": clean_text(titles.get("romaji") or titles.get("english") or titles.get("native")),
        "title_english": clean_text(titles.get("english")),
        "title_japanese": clean_text(titles.get("native")),
        "title_synonyms": unique_values(item.get("synonyms") or []),
        "type": format_map.get(clean_text(item.get("format")), clean_text(item.get("format"))),
        "source": clean_text(item.get("source")),
        "episodes": safe_int(item.get("episodes")),
        "status": status_map.get(status, status),
        "airing": status in {"RELEASING", "HIATUS"},
        "aired": {
            "from": start_iso,
            "to": end_iso,
            "prop": {
                "from": {"day": safe_int(start.get("day")), "month": safe_int(start.get("month")), "year": start_year},
                "to": {"day": safe_int(end.get("day")), "month": safe_int(end.get("month")), "year": safe_int(end.get("year"))},
            },
        },
        "duration": f"{safe_int(item.get('duration'))} min per ep" if safe_int(item.get("duration")) else "",
        "score": average_score / 10 if average_score is not None else None,
        "scored_by": None,
        "popularity": popularity or 999999,
        "members": popularity,
        "favorites": favourites,
        "synopsis": description,
        "season": clean_text(item.get("season")).lower(),
        "year": start_year,
        "broadcast": broadcast,
        "genres": genres,
        "explicit_genres": [],
        "themes": tags,
        "demographics": [],
        "_neo_source": "anilist",
    }


def fetch_anilist_year(year: int) -> List[Dict[str, Any]]:
    query = """
    query ($page: Int, $year: Int) {
      Page(page: $page, perPage: 50) {
        pageInfo { hasNextPage }
        media(type: ANIME, seasonYear: $year, sort: POPULARITY_DESC) {
          idMal
          title { romaji english native }
          synonyms
          format
          source
          episodes
          duration
          status
          season
          seasonYear
          startDate { year month day }
          endDate { year month day }
          nextAiringEpisode { airingAt episode }
          description(asHtml: false)
          coverImage { extraLarge large }
          genres
          tags { name rank isMediaSpoiler isGeneralSpoiler }
          averageScore
          popularity
          favourites
          siteUrl
          isAdult
        }
      }
    }
    """
    output: List[Dict[str, Any]] = []
    page = 1
    while True:
        body = json.dumps({"query": query, "variables": {"page": page, "year": year}}).encode("utf-8")
        request = urllib.request.Request(
            ANILIST_URL,
            data=body,
            headers={
                "User-Agent": "NeoAnimeZ-AniListSync/1.0",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        last_error: Optional[Exception] = None
        payload: Dict[str, Any] = {}
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                break
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
                last_error = error
                wait_seconds = min(25, REQUEST_DELAY_SECONDS * attempt + random.uniform(0.2, 0.9))
                print(f"[WARN] AniList page={page}. Reintento {attempt}/{MAX_RETRIES} en {wait_seconds:.1f}s")
                time.sleep(wait_seconds)
        else:
            raise RuntimeError(f"No se pudo leer AniList {year} page={page}: {last_error}")

        page_data = (payload.get("data") or {}).get("Page") or {}
        for item in page_data.get("media") or []:
            if item.get("idMal") and not item.get("isAdult"):
                output.append(anilist_to_jikan(item))
        if not (page_data.get("pageInfo") or {}).get("hasNextPage"):
            break
        page += 1
        time.sleep(0.45)
    return output


def jikan_names(items: Any) -> List[str]:
    if not isinstance(items, list):
        return []
    return unique_values(item.get("name") for item in items if isinstance(item, dict))


def jikan_year(item: Dict[str, Any]) -> Optional[int]:
    year = safe_int(item.get("year"))
    if year:
        return year
    aired = item.get("aired") or {}
    prop = aired.get("prop") or {}
    from_prop = prop.get("from") or {}
    return safe_int(from_prop.get("year"))


def image_url(item: Dict[str, Any]) -> str:
    jpg = ((item.get("images") or {}).get("jpg") or {})
    return jpg.get("large_image_url") or jpg.get("image_url") or ""


def duration_minutes(item: Dict[str, Any]) -> Optional[int]:
    duration = str(item.get("duration") or "")
    hours = re.search(r"(\d+)\s*hr", duration)
    minutes = re.search(r"(\d+)\s*min", duration)
    total = 0
    if hours:
        total += int(hours.group(1)) * 60
    if minutes:
        total += int(minutes.group(1))
    return total or None


def infer_length(item: Dict[str, Any]) -> str:
    minutes = duration_minutes(item)
    episodes = safe_int(item.get("episodes"), 0) or 0
    anime_type = item.get("type")
    if anime_type == "Movie":
        if minutes and minutes >= 75:
            return "largo"
        if minutes and minutes >= 35:
            return "medio"
        return "corto"
    if episodes >= 24:
        return "largo"
    if episodes >= 8:
        return "medio"
    return "corto"


def infer_action_level(genres: List[str], themes: List[str]) -> str:
    values = set(genres + themes)
    high = {"Action", "Adventure", "Combat Sports", "Martial Arts", "Military", "Samurai", "Super Power", "Team Sports"}
    low = {"Slice of Life", "Gourmet", "Iyashikei", "CGDCT", "Romance"}
    if values & high:
        return "alto"
    if values & low:
        return "bajo"
    return "medio"


def infer_emotional(genres: List[str], themes: List[str], synopsis: str) -> bool:
    values = set(genres + themes)
    emotional_values = {"Drama", "Romance", "Slice of Life", "Award Winning", "Iyashikei", "Love Polygon"}
    if values & emotional_values:
        return True
    return bool(re.search(r"\b(friendship|family|love|trauma|grief|heart|bond|dream)\b", synopsis, re.IGNORECASE))


def infer_tone(genres: List[str], themes: List[str], emotional: bool) -> str:
    values = set(genres + themes)
    if values & {"Horror", "Suspense", "Psychological", "Gore"}:
        return "oscuro"
    if values & {"Action", "Adventure", "Military", "Super Power"}:
        return "epico"
    if values & {"Comedy", "Gag Humor", "Parody", "CGDCT"}:
        return "ligero"
    return "emocional" if emotional else "emocional"


def infer_franchise(title: str) -> str:
    text = clean_text(title)
    text = re.sub(r"\s+(?:\d+(?:st|nd|rd|th)?|[IVX]+)(?:\s+Season)?\b.*$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+(?:Season|Part|Movie)\s+\d+.*$", "", text, flags=re.IGNORECASE)
    return clean_text(text.split(":")[0] if ":" in text else text) or title


def build_anime_record(item: Dict[str, Any]) -> Dict[str, Any]:
    genres = jikan_names(item.get("genres")) + jikan_names(item.get("explicit_genres"))
    themes = jikan_names(item.get("themes"))
    demographics = jikan_names(item.get("demographics"))
    synopsis = clean_text(item.get("synopsis"))
    score = safe_float(item.get("score"))
    scored_by = safe_int(item.get("scored_by"))
    members = safe_int(item.get("members"), 0) or 0
    popularity = safe_int(item.get("popularity"), 999999) or 999999
    emotional = infer_emotional(genres, themes, synopsis)
    title = clean_text(item.get("title"))
    title_synonyms = item.get("title_synonyms") if isinstance(item.get("title_synonyms"), list) else []

    return {
        "title": title,
        "mal_id": safe_int(item.get("mal_id")),
        "image": image_url(item),
        "episodes": safe_int(item.get("episodes")),
        "length": infer_length(item),
        "demographic": demographics[0] if demographics else "",
        "genres": unique_values(genres),
        "tone": infer_tone(genres, themes, emotional),
        "fast_start": bool((score and score >= 7.5) or infer_action_level(genres, themes) == "alto"),
        "action_level": infer_action_level(genres, themes),
        "emotional": emotional,
        "popular": bool((scored_by and scored_by >= 25000) or members >= 75000 or popularity <= 1500),
        "year": jikan_year(item),
        "description": synopsis,
        "type": item.get("type") or "",
        "franchise": infer_franchise(title),
        "ongoing": bool(item.get("airing")),
        "source_tags_original": unique_values([item.get("source"), item.get("rating")]),
        "themes": unique_values(themes),
        "score": score,
        "scored_by": scored_by,
        "_update_status": "jikan_2026_new",
        "title_english": clean_text(item.get("title_english")),
        "title_japanese": clean_text(item.get("title_japanese")),
        "title_synonyms": unique_values(title_synonyms),
        "search_titles": unique_values([
            title,
            item.get("title_english"),
            item.get("title_japanese"),
            *title_synonyms,
        ]),
    }


def collect_candidates(year: int, include_upcoming: bool, use_jikan: bool = True) -> List[Dict[str, Any]]:
    seasons = ["winter", "spring", "summer", "fall"]
    by_id: Dict[int, Dict[str, Any]] = {}

    jikan_available = use_jikan
    for season in seasons:
        if not jikan_available:
            continue
        print(f"[INFO] Leyendo Jikan season {year}/{season}")
        try:
            season_items = fetch_paginated(f"/seasons/{year}/{season}")
        except RuntimeError as error:
            print(f"[WARN] Jikan no disponible para {year}/{season}: {error}")
            jikan_available = False
            season_items = []
        for item in season_items:
            mal_id = safe_int(item.get("mal_id"))
            if mal_id:
                by_id.setdefault(mal_id, item)

    if include_upcoming and jikan_available:
        print("[INFO] Leyendo Jikan upcoming")
        try:
            upcoming_items = fetch_paginated("/seasons/upcoming")
        except RuntimeError as error:
            print(f"[WARN] Jikan upcoming no disponible: {error}")
            upcoming_items = []
        for item in upcoming_items:
            mal_id = safe_int(item.get("mal_id"))
            if mal_id and jikan_year(item) == year:
                by_id.setdefault(mal_id, item)

    print(f"[INFO] Leyendo AniList {year} como respaldo")
    for item in fetch_anilist_year(year):
        mal_id = safe_int(item.get("mal_id"))
        if mal_id:
            by_id.setdefault(mal_id, item)

    return list(by_id.values())


def main() -> int:
    parser = argparse.ArgumentParser(description="Añade al maestro animes nuevos de Jikan para un año concreto.")
    parser.add_argument("--input", default=DEFAULT_INPUT, help="JSON maestro de entrada.")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="JSON de salida.")
    parser.add_argument("--year", type=int, default=DEFAULT_YEAR, help="Año a sincronizar.")
    parser.add_argument("--apply", action="store_true", help="Aplica cambios. Sin esto solo simula.")
    parser.add_argument("--include-upcoming", action="store_true", help="Incluye /seasons/upcoming filtrado por año.")
    parser.add_argument("--anilist-only", action="store_true", help="Omite los listados de Jikan y usa AniList como fuente anual.")
    parser.add_argument("--limit", type=int, default=None, help="Limita nuevos animes para pruebas.")
    args = parser.parse_args()

    master = load_json(args.input)
    if not isinstance(master, list):
        raise ValueError(f"{args.input} debe contener una lista de animes.")

    existing_ids = {safe_int(anime.get("mal_id")) for anime in master}
    candidates = collect_candidates(args.year, args.include_upcoming, use_jikan=not args.anilist_only)
    new_items = [item for item in candidates if safe_int(item.get("mal_id")) not in existing_ids]
    new_items.sort(key=lambda item: (
        jikan_year(item) or args.year,
        safe_int(item.get("popularity"), 999999) or 999999,
        safe_int(item.get("mal_id"), 0) or 0,
    ))

    if args.limit is not None:
        new_items = new_items[: args.limit]

    new_records = [build_anime_record(item) for item in new_items]

    print("")
    print(f"Maestro actual: {len(master)} animes")
    print(f"Candidatos Jikan {args.year}: {len(candidates)}")
    print(f"Nuevos detectados: {len(new_records)}")
    if new_records:
        print("\nPrimeros nuevos:")
        for anime in new_records[:25]:
            print(f"- {anime['mal_id']} | {anime['year']} | {anime['type']} | {anime['title']}")

    if not args.apply:
        print("\nDry-run terminado. Ejecuta con --apply para guardar.")
        return 0

    backup = None
    if args.output == args.input:
        backup = make_backup(args.input)

    output = master + new_records
    save_json(args.output, output)

    print("")
    if backup:
        print(f"Backup: {backup}")
    print(f"Guardado: {args.output}")
    print(f"Total final: {len(output)} animes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
