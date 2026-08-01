#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import datetime as dt
import json
import math
import os
import shutil
import sys
import time
from typing import Any, Dict, List, Optional, Tuple


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import generar_titulos_es as title_es
import limpiar_descripciones as desc_cleaner
import sincronizar_jikan_2026 as jikan_sync
import traducir_descripciones as desc_es


DEFAULT_MASTER = "anime-lista.json"
DEFAULT_OUTPUT = "anime-upcoming.full.json"
SEASONS = ("winter", "spring", "summer", "fall")
SEASON_LABELS = {
    "winter": "Invierno",
    "spring": "Primavera",
    "summer": "Verano",
    "fall": "Otoño",
    "unknown": "Fecha indefinida",
}


def load_json(path: str, default: Any = None) -> Any:
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: str, data: Any) -> None:
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp_path, path)


def make_backup(path: str) -> Optional[str]:
    if not os.path.exists(path):
        return None
    os.makedirs("backups", exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    base = os.path.basename(os.path.splitext(path)[0])
    backup_path = os.path.join("backups", f"{base}.backup-before-upcoming.{stamp}.json")
    shutil.copy2(path, backup_path)
    return backup_path


def iso_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def safe_int(value: Any, default: int = 0) -> int:
    parsed = jikan_sync.safe_int(value)
    return default if parsed is None else parsed


def clean_text(value: Any) -> str:
    return jikan_sync.clean_text(value)


def aired_dates(item: Dict[str, Any]) -> Tuple[str, str]:
    aired = item.get("aired") or {}
    return clean_text(aired.get("from")), clean_text(aired.get("to"))


def month_from_aired(item: Dict[str, Any]) -> Optional[int]:
    aired = item.get("aired") or {}
    prop = aired.get("prop") or {}
    from_prop = prop.get("from") or {}
    return jikan_sync.safe_int(from_prop.get("month"))


def season_from_month(month: Optional[int]) -> str:
    if month in (1, 2, 3):
        return "winter"
    if month in (4, 5, 6):
        return "spring"
    if month in (7, 8, 9):
        return "summer"
    if month in (10, 11, 12):
        return "fall"
    return "unknown"


def season_for_item(item: Dict[str, Any], hint: Optional[str] = None) -> str:
    if hint in SEASONS:
        return hint
    season = clean_text(item.get("season")).lower()
    if season in SEASONS:
        return season
    return season_from_month(month_from_aired(item))


def anticipation_score(item: Dict[str, Any]) -> float:
    members = safe_int(item.get("members"))
    favorites = safe_int(item.get("favorites"))
    popularity = safe_int(item.get("popularity"), 999999)
    scored_by = safe_int(item.get("scored_by"))

    # MAL "members" es la mejor señal gratuita para "más esperados":
    # gente que lo tiene fichado aunque todavía no haya nota sólida.
    score = math.log10(members + 1) * 100
    score += math.log10(favorites + 1) * 24
    score += math.log10(scored_by + 1) * 8
    if popularity > 0:
        score += max(0, 100000 - popularity) / 2200
    return round(score, 2)


def ranking_key(record: Dict[str, Any]) -> Tuple[float, int, int, str]:
    return (
        -float(record.get("anticipation_score") or 0),
        -safe_int(record.get("members")),
        safe_int(record.get("mal_popularity"), 999999),
        clean_text(record.get("title")).casefold(),
    )


def trailer_url(item: Dict[str, Any]) -> str:
    trailer = item.get("trailer") or {}
    return clean_text(trailer.get("url") or trailer.get("embed_url"))


def build_record(item: Dict[str, Any], season_hint: Optional[str], sources: List[str]) -> Dict[str, Any]:
    record = jikan_sync.build_anime_record(item)
    season_key = season_for_item(item, season_hint)
    aired_from, aired_to = aired_dates(item)

    record["_update_status"] = "jikan_upcoming"
    record["upcoming_year"] = jikan_sync.jikan_year(item)
    record["upcoming_season"] = season_key
    record["upcoming_season_label"] = SEASON_LABELS.get(season_key, SEASON_LABELS["unknown"])
    record["upcoming_sources"] = sorted(set(sources))
    record["aired_from"] = aired_from
    record["aired_to"] = aired_to
    record["airing_status"] = clean_text(item.get("status"))
    record["broadcast"] = item.get("broadcast") or {}
    record["members"] = safe_int(item.get("members"))
    record["favorites"] = safe_int(item.get("favorites"))
    record["mal_popularity"] = safe_int(item.get("popularity"), 999999)
    record["anticipation_score"] = anticipation_score(item)
    record["jikan_url"] = clean_text(item.get("url"))
    record["trailer_url"] = trailer_url(item)
    return record


def merge_local_fields(record: Dict[str, Any], master: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not master:
        return record

    for field in (
        "title_es",
        "title_es_reviewed",
        "title_es_source",
        "title_es_status",
        "search_titles_es",
        "description_es",
    ):
        value = master.get(field)
        if value not in (None, "", []):
            record[field] = value

    if not clean_text(record.get("description")) and clean_text(master.get("description")):
        record["description"] = master.get("description")

    if not record.get("episodes") and master.get("episodes"):
        record["episodes"] = master.get("episodes")

    return record


def collect_jikan_items(year: int, include_tba: bool, use_jikan: bool = True) -> Tuple[Dict[int, Dict[str, Any]], Dict[int, Dict[str, Any]]]:
    by_id: Dict[int, Dict[str, Any]] = {}
    meta_by_id: Dict[int, Dict[str, Any]] = {}

    def add_item(item: Dict[str, Any], source: str, season_hint: Optional[str] = None) -> None:
        mal_id = jikan_sync.safe_int(item.get("mal_id"))
        if not mal_id:
            return
        if mal_id not in by_id:
            by_id[mal_id] = item
            meta_by_id[mal_id] = {"sources": [], "season_hint": season_hint}

        meta = meta_by_id[mal_id]
        meta["sources"].append(source)
        if season_hint in SEASONS:
            meta["season_hint"] = season_hint

        if source == "upcoming" and not meta.get("season_hint"):
            meta["season_hint"] = season_for_item(item)

    jikan_available = use_jikan
    for season in SEASONS:
        if not jikan_available:
            continue
        print(f"[INFO] Leyendo Jikan season {year}/{season}")
        try:
            season_items = jikan_sync.fetch_paginated(f"/seasons/{year}/{season}")
        except RuntimeError as error:
            print(f"[WARN] Jikan no disponible; se usara AniList: {error}")
            jikan_available = False
            season_items = []
        for item in season_items:
            add_item(item, f"{year}/{season}", season)

    if jikan_available:
        print("[INFO] Leyendo Jikan upcoming")
        try:
            upcoming_items = jikan_sync.fetch_paginated("/seasons/upcoming")
        except RuntimeError as error:
            print(f"[WARN] Jikan upcoming no disponible; se usara AniList: {error}")
            upcoming_items = []
        for item in upcoming_items:
            item_year = jikan_sync.jikan_year(item)
            if item_year == year or (include_tba and item_year is None):
                add_item(item, "upcoming", season_for_item(item))

    print(f"[INFO] Leyendo AniList {year} como respaldo")
    for item in jikan_sync.fetch_anilist_year(year):
        add_item(item, f"anilist/{year}", season_for_item(item))

    return by_id, meta_by_id


def enrich_titles(records: List[Dict[str, Any]], args: argparse.Namespace) -> None:
    cache = load_json(args.title_cache, {})
    if not isinstance(cache, dict):
        cache = {}

    title_args = argparse.Namespace(
        provider="google",
        source="auto",
        delay=args.translate_delay,
        timeout=args.timeout,
        max_items=None,
        save_every=0,
        batch_size=args.title_batch_size,
        force=False,
        in_place=False,
        translate_aliases=False,
        alias_limit=3,
        prefer_manual_title=False,
        quiet=args.quiet,
    )

    for start in range(0, len(records), max(1, args.title_batch_size)):
        batch = records[start:start + max(1, args.title_batch_size)]
        title_es.prefetch_title_translations(batch, cache, title_args)
        for index, record in enumerate(batch, start=start):
            records[index] = title_es.enrich_anime(record, cache, title_args)
        save_json(args.title_cache, cache)


def enrich_descriptions(records: List[Dict[str, Any]], args: argparse.Namespace) -> int:
    cache = load_json(args.description_cache, {})
    if not isinstance(cache, dict):
        cache = {}

    translated = 0
    for record in records:
        if not clean_text(record.get("description")) or clean_text(record.get("description_es")):
            continue
        if not args.quiet:
            print(f"[DESC] {record.get('title')}")
        record["description_es"] = desc_es.translate_text(
            record.get("description"),
            source_lang="en",
            cache=cache,
            timeout=args.timeout,
            retries=args.retries,
            delay=args.translate_delay,
        )
        translated += 1
        if translated % max(1, args.save_every) == 0:
            save_json(args.description_cache, cache)

    save_json(args.description_cache, cache)
    return translated


def clean_descriptions(records: List[Dict[str, Any]]) -> Tuple[int, int]:
    fields, anime_count, _samples = desc_cleaner.clean_data(records)
    return fields, anime_count


def build_sections(records: List[Dict[str, Any]]) -> Dict[str, List[int]]:
    sections: Dict[str, List[int]] = {"most_anticipated": []}
    for season in (*SEASONS, "unknown"):
        sections[season] = []

    ranked = sorted(records, key=ranking_key)
    sections["most_anticipated"] = [int(record["mal_id"]) for record in ranked if record.get("mal_id")]

    for season in (*SEASONS, "unknown"):
        season_records = [record for record in records if record.get("upcoming_season") == season]
        sections[season] = [int(record["mal_id"]) for record in sorted(season_records, key=ranking_key) if record.get("mal_id")]

    return sections


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera el upcoming completo desde Jikan; por defecto escribe anime-upcoming.full.json.")
    parser.add_argument("--year", type=int, default=2026, help="Año principal de estrenos.")
    parser.add_argument("--master", default=DEFAULT_MASTER, help="JSON maestro para reutilizar traducciones ya tratadas.")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="Archivo JSON de salida.")
    parser.add_argument("--include-tba", action="store_true", default=True, help="Incluye próximos sin año/fecha clara en Fecha indefinida.")
    parser.add_argument("--no-include-tba", dest="include_tba", action="store_false", help="No incluye próximos sin año claro.")
    parser.add_argument("--no-translate", action="store_true", help="No traduce títulos ni descripciones pendientes.")
    parser.add_argument("--anilist-only", action="store_true", help="Omite los listados de Jikan y genera el upcoming desde AniList.")
    parser.add_argument("--title-cache", default=title_es.DEFAULT_CACHE, help="Cache de títulos en español.")
    parser.add_argument("--description-cache", default=desc_es.DEFAULT_CACHE, help="Cache de descripciones en español.")
    parser.add_argument("--title-batch-size", type=int, default=20, help="Títulos por lote de traducción.")
    parser.add_argument("--translate-delay", type=float, default=0.55, help="Pausa entre peticiones de traducción.")
    parser.add_argument("--timeout", type=int, default=30, help="Timeout de red.")
    parser.add_argument("--retries", type=int, default=4, help="Reintentos para descripciones.")
    parser.add_argument("--save-every", type=int, default=20, help="Guarda caches cada N descripciones.")
    parser.add_argument("--quiet", action="store_true", help="Menos salida.")
    args = parser.parse_args()

    master_data = load_json(args.master, [])
    if not isinstance(master_data, list):
        raise ValueError(f"{args.master} debe contener una lista JSON.")
    master_by_id = {
        jikan_sync.safe_int(anime.get("mal_id")): anime
        for anime in master_data
        if isinstance(anime, dict) and jikan_sync.safe_int(anime.get("mal_id"))
    }

    by_id, meta_by_id = collect_jikan_items(args.year, args.include_tba, use_jikan=not args.anilist_only)
    records: List[Dict[str, Any]] = []
    for mal_id, item in by_id.items():
        meta = meta_by_id.get(mal_id, {})
        record = build_record(item, meta.get("season_hint"), meta.get("sources", []))
        record = merge_local_fields(record, master_by_id.get(mal_id))
        records.append(record)

    records.sort(key=ranking_key)

    if not args.no_translate:
        enrich_titles(records, args)
        translated_descriptions = enrich_descriptions(records, args)
    else:
        translated_descriptions = 0

    cleaned_fields, cleaned_anime = clean_descriptions(records)
    records.sort(key=ranking_key)
    sections = build_sections(records)

    payload = {
        "meta": {
            "generated_at": iso_now(),
            "source": "AniList API" if args.anilist_only else "Jikan API + AniList API",
            "year": args.year,
            "include_tba": args.include_tba,
            "sort": "Más esperados: members desc, favorites desc, popularity asc mediante anticipation_score",
            "total": len(records),
            "translated_descriptions": translated_descriptions,
            "cleaned_description_fields": cleaned_fields,
        },
        "section_order": ["most_anticipated", "winter", "spring", "summer", "fall", "unknown"],
        "section_labels": {
            "most_anticipated": "Más esperados",
            "winter": f"{SEASON_LABELS['winter']} {args.year}",
            "spring": f"{SEASON_LABELS['spring']} {args.year}",
            "summer": f"{SEASON_LABELS['summer']} {args.year}",
            "fall": f"{SEASON_LABELS['fall']} {args.year}",
            "unknown": "Fecha indefinida",
        },
        "sections": sections,
        "items": records,
    }

    backup = make_backup(args.output)
    save_json(args.output, payload)

    print("")
    print(f"Archivo generado: {args.output}")
    if backup:
        print(f"Backup anterior: {backup}")
    print(f"Total items: {len(records)}")
    for section_id in payload["section_order"]:
        print(f"- {payload['section_labels'][section_id]}: {len(sections.get(section_id, []))}")
    print(f"Descripciones traducidas ahora: {translated_descriptions}")
    print(f"Campos de descripcion limpiados: {cleaned_fields} en {cleaned_anime} animes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
