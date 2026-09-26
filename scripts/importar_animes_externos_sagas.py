#!/usr/bin/env python3
"""Incorpora al maestro los animes que los mapas de saga aún marcan como externos.

La descarga usa AniList en lotes y una caché reanudable. Después de importar,
los scripts habituales de NeoAnimeZ completan traducciones, estados, catálogo
dividido, relaciones y mapas.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import random
import shutil
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import sincronizar_jikan_2026 as catalog_tools


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MASTER = ROOT / "anime-lista.json"
DEFAULT_TIMELINES = ROOT / "anime-timelines.full.json"
DEFAULT_CACHE = ROOT / "cache" / "anilist-external-catalog-cache.json"
DEFAULT_RELATIONS_REPORT = ROOT / "cache" / "anime-relations-report.json"
DEFAULT_TIMELINE_CACHE = ROOT / "cache" / "anime-timelines-cache.json"
IGNORED_FORMATS = {"MANGA", "NOVEL", "ONE_SHOT", "MUSIC", "PV", "CM"}
ANILIST_URL = "https://graphql.anilist.co"
MAX_RETRIES = 6
TIMEOUT_SECONDS = 35


QUERY_BY_MAL = """
query ($ids: [Int]) {
  Page(page: 1, perPage: 50) {
    media(type: ANIME, idMal_in: $ids, sort: ID) {
      id
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

QUERY_BY_ANILIST = QUERY_BY_MAL.replace("idMal_in: $ids", "id_in: $ids")


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
        result = int(value)
        return result if result > 0 else None
    except (TypeError, ValueError):
        return None


def fetch_batch(anime_ids: list[int], *, query: str = QUERY_BY_MAL) -> list[dict[str, Any]]:
    request = urllib.request.Request(
        ANILIST_URL,
        data=json.dumps({"query": query, "variables": {"ids": anime_ids}}).encode("utf-8"),
        headers={
            "User-Agent": "NeoAnimeZ-ExternalCatalogImporter/1.0",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if payload.get("errors"):
                raise RuntimeError(str(payload["errors"][:2]))
            return ((payload.get("data") or {}).get("Page") or {}).get("media") or []
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as error:
            last_error = error
            wait = min(35.0, attempt * 2.0 + random.uniform(0.2, 0.9))
            print(f"[WARN] AniList lote de {len(anime_ids)}: {error}; reintento en {wait:.1f}s")
            time.sleep(wait)
    raise RuntimeError(f"No se pudo descargar el lote {anime_ids[:3]}…: {last_error}")


def target_nodes(
    master: list[dict[str, Any]],
    timelines: dict[str, Any],
    relations_report: dict[str, Any],
    timeline_cache: dict[str, Any],
) -> dict[int, dict[str, Any]]:
    fallback_ids = {
        anime_id
        for anime in master
        if isinstance(anime, dict)
        and anime.get("_neo_source") == "timeline_fallback"
        and (anime_id := safe_int(anime.get("mal_id")))
    }
    local_ids = {
        anime_id
        for anime in master
        if isinstance(anime, dict) and (anime_id := safe_int(anime.get("mal_id")))
        and anime_id not in fallback_ids
    }
    output: dict[int, dict[str, Any]] = {}
    for key, node in (timelines.get("nodes") or {}).items():
        if not isinstance(node, dict):
            continue
        anime_id = safe_int(node.get("mal_id") or key)
        media_format = str(node.get("format") or node.get("type") or "").strip().upper()
        if not anime_id or anime_id in local_ids or media_format in IGNORED_FORMATS:
            continue
        output[anime_id] = node

    cached_records = timeline_cache.get("items") if isinstance(timeline_cache, dict) else {}
    cached_records = cached_records if isinstance(cached_records, dict) else {}
    for relation in relations_report.get("unavailable_targets") or []:
        if not isinstance(relation, dict):
            continue
        anime_id = safe_int(relation.get("target_id"))
        if not anime_id or anime_id in local_ids or anime_id in output:
            continue
        cached = cached_records.get(str(anime_id)) or {}
        node = cached.get("media") if isinstance(cached, dict) else None
        if not isinstance(node, dict):
            continue
        media_format = str(node.get("format") or node.get("type") or "").strip().upper()
        if media_format in IGNORED_FORMATS:
            continue
        output[anime_id] = node
    return output


def build_record(raw: dict[str, Any]) -> dict[str, Any]:
    converted = catalog_tools.anilist_to_jikan(raw)
    record = catalog_tools.build_anime_record(converted)
    aired = converted.get("aired") or {}
    broadcast = converted.get("broadcast") or {}
    record.update(
        {
            "ongoing": bool(converted.get("airing")),
            "airing_status": str(converted.get("status") or ""),
            "aired_from": aired.get("from") or "",
            "aired_to": aired.get("to") or "",
            "broadcast_day": broadcast.get("day") or "",
            "broadcast_time": broadcast.get("time") or "",
            "broadcast_timezone": broadcast.get("timezone") or "",
            "broadcast_string": broadcast.get("string") or "",
            "_neo_source": "anilist_saga_import",
            "_update_status": "anilist_saga_import",
        }
    )
    return record


def build_fallback(node: dict[str, Any]) -> dict[str, Any]:
    anime_id = safe_int(node.get("mal_id"))
    title = str(node.get("title") or node.get("title_english") or f"Anime {anime_id}").strip()
    anime_type = str(node.get("format") or "Anime").strip().replace("TV_SHORT", "TV").title()
    if anime_type == "Ona":
        anime_type = "ONA"
    elif anime_type == "Ova":
        anime_type = "OVA"
    return {
        "title": title,
        "mal_id": anime_id,
        "image": str(node.get("image") or ""),
        "episodes": safe_int(node.get("episodes")),
        "length": "corto" if safe_int(node.get("episodes")) in (None, 1) else "medio",
        "demographic": "",
        "genres": [],
        "tone": "emocional",
        "fast_start": False,
        "action_level": "medio",
        "emotional": False,
        "popular": False,
        "year": safe_int(node.get("year")),
        "description": "",
        "type": anime_type,
        "franchise": catalog_tools.infer_franchise(title),
        "ongoing": False,
        "source_tags_original": [],
        "themes": [],
        "score": None,
        "scored_by": None,
        "title_english": str(node.get("title_english") or ""),
        "title_japanese": "",
        "title_synonyms": [],
        "search_titles": catalog_tools.unique_values([title, node.get("title_english")]),
        "aired_from": str(node.get("release_date") or ""),
        "_neo_source": "timeline_fallback",
        "_update_status": "timeline_fallback",
    }


def make_backup(path: Path) -> Path:
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_dir = ROOT / "backups" / f"before-external-catalog-import-{stamp}"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / path.name
    shutil.copy2(path, backup)
    return backup


def main() -> int:
    parser = argparse.ArgumentParser(description="Importa fichas externas de los mapas de saga al catálogo maestro.")
    parser.add_argument("--master", type=Path, default=DEFAULT_MASTER)
    parser.add_argument("--timelines", type=Path, default=DEFAULT_TIMELINES)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--relations-report", type=Path, default=DEFAULT_RELATIONS_REPORT)
    parser.add_argument("--timeline-cache", type=Path, default=DEFAULT_TIMELINE_CACHE)
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--delay", type=float, default=0.55)
    parser.add_argument("--max-items", type=int, default=None)
    parser.add_argument("--force", action="store_true", help="Vuelve a consultar AniList aunque el ID esté en caché.")
    parser.add_argument("--apply", action="store_true", help="Añade las fichas a anime-lista.json.")
    args = parser.parse_args()

    master = load_json(args.master, [])
    timelines = load_json(args.timelines, {})
    relations_report = load_json(args.relations_report, {})
    timeline_cache = load_json(args.timeline_cache, {})
    if not isinstance(master, list):
        raise ValueError(f"{args.master} debe contener una lista JSON.")
    if not isinstance(timelines, dict):
        raise ValueError(f"{args.timelines} debe contener el mapa completo.")

    targets = target_nodes(master, timelines, relations_report, timeline_cache)
    target_ids = sorted(targets)
    if args.max_items is not None:
        target_ids = target_ids[: max(0, args.max_items)]
    cache = load_json(args.cache, {"version": 1, "items": {}})
    if not isinstance(cache, dict):
        cache = {"version": 1, "items": {}}
    cached_items = cache.setdefault("items", {})

    pending = [
        anime_id
        for anime_id in target_ids
        if args.force or not isinstance(cached_items.get(str(anime_id)), dict)
    ]
    print(f"[INFO] Maestro: {len(master)}")
    print(f"[INFO] Fichas externas válidas: {len(targets)}")
    print(f"[INFO] Seleccionadas: {len(target_ids)}; pendientes de red: {len(pending)}")

    batch_size = min(50, max(1, args.batch_size))
    for start in range(0, len(pending), batch_size):
        batch = pending[start : start + batch_size]
        fetched = fetch_batch(batch)
        fetched_by_id = {
            anime_id: item
            for item in fetched
            if (anime_id := safe_int(item.get("idMal")))
        }
        unresolved = [anime_id for anime_id in batch if anime_id not in fetched_by_id]
        anilist_to_mal = {
            anilist_id: anime_id
            for anime_id in unresolved
            if (anilist_id := safe_int(targets[anime_id].get("anilist_id")))
        }
        if anilist_to_mal:
            fetched_by_anilist = fetch_batch(sorted(anilist_to_mal), query=QUERY_BY_ANILIST)
            for item in fetched_by_anilist:
                target_id = anilist_to_mal.get(safe_int(item.get("id")))
                if not target_id:
                    continue
                normalized = dict(item)
                normalized["idMal"] = target_id
                fetched_by_id[target_id] = normalized
        for anime_id in batch:
            cached_items[str(anime_id)] = fetched_by_id.get(anime_id)
        cache["updated_at"] = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
        save_json(args.cache, cache, pretty=False)
        print(f"[INFO] AniList {min(start + batch_size, len(pending))}/{len(pending)}")
        if start + batch_size < len(pending):
            time.sleep(max(0.0, args.delay))

    records: list[dict[str, Any]] = []
    resolved = 0
    fallback = 0
    for anime_id in target_ids:
        raw = cached_items.get(str(anime_id))
        if isinstance(raw, dict):
            records.append(build_record(raw))
            resolved += 1
        else:
            records.append(build_fallback(targets[anime_id]))
            fallback += 1

    print(f"[RESUMEN] Preparadas: {len(records)}; completas: {resolved}; respaldo mínimo: {fallback}")
    if not args.apply:
        print("[INFO] Simulación terminada. Usa --apply para modificar el maestro.")
        return 0

    backup = make_backup(args.master)
    records_by_id = {
        anime_id: record
        for record in records
        if (anime_id := safe_int(record.get("mal_id")))
    }
    replaced = 0
    updated_master: list[dict[str, Any]] = []
    for item in master:
        anime_id = safe_int(item.get("mal_id")) if isinstance(item, dict) else None
        replacement = records_by_id.get(anime_id)
        if replacement and item.get("_neo_source") == "timeline_fallback":
            updated_master.append(replacement)
            replaced += 1
        else:
            updated_master.append(item)
    existing_ids = {safe_int(item.get("mal_id")) for item in updated_master if isinstance(item, dict)}
    additions = [record for record in records if safe_int(record.get("mal_id")) not in existing_ids]
    save_json(args.master, [*updated_master, *additions])
    print(f"[OK] Añadidas: {len(additions)}; reemplazadas: {replaced}; total: {len(updated_master) + len(additions)}")
    print(f"[OK] Backup: {backup}")
    print(f"[OK] Maestro: {args.master}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
