#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import datetime as dt
import json
import os
import shutil
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


DEFAULT_INPUT = "anime-upcoming.full.json"
DEFAULT_OUTPUT = "anime-upcoming.json"
SECTION_ORDER = ["winter", "spring", "summer", "fall"]
SEASON_LABELS = {
    "winter": "Invierno",
    "spring": "Primavera",
    "summer": "Verano",
    "fall": "Otoño",
}
ADULT_MARKERS = ("hentai", "rx - hentai")


def load_json(path: str) -> Any:
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
    backup_path = os.path.join("backups", f"{base}.backup-before-curated.{stamp}.json")
    shutil.copy2(path, backup_path)
    return backup_path


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def numeric(value: Any, default: float = 0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def safe_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def real_upcoming_year(record: Dict[str, Any]) -> Optional[int]:
    explicit = safe_int(record.get("upcoming_year"))
    if explicit > 0:
        return explicit
    aired_from = clean_text(record.get("aired_from"))
    if len(aired_from) >= 4 and aired_from[:4].isdigit():
        return int(aired_from[:4])
    return None


def is_adult(record: Dict[str, Any]) -> bool:
    values: List[str] = []
    for field in ("genres", "themes", "source_tags_original"):
        raw = record.get(field)
        if isinstance(raw, list):
            values.extend(clean_text(item).casefold() for item in raw)
        else:
            values.append(clean_text(raw).casefold())
    return any(marker in value for value in values for marker in ADULT_MARKERS)


def sort_key(record: Dict[str, Any]) -> Tuple[float, float, float, str]:
    return (
        -numeric(record.get("anticipation_score")),
        -numeric(record.get("members")),
        numeric(record.get("mal_popularity"), 999999),
        clean_text(record.get("title")).casefold(),
    )


def unique_existing_ids(ids: Iterable[Any], allowed: Set[int], limit: int) -> List[int]:
    if limit <= 0:
        return []
    output: List[int] = []
    seen: Set[int] = set()
    for value in ids:
        try:
            anime_id = int(value)
        except (TypeError, ValueError):
            continue
        if anime_id not in allowed or anime_id in seen:
            continue
        output.append(anime_id)
        seen.add(anime_id)
        if len(output) >= limit:
            break
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera una version curada de anime-upcoming.json para la web.")
    parser.add_argument("--input", default=DEFAULT_INPUT, help="Upcoming completo de entrada.")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="Upcoming curado de salida.")
    parser.add_argument("--master", default="anime-lista.json", help="Maestro actualizado para excluir animes ya estrenados.")
    parser.add_argument("--top", type=int, default=20, help="Reservado por compatibilidad; ya no se muestra un bloque global.")
    parser.add_argument("--season", type=int, default=10, help="Cantidad por temporada.")
    parser.add_argument("--unknown", type=int, default=10, help="Cantidad para Fecha indefinida.")
    parser.add_argument("--extra-year-input", action="append", default=[], help="Upcoming completo extra para añadir como 'Mas esperados YYYY'.")
    parser.add_argument("--extra-year-top", type=int, default=10, help="Cantidad por cada año extra.")
    parser.add_argument("--include-adult", action="store_true", help="No filtra contenido adulto.")
    parser.add_argument("--no-backup", action="store_true", help="No crea backup del archivo de salida.")
    args = parser.parse_args()

    payload = load_json(args.input)
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise ValueError(f"{args.input} debe ser un objeto con items.")

    all_items = payload["items"]
    master_status: Dict[int, Dict[str, Any]] = {}
    if args.master and os.path.exists(args.master):
        master_payload = load_json(args.master)
        if isinstance(master_payload, list):
            master_status = {
                safe_int(item.get("mal_id")): item
                for item in master_payload
                if isinstance(item, dict) and safe_int(item.get("mal_id")) > 0
            }

    def is_still_upcoming(record: Dict[str, Any]) -> bool:
        current = master_status.get(safe_int(record.get("mal_id")))
        status = clean_text((current or {}).get("airing_status")).casefold()
        record_status = clean_text(record.get("airing_status")).casefold()
        if current and (current.get("ongoing") or status in {"currently airing", "finished airing", "cancelled"}):
            return False
        if record_status in {"currently airing", "finished airing", "cancelled"}:
            return False
        aired_from = clean_text(record.get("aired_from"))[:10]
        try:
            premiere = dt.date.fromisoformat(aired_from)
        except ValueError:
            premiere = None
        if premiere and premiere <= dt.date.today() and status != "not yet aired":
            return False
        return True

    def merge_current_master_data(record: Dict[str, Any]) -> Dict[str, Any]:
        current = master_status.get(safe_int(record.get("mal_id")))
        if not current:
            return dict(record)
        merged = dict(record)
        for field in (
            "ongoing",
            "airing_status",
            "aired_from",
            "aired_to",
            "episodes",
            "broadcast_day",
            "broadcast_time",
            "broadcast_timezone",
            "broadcast_string",
        ):
            value = current.get(field)
            if value not in (None, ""):
                merged[field] = value
        return merged

    current_items = [merge_current_master_data(item) for item in all_items if isinstance(item, dict)]
    filtered_items = [
        item for item in current_items
        if item.get("mal_id")
        and is_still_upcoming(item)
        and (args.include_adult or not is_adult(item))
    ]
    items_by_id = {int(item["mal_id"]): item for item in filtered_items}
    allowed_ids = set(items_by_id)

    main_year = safe_int((payload.get("meta") or {}).get("year"))

    def current_season(record: Dict[str, Any]) -> str:
        aired_from = clean_text(record.get("aired_from"))[:10]
        try:
            premiere = dt.date.fromisoformat(aired_from)
        except ValueError:
            premiere = None
        if premiere and (not main_year or premiere.year == main_year):
            if premiere.month <= 3:
                return "winter"
            if premiere.month <= 6:
                return "spring"
            if premiere.month <= 9:
                return "summer"
            return "fall"
        if real_upcoming_year(record) == main_year:
            fallback = clean_text(record.get("upcoming_season")).casefold()
            if fallback in SECTION_ORDER:
                return fallback
        return ""

    source_sections = payload.get("sections") if isinstance(payload.get("sections"), dict) else {}
    curated_sections: Dict[str, List[int]] = {}

    for item in filtered_items:
        season_id = current_season(item)
        if season_id:
            item["upcoming_season"] = season_id
            item["upcoming_season_label"] = SEASON_LABELS[season_id]

    for section_id in ("winter", "spring", "summer", "fall"):
        season_end_month = {"winter": 3, "spring": 6, "summer": 9, "fall": 12}[section_id]
        season_limit = 0 if dt.date.today().month > season_end_month else args.season
        season_candidates = [item for item in filtered_items if current_season(item) == section_id]
        season_candidates.sort(key=sort_key)
        curated_sections[section_id] = unique_existing_ids(
            [item.get("mal_id") for item in season_candidates],
            allowed_ids,
            season_limit,
        )

    section_order = list(SECTION_ORDER)
    section_labels = dict(payload.get("section_labels") or {})
    section_labels["unknown"] = "Confirmados sin fecha de estreno"

    selected_ids: Set[int] = set()
    for section_id in section_order:
        selected_ids.update(curated_sections.get(section_id, []))

    for extra_input in args.extra_year_input:
        extra_payload = load_json(extra_input)
        if not isinstance(extra_payload, dict) or not isinstance(extra_payload.get("items"), list):
            raise ValueError(f"{extra_input} debe ser un objeto con items.")
        extra_year = safe_int((extra_payload.get("meta") or {}).get("year"))
        if extra_year <= 0:
            raise ValueError(f"{extra_input} no tiene meta.year valido.")

        extra_items = [
            item for item in extra_payload["items"]
            if isinstance(item, dict)
            and item.get("mal_id")
            and real_upcoming_year(item) == extra_year
            and int(item["mal_id"]) not in selected_ids
            and (args.include_adult or not is_adult(item))
        ]
        extra_items.sort(key=sort_key)
        section_id = f"most_anticipated_{extra_year}"
        section_ids = unique_existing_ids(
            [item.get("mal_id") for item in extra_items],
            {int(item["mal_id"]) for item in extra_items},
            args.extra_year_top,
        )
        if not section_ids:
            continue
        curated_sections[section_id] = section_ids
        section_order.append(section_id)
        section_labels[section_id] = f"Más esperados {extra_year}"
        for item in extra_items:
            anime_id = int(item["mal_id"])
            if anime_id not in items_by_id:
                items_by_id[anime_id] = item
        selected_ids.update(section_ids)

    unknown_source_ids = [
        anime_id for anime_id in source_sections.get("unknown", [])
        if safe_int(anime_id) not in selected_ids
    ]
    curated_sections["unknown"] = unique_existing_ids(
        unknown_source_ids,
        allowed_ids,
        args.unknown,
    )
    if curated_sections["unknown"]:
        section_order.append("unknown")
        selected_ids.update(curated_sections["unknown"])

    selected_items = [items_by_id[anime_id] for anime_id in sorted(selected_ids, key=lambda anime_id: sort_key(items_by_id[anime_id]))]

    output = {
        "meta": {
            **(payload.get("meta") or {}),
            "curated": True,
            "curated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
            "source_total": len(all_items),
            "source_after_filter": len(filtered_items),
            "total": len(selected_items),
            "limits": {
                "most_anticipated": args.top,
                "season": args.season,
                "unknown": args.unknown,
                "extra_year": args.extra_year_top,
            },
            "adult_filtered": not args.include_adult,
        },
        "section_order": section_order,
        "section_labels": section_labels,
        "sections": curated_sections,
        "items": selected_items,
    }

    backup = None
    if os.path.exists(args.output) and not args.no_backup:
        backup = make_backup(args.output)
    save_json(args.output, output)

    print(f"Archivo curado: {args.output}")
    if backup:
        print(f"Backup anterior: {backup}")
    print(f"Items visibles unicos: {len(selected_items)}")
    for section_id in section_order:
        label = output["section_labels"].get(section_id, section_id)
        print(f"- {label}: {len(curated_sections.get(section_id, []))}")
    print(f"Fuente completa: {len(all_items)}")
    print(f"Tras filtro adulto: {len(filtered_items)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
