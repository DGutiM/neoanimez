#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import datetime as dt
import json
import os
import re
import shutil
from typing import Any, Dict, List, Tuple


DEFAULT_JSON = "anime-lista.json"
DESCRIPTION_FIELDS = ("description", "description_es")

TRAILING_CREDIT_PATTERNS = [
    re.compile(r"\s*\[(?:Writ+en|Escrito)\s+(?:by|por)\s+MAL Rewrite\]\s*$", re.IGNORECASE),
    re.compile(r"\s*\((?:Writ+en|Escrito)\s+(?:by|por)\s+MAL Rewrite\)\s*$", re.IGNORECASE),
    re.compile(r"\s*(?:-|--|—|–)\s*(?:Writ+en|Escrito)\s+(?:by|por)\s+MAL Rewrite\s*$", re.IGNORECASE),
    re.compile(r"\s*(?:Writ+en|Escrito)\s+(?:by|por)\s+MAL Rewrite\s*$", re.IGNORECASE),
    re.compile(r"\s*\[(?:Source|Fuente):?\s*[^\]\n]+?\]\s*$", re.IGNORECASE),
    re.compile(r"\s*\((?:Source|Fuente):?\s*[^)\n]+?\)\s*$", re.IGNORECASE),
    re.compile(r"\s+(?:Source|Fuente):\s*[^\n]+\s*$", re.IGNORECASE),
]

STANDALONE_CREDIT_PATTERNS = [
    re.compile(r"\n+\s*\[(?:Writ+en|Escrito)\s+(?:by|por)\s+MAL Rewrite\]\s*\n+", re.IGNORECASE),
    re.compile(r"\n+\s*\((?:Writ+en|Escrito)\s+(?:by|por)\s+MAL Rewrite\)\s*\n+", re.IGNORECASE),
    re.compile(r"\n+\s*\[(?:Source|Fuente):?\s*[^\]\n]+?\]\s*\n+", re.IGNORECASE),
    re.compile(r"\n+\s*\((?:Source|Fuente):?\s*[^)\n]+?\)\s*\n+", re.IGNORECASE),
]

INLINE_CREDIT_PATTERNS = [
    re.compile(r"\s*\[(?:Writ+en|Escrito)\s+(?:by|por)\s+MAL Rewrite\]\s*", re.IGNORECASE),
    re.compile(r"\s*\((?:Writ+en|Escrito)\s+(?:by|por)\s+MAL Rewrite\)\s*", re.IGNORECASE),
    re.compile(r"\s*\[(?:Source|Fuente):?\s*[^\]\n]+?\]\s*", re.IGNORECASE),
    re.compile(r"\s*\((?:Source|Fuente):?\s*[^)\n]+?\)\s*", re.IGNORECASE),
]


def load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data


def anime_items_from_payload(data: Any, path: str) -> List[Dict[str, Any]]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and isinstance(data.get("items"), list):
        return data["items"]
    raise ValueError(f"{path} no contiene una lista JSON ni un objeto con items.")


def save_json(path: str, data: Any) -> None:
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.replace(tmp_path, path)


def clean_description(text: Any) -> Tuple[str, bool]:
    if not isinstance(text, str) or not text.strip():
        return text, False

    original = text
    cleaned = text.strip()

    for pattern in STANDALONE_CREDIT_PATTERNS:
        cleaned = pattern.sub("\n\n", cleaned).strip()

    for pattern in INLINE_CREDIT_PATTERNS:
        cleaned = pattern.sub(" ", cleaned).strip()

    changed = True

    while changed:
        changed = False
        for pattern in TRAILING_CREDIT_PATTERNS:
            next_cleaned = pattern.sub("", cleaned).strip()
            if next_cleaned != cleaned:
                cleaned = next_cleaned
                changed = True

    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()

    return cleaned, cleaned != original


def clean_data(data: List[Dict[str, Any]]) -> Tuple[int, int, List[Dict[str, Any]]]:
    changed_fields = 0
    changed_anime_ids = set()
    samples = []

    for anime in data:
        anime_changed = False
        for field in DESCRIPTION_FIELDS:
            before = anime.get(field)
            after, changed = clean_description(before)
            if not changed:
                continue

            anime[field] = after
            changed_fields += 1
            anime_changed = True

            if len(samples) < 12:
                samples.append({
                    "mal_id": anime.get("mal_id"),
                    "title": anime.get("title"),
                    "field": field,
                    "before_end": str(before)[-120:],
                    "after_end": str(after)[-120:],
                })

        if anime_changed:
            changed_anime_ids.add(anime.get("mal_id") or anime.get("title"))

    return changed_fields, len(changed_anime_ids), samples


def make_backup(path: str) -> str:
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    os.makedirs("backups", exist_ok=True)
    base = os.path.basename(os.path.splitext(path)[0])
    backup_path = os.path.join("backups", f"{base}.backup-before-desc-clean.{stamp}.json")
    shutil.copy2(path, backup_path)
    return backup_path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Limpia creditos finales tipo [Written by MAL Rewrite] de anime-lista.json."
    )
    parser.add_argument("--input", default=DEFAULT_JSON, help="Ruta del JSON de entrada.")
    parser.add_argument("--output", default=None, help="Ruta de salida. Si no se indica, se usa el mismo archivo.")
    parser.add_argument("--apply", action="store_true", help="Aplica los cambios. Sin esto solo simula.")
    parser.add_argument("--no-backup", action="store_true", help="No crea copia de seguridad al aplicar sobre el mismo archivo.")
    args = parser.parse_args()

    output = args.output or args.input
    data = load_json(args.input)
    anime_items = anime_items_from_payload(data, args.input)
    changed_fields, changed_anime, samples = clean_data(anime_items)

    print(f"Animes revisados: {len(anime_items)}")
    print(f"Animes afectados: {changed_anime}")
    print(f"Campos limpiados: {changed_fields}")

    if samples:
        print("\nEjemplos:")
        for sample in samples[:6]:
            print(f"- {sample['title']} ({sample['field']})")
            print(f"  Antes: {sample['before_end']}")
            print(f"  Despues: {sample['after_end']}")

    if not args.apply:
        print("\nSimulacion terminada. Ejecuta con --apply para guardar cambios.")
        return

    backup_path = None
    if output == args.input and not args.no_backup:
        backup_path = make_backup(args.input)

    save_json(output, data)
    if backup_path:
        print(f"\nCopia de seguridad: {backup_path}")
    print(f"JSON guardado: {output}")


if __name__ == "__main__":
    main()
