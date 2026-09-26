#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import datetime as dt
import json
import os
import re
from typing import Any, Dict, Iterable, List


DEFAULT_INPUT = "anime-lista.json"
DEFAULT_INDEX = "anime-index.json"
DEFAULT_DETAILS_DIR = "anime-details"
DEFAULT_BLOCKS = 24
DEFAULT_PREVIEW_CHARS = 120

INDEX_FIELDS = [
    "title",
    "mal_id",
    "image",
    "episodes",
    "length",
    "demographic",
    "genres",
    "themes",
    "tone",
    "fast_start",
    "action_level",
    "emotional",
    "popular",
    "year",
    "type",
    "franchise",
    "ongoing",
    "score",
    "scored_by",
    "title_english",
    "title_japanese",
    "search_titles",
    "title_es",
    "search_titles_es",
]


def load_json(path: str) -> List[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError(f"{path} debe contener una lista de animes.")
    return data


def save_json(path: str, data: Any, pretty: bool = False) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        if pretty:
            json.dump(data, f, ensure_ascii=False, indent=2)
        else:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    os.replace(tmp_path, path)


def safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def block_name_for(mal_id: Any, block_count: int) -> str:
    block = safe_int(mal_id) % block_count
    return f"details-{block:02d}.json"


def clean_text(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text


def make_preview(value: Any, max_chars: int) -> str:
    text = clean_text(value)
    if len(text) <= max_chars:
        return text

    cut = text[: max_chars + 1]
    sentence_match = re.search(r"^(.{180,}?[.!?])\s", cut)
    if sentence_match:
        return sentence_match.group(1).strip()

    last_space = cut.rfind(" ")
    if last_space > 220:
        cut = cut[:last_space]
    else:
        cut = cut[:max_chars]
    return cut.rstrip(" ,.;:") + "..."


def compact_aliases(values: Any, base_values: Iterable[Any]) -> List[str]:
    if not isinstance(values, list):
        return []

    seen = {
        clean_text(value).casefold()
        for value in base_values
        if clean_text(value)
    }
    aliases: List[str] = []
    for value in values:
        text = clean_text(value)
        key = text.casefold()
        if not text or key in seen:
            continue
        seen.add(key)
        aliases.append(text)
    return aliases


def compact_index_item(anime: Dict[str, Any], block_count: int, preview_chars: int, details_dir: str) -> Dict[str, Any]:
    item = {field: anime[field] for field in INDEX_FIELDS if field in anime}
    search_titles = compact_aliases(
        anime.get("search_titles"),
        [
            anime.get("title"),
            anime.get("franchise"),
            anime.get("title_es"),
            anime.get("title_english"),
            anime.get("title_japanese"),
        ],
    )
    search_titles_es = compact_aliases(anime.get("search_titles_es"), [anime.get("title_es")])
    if search_titles:
        item["search_titles"] = search_titles
    else:
        item.pop("search_titles", None)
    if search_titles_es:
        item["search_titles_es"] = search_titles_es
    else:
        item.pop("search_titles_es", None)

    description_es = make_preview(anime.get("description_es"), preview_chars)
    description = make_preview(anime.get("description"), preview_chars)
    item["description_preview"] = description_es or description
    return item


def clean_generated_detail_files(details_dir: str) -> None:
    if not os.path.isdir(details_dir):
        return
    for filename in os.listdir(details_dir):
        if re.fullmatch(r"details-\d+\.json", filename):
            os.remove(os.path.join(details_dir, filename))


def group_details(data: Iterable[Dict[str, Any]], block_count: int) -> Dict[str, List[Dict[str, Any]]]:
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for anime in data:
        filename = block_name_for(anime.get("mal_id"), block_count)
        groups.setdefault(filename, []).append(anime)

    for items in groups.values():
        items.sort(key=lambda anime: safe_int(anime.get("mal_id")))
    return groups


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Genera anime-index.json y bloques anime-details desde anime-lista.json."
    )
    parser.add_argument("--input", default=DEFAULT_INPUT, help="JSON maestro de entrada.")
    parser.add_argument("--index", default=DEFAULT_INDEX, help="Archivo index ligero de salida.")
    parser.add_argument("--details-dir", default=DEFAULT_DETAILS_DIR, help="Carpeta de bloques de detalle.")
    parser.add_argument("--blocks", type=int, default=DEFAULT_BLOCKS, help="Numero de bloques de detalle.")
    parser.add_argument("--preview-chars", type=int, default=DEFAULT_PREVIEW_CHARS, help="Caracteres maximos de descripcion en el index.")
    parser.add_argument("--no-clean", action="store_true", help="No borra bloques generados anteriormente.")
    parser.add_argument("--pretty", action="store_true", help="Guarda JSON legible con indentacion. Por defecto se minifica para web.")
    args = parser.parse_args()

    if args.blocks < 2:
        raise ValueError("--blocks debe ser 2 o superior.")

    data = load_json(args.input)
    seen = set()
    duplicates = []
    for anime in data:
        mal_id = anime.get("mal_id")
        if mal_id in seen:
            duplicates.append(mal_id)
        seen.add(mal_id)

    if duplicates:
        raise ValueError(f"Hay mal_id duplicados: {duplicates[:10]}")

    if not args.no_clean:
        clean_generated_detail_files(args.details_dir)

    generated_at = dt.datetime.now(dt.timezone.utc).isoformat()
    index_items = [
        compact_index_item(anime, args.blocks, args.preview_chars, args.details_dir)
        for anime in data
    ]
    details_groups = group_details(data, args.blocks)

    save_json(args.index, index_items, pretty=args.pretty)

    total_details = 0
    for filename, items in sorted(details_groups.items()):
        total_details += len(items)
        save_json(
            os.path.join(args.details_dir, filename),
            {
                "generated_at": generated_at,
                "source": args.input,
                "count": len(items),
                "items": items,
            },
            pretty=args.pretty,
        )

    print(f"Animes maestro: {len(data)}")
    print(f"Index generado: {args.index} ({len(index_items)} animes)")
    print(f"Bloques generados: {len(details_groups)} en {args.details_dir}/")
    print(f"Animes en detalles: {total_details}")
    print(f"Bloques teoricos: {args.blocks}")
    print(f"Preview chars: {args.preview_chars}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
