#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import os
import random
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Iterable, List, Optional, Tuple


DEFAULT_INPUT = "anime-lista.json"
DEFAULT_OUTPUT = "anime-lista.titulos-es.json"
DEFAULT_CACHE = "cache/title-es-cache.json"
TRANSLATE_URL = "https://translate.googleapis.com/translate_a/single"

# Pequena capa manual para titulos muy conocidos. Esto mejora busquedas reales
# sin convertir el titulo visible de la web en un titulo "oficial".
MANUAL_SPANISH_ALIASES = {
    "shingeki no kyojin": ["Ataque a los Titanes"],
    "attack on titan": ["Ataque a los Titanes"],
    "kimetsu no yaiba": ["Guardianes de la noche", "Demon Slayer", "Cazador de demonios"],
    "demon slayer": ["Guardianes de la noche", "Cazador de demonios"],
    "sen to chihiro no kamikakushi": ["El viaje de Chihiro"],
    "spirited away": ["El viaje de Chihiro"],
    "mononoke hime": ["La princesa Mononoke"],
    "princess mononoke": ["La princesa Mononoke"],
    "howl no ugoku shiro": ["El castillo ambulante"],
    "howl's moving castle": ["El castillo ambulante"],
    "kimi no na wa.": ["Your Name", "Tu nombre"],
    "your name.": ["Your Name", "Tu nombre"],
    "tenki no ko": ["El tiempo contigo"],
    "weathering with you": ["El tiempo contigo"],
    "suzume no tojimari": ["Suzume"],
    "boku no hero academia": ["My Hero Academia"],
    "my hero academia": ["My Hero Academia"],
    "kusuriya no hitorigoto": ["Los diarios de la boticaria"],
    "the apothecary diaries": ["Los diarios de la boticaria"],
    "dungeon meshi": ["Tragones y mazmorras", "Delicious in Dungeon"],
    "delicious in dungeon": ["Tragones y mazmorras"],
    "sousou no frieren": ["Frieren", "Frieren: Tras finalizar el viaje"],
    "frieren: beyond journey's end": ["Frieren", "Frieren: Tras finalizar el viaje"],
    "hagane no renkinjutsushi": ["Fullmetal Alchemist", "El alquimista de acero"],
    "fullmetal alchemist": ["Fullmetal Alchemist", "El alquimista de acero"],
    "neon genesis evangelion": ["Evangelion", "Neon Genesis Evangelion"],
    "kiseijuu: sei no kakuritsu": ["Parasyte"],
    "parasyte -the maxim-": ["Parasyte"],
    "koe no katachi": ["A Silent Voice", "Una voz silenciosa"],
    "a silent voice": ["Una voz silenciosa"],
    "violet evergarden": ["Violet Evergarden"],
    "yakusoku no neverland": ["The Promised Neverland"],
    "the promised neverland": ["The Promised Neverland"],
}


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


