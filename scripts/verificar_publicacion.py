#!/usr/bin/env python3
"""Comprueba que la carpeta local tiene lo necesario para publicar NeoAnimeZ."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPO_COPY = ROOT / "neoanimez-repo"

REQUIRED_ROOT_FILES = [
    "index.html",
    "assets/neoanimez.css",
    "assets/neoanimez.js",
    "service-worker.js",
    "manifest.json",
    "CNAME",
    "robots.txt",
    "sitemap.xml",
    "googleb2a25f85ee142dba.html",
    "logo.png",
    "icon.png",
    "preview.png",
    "anime-index.json",
    "anime-lista.json",
    "anime-upcoming.json",
    "anime-schedule.json",
    "anime-news.json",
    "anime-relations.json",
    "anime-timeline-index.json",
]

REQUIRED_JSON_FILES = [
    "manifest.json",
    "anime-index.json",
    "anime-lista.json",
    "anime-upcoming.json",
    "anime-schedule.json",
    "anime-news.json",
    "anime-relations.json",
    "anime-timeline-index.json",
]

REQUIRED_DIRS = {
    "anime-details": 24,
    "anime-timelines": 12,
}

DO_NOT_PUBLISH = [
    ".DS_Store",
    "cache",
    "backups",
    "archivo",
    "neoanimez-repo",
    "anime-upcoming.full.json",
    "anime-upcoming-2027.full.json",
    "anime-timelines.full.json",
]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def format_size(path: Path) -> str:
    size = path.stat().st_size
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.1f} {unit}" if unit != "B" else f"{size} B"
        size /= 1024
    return f"{size:.1f} GB"


def check_required_files(errors: list[str]) -> None:
    for rel in REQUIRED_ROOT_FILES:
        path = ROOT / rel
        if not path.is_file():
            errors.append(f"FALTA archivo obligatorio: {rel}")


def check_required_dirs(errors: list[str]) -> None:
    for dirname, expected_count in REQUIRED_DIRS.items():
        directory = ROOT / dirname
        if not directory.is_dir():
            errors.append(f"FALTA carpeta obligatoria: {dirname}/")
            continue
        json_files = sorted(directory.glob("*.json"))
        if len(json_files) != expected_count:
            errors.append(
                f"REVISA {dirname}/: esperaba {expected_count} JSON y hay {len(json_files)}"
            )


def check_json(errors: list[str]) -> None:
    for rel in REQUIRED_JSON_FILES:
        path = ROOT / rel
        if not path.is_file():
            continue
        try:
            with path.open(encoding="utf-8") as fh:
                json.load(fh)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"JSON invalido: {rel} ({exc})")


def catalog_ids(payload: object) -> set[int]:
    if not isinstance(payload, list):
        return set()
    return {
        int(item["mal_id"])
        for item in payload
        if isinstance(item, dict) and item.get("mal_id")
    }


def check_catalog_outputs(errors: list[str]) -> None:
    try:
        catalog = json.loads((ROOT / "anime-lista.json").read_text(encoding="utf-8"))
        index = json.loads((ROOT / "anime-index.json").read_text(encoding="utf-8"))
        master_ids = catalog_ids(catalog)
        index_ids = catalog_ids(index)
        if not master_ids or len(master_ids) != len(catalog):
            errors.append("anime-lista.json esta vacio o contiene mal_id duplicados.")
        if index_ids != master_ids:
            errors.append("anime-index.json no coincide con anime-lista.json.")

        detail_ids: set[int] = set()
        for path in sorted((ROOT / "anime-details").glob("*.json")):
            block = json.loads(path.read_text(encoding="utf-8"))
            detail_ids.update(catalog_ids(block.get("items") or []))
        if detail_ids != master_ids:
            errors.append("Los bloques anime-details no coinciden con el catalogo maestro.")

        missing_titles = [
            int(item.get("mal_id") or 0)
            for item in catalog
            if isinstance(item, dict) and not str(item.get("title_es") or "").strip()
        ]
        if missing_titles:
            errors.append(f"Faltan titulos en espanol: {missing_titles[:8]}")

        missing_descriptions = [
            int(item.get("mal_id") or 0)
            for item in catalog
            if isinstance(item, dict)
            and str(item.get("description") or "").strip()
            and not str(item.get("description_es") or "").strip()
        ]
        if missing_descriptions:
            errors.append(f"Faltan descripciones en espanol: {missing_descriptions[:8]}")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"No se pudo validar el catalogo dividido ({exc})")


def check_upcoming_and_schedule(errors: list[str]) -> None:
    try:
        catalog = json.loads((ROOT / "anime-lista.json").read_text(encoding="utf-8"))
        master_ids = catalog_ids(catalog)
        upcoming = json.loads((ROOT / "anime-upcoming.json").read_text(encoding="utf-8"))
        upcoming_items = upcoming.get("items") or []
        upcoming_ids = catalog_ids(upcoming_items)
        if not upcoming_ids:
            errors.append("anime-upcoming.json no contiene proximos estrenos.")
        if len(upcoming_ids) != len(upcoming_items):
            errors.append("anime-upcoming.json contiene ids duplicados o invalidos.")
        missing_upcoming = sorted(upcoming_ids - master_ids)
        if missing_upcoming:
            errors.append(f"Proximos estrenos fuera del catalogo: {missing_upcoming[:8]}")
        section_ids = {
            int(anime_id)
            for values in (upcoming.get("sections") or {}).values()
            for anime_id in (values or [])
        }
        if section_ids != upcoming_ids:
            errors.append("Las secciones de anime-upcoming.json no coinciden con sus fichas.")

        schedule = json.loads((ROOT / "anime-schedule.json").read_text(encoding="utf-8"))
        schedule_items = [
            item
            for values in (schedule.get("days") or {}).values()
            for item in (values or [])
            if isinstance(item, dict)
        ]
        schedule_ids = catalog_ids(schedule_items)
        if not schedule_ids:
            errors.append("anime-schedule.json no contiene emisiones.")
        if len(schedule_ids) != len(schedule_items):
            errors.append("anime-schedule.json contiene emisiones duplicadas o sin mal_id.")
        missing_schedule = sorted(schedule_ids - master_ids)
        if missing_schedule:
            errors.append(f"Emisiones fuera del catalogo: {missing_schedule[:8]}")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"No se pudieron validar proximos estrenos y calendario ({exc})")


def check_asset_versions(errors: list[str]) -> None:
    try:
        index = (ROOT / "index.html").read_text(encoding="utf-8")
        script = (ROOT / "assets" / "neoanimez.js").read_text(encoding="utf-8")
        worker = (ROOT / "service-worker.js").read_text(encoding="utf-8")
        app_match = re.search(r"const APP_VERSION = '([^']+)';", script)
        worker_match = re.search(r"const CACHE_VERSION = '([^']+)';", worker)
        asset_versions = re.findall(r"assets/neoanimez\.(?:css|js)\?v=([^\"']+)", index)
        versions = [app_match.group(1) if app_match else "", worker_match.group(1) if worker_match else "", *asset_versions]
        if len(asset_versions) != 2 or not versions[0] or len(set(versions)) != 1:
            errors.append("Las versiones de index, JavaScript y service worker no coinciden.")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"No se pudo validar la version de los assets ({exc})")


def check_anime_relations(errors: list[str]) -> None:
    catalog_path = ROOT / "anime-lista.json"
    relations_path = ROOT / "anime-relations.json"
    if not catalog_path.is_file() or not relations_path.is_file():
        return
    try:
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        payload = json.loads(relations_path.read_text(encoding="utf-8"))
        catalog_ids = {
            int(anime["mal_id"])
            for anime in catalog
            if isinstance(anime, dict) and anime.get("mal_id")
        }
        relations = payload.get("relations") or {}
        series = payload.get("series") or {}
        navigation = payload.get("navigation") or {}
        if int(payload.get("version") or 0) < 2 or not series or not navigation:
            errors.append("anime-relations.json no incluye el orden completo de sagas (version 2).")
            return
        if int(payload.get("catalog_count") or 0) != len(catalog_ids):
            errors.append("anime-relations.json no corresponde al catalogo actual.")

        memberships: set[int] = set()
        for series_id, value in series.items():
            entries = [int(item) for item in value.get("entries") or []]
            if len(entries) < 2 or len(entries) != len(set(entries)):
                errors.append(f"Saga {series_id}: orden vacio o con ids duplicados.")
                continue
            missing = [anime_id for anime_id in entries if anime_id not in catalog_ids]
            if missing:
                errors.append(f"Saga {series_id}: ids fuera del catalogo: {missing[:5]}")
            repeated = [anime_id for anime_id in entries if anime_id in memberships]
            if repeated:
                errors.append(f"Saga {series_id}: ids repetidos en otra saga: {repeated[:5]}")
            memberships.update(entries)

            if not value.get("has_cycle"):
                position = {anime_id: index for index, anime_id in enumerate(entries)}
                for anime_id in entries:
                    for sequel_id in (relations.get(str(anime_id)) or {}).get("sequels") or []:
                        sequel_id = int(sequel_id)
                        if sequel_id in position and position[anime_id] >= position[sequel_id]:
                            errors.append(
                                f"Saga {series_id}: {anime_id} aparece despues de su secuela {sequel_id}."
                            )

        for anime_id, value in navigation.items():
            series_id = str(value.get("series_id"))
            entries = (series.get(series_id) or {}).get("entries") or []
            if int(anime_id) not in entries:
                errors.append(f"Navegacion rota para anime {anime_id}.")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"No se pudo validar anime-relations.json ({exc})")


def check_anime_timelines(errors: list[str]) -> None:
    index_path = ROOT / "anime-timeline-index.json"
    details_dir = ROOT / "anime-timelines"
    if not index_path.is_file() or not details_dir.is_dir():
        return
    try:
        index = json.loads(index_path.read_text(encoding="utf-8"))
        files = index.get("files") or []
        navigation = index.get("navigation") or {}
        if len(files) != REQUIRED_DIRS["anime-timelines"]:
            errors.append(
                f"anime-timeline-index.json: esperaba {REQUIRED_DIRS['anime-timelines']} bloques y declara {len(files)}."
            )
            return

        timelines: dict[str, dict] = {}
        timeline_file_index: dict[str, int] = {}
        nodes_by_timeline: dict[str, set[int]] = {}
        for block_index, rel in enumerate(files):
            block_path = ROOT / str(rel)
            if not block_path.is_file():
                errors.append(f"Falta bloque de arbol temporal: {rel}")
                continue
            block = json.loads(block_path.read_text(encoding="utf-8"))
            block_nodes = block.get("nodes") or {}
            for timeline_id, timeline in (block.get("timelines") or {}).items():
                if timeline_id in timelines:
                    errors.append(f"Arbol temporal duplicado: {timeline_id}")
                    continue
                node_ids = {int(item) for item in timeline.get("nodes") or []}
                missing_nodes = [item for item in node_ids if str(item) not in block_nodes]
                if missing_nodes:
                    errors.append(f"Arbol {timeline_id}: faltan nodos {missing_nodes[:5]}")
                for edge in timeline.get("edges") or []:
                    source = int(edge.get("from") or 0)
                    target = int(edge.get("to") or 0)
                    if source not in node_ids or target not in node_ids:
                        errors.append(f"Arbol {timeline_id}: conexion rota {source} -> {target}")
                timelines[timeline_id] = timeline
                timeline_file_index[timeline_id] = block_index
                nodes_by_timeline[timeline_id] = node_ids

        for anime_id, value in navigation.items():
            if not isinstance(value, list) or len(value) < 2:
                errors.append(f"Indice temporal invalido para anime {anime_id}.")
                continue
            timeline_id = str(int(value[0]))
            block_index = int(value[1])
            if timeline_id not in timelines:
                errors.append(f"Anime {anime_id}: arbol {timeline_id} inexistente.")
            elif timeline_file_index[timeline_id] != block_index:
                errors.append(f"Anime {anime_id}: apunta al bloque incorrecto.")
            elif int(anime_id) not in nodes_by_timeline[timeline_id]:
                errors.append(f"Anime {anime_id}: no pertenece al arbol indicado.")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"No se pudieron validar los arboles temporales ({exc})")


def check_do_not_publish(warnings: list[str]) -> None:
    for rel in DO_NOT_PUBLISH:
        path = ROOT / rel
        if path.exists():
            warnings.append(f"No publicar: {rel}")

    for path in ROOT.glob("*.full.json"):
        warnings.append(f"No publicar: {path.name}")


def compare_repo_copy(warnings: list[str]) -> None:
    if not REPO_COPY.is_dir():
        return

    for rel in REQUIRED_ROOT_FILES:
        local_path = ROOT / rel
        repo_path = REPO_COPY / rel
        if not local_path.exists():
            continue
        if not repo_path.exists():
            warnings.append(f"En neoanimez-repo falta: {rel}")
            continue
        if rel == "CNAME":
            local_text = local_path.read_text(encoding="utf-8").strip()
            repo_text = repo_path.read_text(encoding="utf-8").strip()
            if local_text != repo_text:
                warnings.append(f"Diferente en neoanimez-repo: {rel}")
            continue
        if local_path.is_file() and repo_path.is_file() and sha256(local_path) != sha256(repo_path):
            warnings.append(f"Diferente en neoanimez-repo: {rel}")


def print_summary() -> None:
    print("Archivos principales:")
    for rel in REQUIRED_ROOT_FILES:
        path = ROOT / rel
        if path.is_file():
            print(f"  OK {rel} ({format_size(path)})")
        else:
            print(f"  -- {rel}")

    print("\nCarpetas de datos:")
    for dirname in REQUIRED_DIRS:
        directory = ROOT / dirname
        count = len(list(directory.glob("*.json"))) if directory.is_dir() else 0
        print(f"  {dirname}/: {count} JSON")


def main() -> int:
    errors: list[str] = []
    warnings: list[str] = []

    check_required_files(errors)
    check_required_dirs(errors)
    check_json(errors)
    check_catalog_outputs(errors)
    check_upcoming_and_schedule(errors)
    check_asset_versions(errors)
    check_anime_relations(errors)
    check_anime_timelines(errors)
    check_do_not_publish(warnings)
    compare_repo_copy(warnings)

    print_summary()

    if warnings:
      print("\nAvisos:")
      for warning in dict.fromkeys(warnings):
          print(f"  - {warning}")

    if errors:
        print("\nResultado: FALTA corregir algo antes de publicar.")
        for error in errors:
            print(f"  - {error}")
        return 1

    print("\nResultado: OK para publicar la lista limpia.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
