#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import datetime as dt
import json
import os
import re
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional


DEFAULT_INPUT = "anime-lista.json"
DEFAULT_OUTPUT = "anime-lista.descripciones-es.json"
DEFAULT_CACHE = "cache/description-es-cache.json"
TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single"
MAX_CHARS_PER_CHUNK = 3600


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


def make_backup(path: str) -> str:
    os.makedirs("backups", exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    base = os.path.basename(os.path.splitext(path)[0])
    backup_path = os.path.join("backups", f"{base}.backup-before-desc-translate.{stamp}.json")
    shutil.copy2(path, backup_path)
    return backup_path


def clean_text(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text


def is_missing(value: Any) -> bool:
    return not isinstance(value, str) or not value.strip()


def split_for_translate(text: str, max_chars: int) -> List[str]:
    text = str(text or "").strip()
    if len(text) <= max_chars:
        return [text] if text else []

    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: List[str] = []
    current = ""

    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
        if len(sentence) > max_chars:
            if current:
                chunks.append(current.strip())
                current = ""
            for start in range(0, len(sentence), max_chars):
                chunks.append(sentence[start:start + max_chars].strip())
            continue
        candidate = f"{current} {sentence}".strip()
        if len(candidate) > max_chars and current:
            chunks.append(current.strip())
            current = sentence
        else:
            current = candidate

    if current:
        chunks.append(current.strip())
    return chunks


def translate_chunk(text: str, source_lang: str, timeout: int) -> str:
    params = urllib.parse.urlencode({
        "client": "gtx",
        "sl": source_lang or "auto",
        "tl": "es",
        "dt": "t",
        "q": text,
    })
    request = urllib.request.Request(
        f"{TRANSLATE_URL}?{params}",
        headers={
            "User-Agent": "NeoAnimeZ-DescriptionTranslator/1.0",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return "".join(part[0] for part in payload[0] if part and part[0]).strip()


def translate_text(
    text: str,
    *,
    source_lang: str,
    cache: Dict[str, str],
    timeout: int,
    retries: int,
    delay: float,
) -> str:
    text = str(text or "").strip()
    if not text:
        return ""

    cache_key = f"{source_lang}:{text}"
    if cache_key in cache:
        cached = clean_text(cache[cache_key])
        if cached:
            return cached

    translated_chunks: List[str] = []
    for chunk in split_for_translate(text, MAX_CHARS_PER_CHUNK):
        chunk_key = f"{source_lang}:{chunk}"
        if chunk_key in cache:
            cached_chunk = clean_text(cache[chunk_key])
            if cached_chunk:
                translated_chunks.append(cached_chunk)
                continue

        last_error: Optional[BaseException] = None
        for attempt in range(1, retries + 1):
            try:
                translated = translate_chunk(chunk, source_lang, timeout)
                cache[chunk_key] = translated or chunk
                translated_chunks.append(cache[chunk_key])
                break
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as error:
                last_error = error
                wait = min(20, delay * attempt + 0.4)
                print(f"[WARN] Error traduciendo fragmento. Reintento {attempt}/{retries} en {wait:.1f}s: {error}")
                time.sleep(wait)
        else:
            raise RuntimeError(f"No se pudo traducir un fragmento: {last_error}")

        time.sleep(delay)

    translated_text = " ".join(part.strip() for part in translated_chunks if part.strip()).strip()
    cache[cache_key] = translated_text or text
    return cache[cache_key]


def main() -> int:
    parser = argparse.ArgumentParser(description="Rellena description_es traduciendo solo descripciones pendientes.")
    parser.add_argument("--input", default=DEFAULT_INPUT, help="JSON maestro de entrada.")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="JSON de salida si no usas --in-place.")
    parser.add_argument("--cache", default=DEFAULT_CACHE, help="Archivo de cache de traducciones.")
    parser.add_argument("--in-place", action="store_true", help="Guarda sobre el archivo de entrada.")
    parser.add_argument("--force", action="store_true", help="Retraduce aunque description_es ya exista.")
    parser.add_argument("--limit", type=int, default=None, help="Limita cuantas descripciones se traducen.")
    parser.add_argument("--source-lang", default="en", help="Idioma origen para Google Translate.")
    parser.add_argument("--timeout", type=int, default=30, help="Timeout de red por peticion.")
    parser.add_argument("--retries", type=int, default=4, help="Reintentos por fragmento.")
    parser.add_argument("--delay", type=float, default=0.75, help="Pausa entre llamadas a Google Translate.")
    parser.add_argument("--save-every", type=int, default=20, help="Guarda progreso cada N traducciones.")
    parser.add_argument("--quiet", action="store_true", help="Muestra menos salida.")
    args = parser.parse_args()

    data = load_json(args.input)
    if not isinstance(data, list):
        raise ValueError(f"{args.input} debe contener una lista de animes.")

    output_path = args.input if args.in_place else args.output
    cache = load_json(args.cache, {})
    if not isinstance(cache, dict):
        cache = {}

    pending = [
        anime for anime in data
        if isinstance(anime, dict)
        and clean_text(anime.get("description"))
        and (args.force or is_missing(anime.get("description_es")))
    ]
    if args.limit is not None:
        pending = pending[: args.limit]

    print(f"Animes revisados: {len(data)}")
    print(f"Descripciones pendientes: {len(pending)}")

    if not pending:
        print("Nada que traducir.")
        return 0

    backup_path = None
    if args.in_place:
        backup_path = make_backup(args.input)

    translated_count = 0
    for index, anime in enumerate(pending, start=1):
        title = clean_text(anime.get("title")) or str(anime.get("mal_id") or index)
        if not args.quiet:
            print(f"[{index}/{len(pending)}] {title}")

        anime["description_es"] = translate_text(
            anime.get("description"),
            source_lang=args.source_lang,
            cache=cache,
            timeout=args.timeout,
            retries=args.retries,
            delay=args.delay,
        )
        translated_count += 1

        if translated_count % max(1, args.save_every) == 0:
            save_json(args.cache, cache)
            save_json(output_path, data)
            if not args.quiet:
                print(f"[INFO] Progreso guardado: {translated_count}")

    save_json(args.cache, cache)
    save_json(output_path, data)

    if backup_path:
        print(f"Backup: {backup_path}")
    print(f"Guardado: {output_path}")
    print(f"Descripciones traducidas: {translated_count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