def normalize_loose(value: Any) -> str:
    text = str(value or "").strip()
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.lower()
    text = re.sub(r"[^\w\s]+", " ", text, flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def has_cjk(text: str) -> bool:
    return any(
        "\u3040" <= ch <= "\u30ff" or "\u3400" <= ch <= "\u9fff"
        for ch in text
    )


def clean_title(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text


def unique_titles(values: Iterable[Any]) -> List[str]:
    seen = set()
    output = []
    for value in values:
        text = clean_title(value)
        key = normalize_loose(text) or text
        if not text or not key or key in seen:
            continue
        seen.add(key)
        output.append(text)
    return output


def manual_aliases_for(anime: Dict[str, Any]) -> List[str]:
    manual_lookup = {
        normalize_loose(key): value
        for key, value in MANUAL_SPANISH_ALIASES.items()
    }
    candidates = [
        anime.get("title"),
        anime.get("title_english"),
        anime.get("franchise"),
        *(anime.get("title_synonyms") or []),
        *(anime.get("search_titles") or []),
    ]
    found = []
    for candidate in candidates:
        key = normalize_loose(candidate)
        if key in manual_lookup:
            found.extend(manual_lookup[key])
    return unique_titles(found)


def choose_translation_source(anime: Dict[str, Any], preferred: str) -> Tuple[str, str, str]:
    fields = {
        "title_english": clean_title(anime.get("title_english")),
        "title": clean_title(anime.get("title")),
        "title_japanese": clean_title(anime.get("title_japanese")),
    }

    if preferred != "auto":
        text = fields.get(preferred, "")
        if text:
            return preferred, text, source_lang_for(preferred, text)

    for field in ("title_english", "title", "title_japanese"):
        text = fields[field]
        if text:
            return field, text, source_lang_for(field, text)

    return "none", "", "auto"


def source_lang_for(field: str, text: str) -> str:
    if field == "title_english":
        return "en"
    if field == "title_japanese" and has_cjk(text):
        return "ja"
    return "auto"


def translate_google_gtx(text: str, source_lang: str, timeout: int) -> str:
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
            "User-Agent": "NeoAnimeZ-TitleEnricher/1.0",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return clean_title("".join(part[0] for part in payload[0] if part and part[0]))


def translate_many_google_gtx(texts: List[str], source_lang: str, timeout: int) -> List[str]:
    texts = [clean_title(text) for text in texts]
    if not texts:
        return []
    if len(texts) == 1:
        return [translate_google_gtx(texts[0], source_lang, timeout)]

    separator = "__NEOANIMEZ_SPLIT_8F3A__"
    joined = f"\n{separator}\n".join(texts)
    translated = translate_google_gtx(joined, source_lang, timeout)
    parts = [
        clean_title(part)
        for part in re.split(rf"\s*{re.escape(separator)}\s*", translated, flags=re.IGNORECASE)
    ]
    parts = [part for part in parts if part]

    if len(parts) != len(texts):
        return [translate_google_gtx(text, source_lang, timeout) for text in texts]
    return parts


def translate_with_cache(
    text: str,
    source_lang: str,
    cache: Dict[str, str],
    *,
    provider: str,
    timeout: int,
    force: bool,
) -> str:
    text = clean_title(text)
    if not text:
        return ""

    cache_key = f"{provider}:{source_lang}:{text}"
    if not force and cache_key in cache:
        cached = clean_title(cache[cache_key])
        if cached:
            return cached

    if provider == "offline":
        return text

    translated = translate_google_gtx(text, source_lang, timeout)
    cache[cache_key] = translated or text
    return cache[cache_key]


def prefetch_title_translations(
    anime_batch: List[Dict[str, Any]],
    cache: Dict[str, str],
    args: argparse.Namespace,
) -> None:
    if args.provider != "google" or args.batch_size <= 1:
        return

    grouped: Dict[str, List[str]] = {}
    seen = set()
    for anime in anime_batch:
        if not args.force and clean_title(anime.get("title_es")):
            continue
        if args.prefer_manual_title and manual_aliases_for(anime):
            continue

        source_field, source_text, source_lang = choose_translation_source(anime, args.source)
        if not source_text or source_field == "none":
            continue

        cache_key = f"{args.provider}:{source_lang}:{source_text}"
        if not args.force and clean_title(cache.get(cache_key)):
            continue
        if cache_key in seen:
            continue
        seen.add(cache_key)
        grouped.setdefault(source_lang, []).append(source_text)

    for source_lang, texts in grouped.items():
        for start in range(0, len(texts), args.batch_size):
            chunk = texts[start:start + args.batch_size]
            try:
                translated = translate_many_google_gtx(chunk, source_lang, args.timeout)
                for source_text, translated_text in zip(chunk, translated):
                    cache[f"{args.provider}:{source_lang}:{source_text}"] = translated_text or source_text
            except Exception as exc:
                if not args.quiet:
                    print(f"[WARN] No se pudo traducir lote {source_lang} ({len(chunk)} titulos): {exc}")

            if args.delay > 0:
                time.sleep(args.delay + random.uniform(0, 0.08))


def alias_sources_for_translation(anime: Dict[str, Any], limit: int) -> List[Tuple[str, str, str]]:
    raw_sources = [
        ("title_english", clean_title(anime.get("title_english"))),
        ("title", clean_title(anime.get("title"))),
        *[("title_synonyms", clean_title(v)) for v in (anime.get("title_synonyms") or [])],
    ]
    selected = []
    seen = set()
    for field, text in raw_sources:
        key = normalize_loose(text)
        if not text or key in seen:
            continue
        seen.add(key)
        selected.append((field, text, source_lang_for(field, text)))
        if len(selected) >= limit:
            break
    return selected


def enrich_anime(
    anime: Dict[str, Any],
    cache: Dict[str, str],
    args: argparse.Namespace,
) -> Dict[str, Any]:
    anime = dict(anime)
    manual_aliases = manual_aliases_for(anime)
    source_field, source_text, source_lang = choose_translation_source(anime, args.source)

    existing_title_es = clean_title(anime.get("title_es"))
    translated_title = existing_title_es
    status = "kept"

    if args.force or not translated_title:
        if manual_aliases and args.prefer_manual_title:
            translated_title = manual_aliases[0]
            status = "manual"
        elif source_text:
            try:
                translated_title = translate_with_cache(
                    source_text,
                    source_lang,
                    cache,
                    provider=args.provider,
                    timeout=args.timeout,
                    force=args.force,
                )
                status = "translated" if args.provider != "offline" else "offline"
            except Exception as exc:
                if not args.quiet:
                    print(f"[WARN] No se pudo traducir {source_text!r}: {exc}")
                translated_title = manual_aliases[0] if manual_aliases else source_text
                status = "fallback"

    previous_search_titles_es = anime.get("search_titles_es") or []
    translated_aliases = []
    should_translate_aliases = bool(
        args.translate_aliases
        and (args.force or not existing_title_es or not previous_search_titles_es)
    )
    if should_translate_aliases:
        for field, text, lang in alias_sources_for_translation(anime, args.alias_limit):
            try:
                translated_aliases.append(
                    translate_with_cache(
                        text,
                        lang,
                        cache,
                        provider=args.provider,
                        timeout=args.timeout,
                        force=args.force,
                    )
                )
            except Exception as exc:
                if not args.quiet:
                    print(f"[WARN] No se pudo traducir alias {text!r}: {exc}")

    anime["title_es"] = translated_title
    anime["title_es_reviewed"] = bool(anime.get("title_es_reviewed", False))
    anime["title_es_source"] = source_field
    anime["title_es_status"] = status
    anime["search_titles_es"] = unique_titles([
        *previous_search_titles_es,
        translated_title,
        *manual_aliases,
        *translated_aliases,
    ])
    return anime


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Añade title_es y search_titles_es a anime-lista.json sin tocar el archivo original por defecto."
    )
    parser.add_argument("--input", default=DEFAULT_INPUT, help="JSON de entrada")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="JSON de salida")
    parser.add_argument("--cache", default=DEFAULT_CACHE, help="Cache de traducciones")
    parser.add_argument("--provider", choices=["google", "offline"], default="google")
    parser.add_argument("--source", choices=["auto", "title_english", "title", "title_japanese"], default="auto")
    parser.add_argument("--delay", type=float, default=0.45, help="Pausa entre traducciones")
    parser.add_argument("--timeout", type=int, default=25, help="Timeout por petición")
    parser.add_argument("--max-items", type=int, default=None, help="Procesa solo N animes para probar")
    parser.add_argument("--save-every", type=int, default=50, help="Guarda progreso cada N animes")
    parser.add_argument("--batch-size", type=int, default=20, help="Titulos por petición de traducción")
    parser.add_argument("--force", action="store_true", help="Rehace title_es aunque ya exista")
    parser.add_argument("--in-place", action="store_true", help="Sobrescribe el archivo de entrada")
    parser.add_argument("--translate-aliases", action="store_true", help="También traduce algunos alias")
    parser.add_argument("--alias-limit", type=int, default=3, help="Máximo de alias traducidos por anime")
    parser.add_argument("--prefer-manual-title", action="store_true", help="Usa alias manual como title_es si existe")
    parser.add_argument("--quiet", action="store_true", help="Muestra solo progreso resumido")
    args = parser.parse_args()

    if args.in_place:
        args.output = args.input

    anime_list = load_json(args.input)
    if not isinstance(anime_list, list):
        print(f"[ERROR] El archivo {args.input} no contiene una lista de animes.")
        return 1

    cache = load_json(args.cache, default={})
    if not isinstance(cache, dict):
        cache = {}

    total = len(anime_list)
    process_count = min(total, args.max_items) if args.max_items else total
    output = list(anime_list)

    print(f"[INFO] Entrada: {args.input}")
    print(f"[INFO] Salida: {args.output}")
    print(f"[INFO] Procesando {process_count}/{total} animes")

    batch_size = max(1, args.batch_size)

    for batch_start in range(0, process_count, batch_size):
        batch_end = min(process_count, batch_start + batch_size)
        prefetch_title_translations(output[batch_start:batch_end], cache, args)

        for index in range(batch_start, batch_end):
            anime = output[index]
            title = anime.get("title") or f"anime #{index + 1}"
            if not args.quiet:
                print(f"[{index + 1}/{process_count}] {title}")
            output[index] = enrich_anime(anime, cache, args)

            if args.provider != "offline" and args.batch_size <= 1:
                time.sleep(args.delay + random.uniform(0, 0.12))

            if args.save_every and (index + 1) % args.save_every == 0:
                save_json(args.cache, cache)
                save_json(args.output, output)
                print(f"[INFO] Progreso guardado en {args.output}")

    save_json(args.cache, cache)
    save_json(args.output, output)
    print("[OK] Terminado")
    return 0


if __name__ == "__main__":
    sys.exit(main())
