#!/usr/bin/env python3
"""Stage, validate and optionally promote the static catalogue. No live DB writes."""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import uuid

from catalog_sources import CatalogClient, MissingAnime, SourceError, atomic_json, now
from catalog_transition import (assert_preserved, build_upcoming_files, load_published_graph, merge_anime,
                                read_json, refresh_graph)
from sincronizar_jikan_2026 import build_anime_record
from verificar_publicacion import REQUIRED_ROOT_FILES, REQUIRED_DIRS

ROOT = Path(__file__).resolve().parents[1]
DATA_FILES = ["anime-lista.json", "anime-index.json", "anime-upcoming.json", "anime-schedule.json",
              "anime-relations.json", "anime-timeline-index.json", "anime-extras-index.json",
              "scripts/data/anime-extras-state.json"]
RELEASE_FILES = ["assets/neoanimez.js", "index.html", "service-worker.js", "sitemap.xml"]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def publication_files(root):
    paths = DATA_FILES + RELEASE_FILES
    for directory in REQUIRED_DIRS:
        paths += [str(path.relative_to(root)) for path in sorted((root / directory).glob("*.json"))]
    return paths


def prepare_stage(root):
    root = Path(root)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    folder = root / "backups" / ("catalog-sync-" + stamp)
    stage = folder / "candidate"
    stage.mkdir(parents=True)
    files = sorted(set(REQUIRED_ROOT_FILES + publication_files(root)))
    archive = folder / "before.tar.gz"
    baseline = {name: digest(root / name) for name in files}
    with tarfile.open(archive, "w:gz") as backup:
        for name in files:
            backup.add(root / name, arcname=name)
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(root / name, target)
    for directory in ("scripts", "assets"):
        shutil.copytree(root / directory, stage / directory, dirs_exist_ok=True,
                        ignore=shutil.ignore_patterns("__pycache__"))
    for path in root.glob("anime-upcoming*.full.json"):
        shutil.copy2(path, stage / path.name)
    (root / "cache").mkdir(exist_ok=True)
    (stage / "cache").symlink_to(root / "cache", target_is_directory=True)
    atomic_json(folder / "baseline.json", baseline)
    print(f"[BACKUP] {archive}", flush=True)
    return folder, stage, baseline


def run(stage, name, *arguments):
    print(f"[RUN] {name} {' '.join(map(str, arguments))}", flush=True)
    subprocess.run([sys.executable, str(stage / "scripts" / name), *map(str, arguments)], cwd=stage, check=True)


def promote(root, stage, baseline, folder, *, replace=os.replace):
    """Local multi-file copy with rollback. Git commit remains the deployment unit."""
    for name, previous_hash in baseline.items():
        if not (root / name).is_file() or digest(root / name) != previous_hash:
            raise RuntimeError(f"El archivo {name} cambio durante la actualizacion; no se sobrescribe")
    changed = [name for name in publication_files(stage)
               if not (root / name).exists() or digest(stage / name) != digest(root / name)]
    rollback = folder / "rollback"
    rollback.mkdir(exist_ok=True)
    applied = []
    try:
        for name in changed:
            destination = root / name
            if destination.exists():
                saved = rollback / name
                saved.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(destination, saved)
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(destination.name + ".tmp")
            shutil.copy2(stage / name, temporary)
            replace(temporary, destination)
            applied.append(name)
    except BaseException:
        for name in reversed(applied):
            saved = rollback / name
            if saved.exists():
                shutil.copy2(saved, root / name)
            else:
                (root / name).unlink(missing_ok=True)
        raise
    return changed


def collect(client, years, report):
    discovered = {}
    # Empty future seasons are legitimate; a failed page aborts the whole run.
    for year in years:
        for season in ("winter", "spring", "summer", "fall"):
            path = f"/seasons/{year}/{season}"
            print(f"[FETCH] {path}", flush=True)
            items = client.listing(path)
            report.setdefault("lists", {})[path] = len(items)
            for item in items:
                discovered[item["mal_id"]] = item
    items = client.listing("/seasons/upcoming")
    report["lists"]["upcoming"] = len(items)
    for item in items:
        discovered.setdefault(item["mal_id"], item)
    if not discovered:
        raise SourceError("Todas las fuentes han devuelto un catalogo vacio")
    return discovered


def sync(stage, root, args, report):
    before = read_json(stage / "anime-lista.json")
    by_id = {item["mal_id"]: copy.deepcopy(item) for item in before}
    client = CatalogClient(root, offline=args.offline)
    years = [args.year + offset for offset in range(args.years_ahead + 1)]
    remote = {} if args.no_discovery else collect(client, years, report)
    published_nodes, _ = load_published_graph(root)
    missing = set(read_json(root / "cache" / "catalog-related-pending.json", []))
    missing.update(int(key) for key in published_nodes if int(key) not in by_id)
    if args.no_discovery:
        missing.clear()
    new_ids = sorted((set(remote) | missing) - set(by_id))
    report["new_deferred"] = new_ids[args.max_new:]
    full = {}
    ordered = sorted(by_id, key=lambda key: ((by_id[key].get("_catalog_sync") or {}).get("details_fetched_at", ""), key))
    active = [key for key in ordered if by_id[key].get("ongoing") or by_id[key].get("airing_status") == "Not yet aired"]
    active_ids = set(active)
    historical = [key for key in ordered if key not in active_ids]
    active_limit = (args.max_details * 2 + 2) // 3
    priority = list(dict.fromkeys(active[:active_limit] + historical[:args.max_details - active_limit] + ordered))
    ids = list(dict.fromkeys(args.ids + new_ids[:args.max_new] + priority[:args.max_details]))
    for position, anime_id in enumerate(ids):
        print(f"[DETAIL] {position + 1}/{len(ids)} MAL {anime_id}", flush=True)
        # Do not silently continue with half a successful catalogue update.
        try:
            full[anime_id] = client.anime(anime_id)
        except MissingAnime:
            report.setdefault("unavailable_ids_kept_locally", []).append(anime_id)
            continue
        remote[anime_id] = full[anime_id]
    if not remote:
        raise SourceError("Ninguna ficha comprobada; no se publica una actualizacion vacia")
    added = []
    for anime_id, raw in remote.items():
        if anime_id in by_id:
            by_id[anime_id] = merge_anime(by_id[anime_id], raw, report)
        elif anime_id in full and anime_id in new_ids[:args.max_new]:
            record = build_anime_record(raw)
            record["_neo_source"] = raw["_source"]
            record["_catalog_sync"] = {"provider": raw["_source"], "fetched_at": raw["_fetched_at"], "details_fetched_at": raw["_fetched_at"], "score_source": "myanimelist"}
            record["_update_status"] = "catalog_sources_v1_new"
            by_id[anime_id] = record
            added.append(anime_id)
    catalog = list(by_id.values())
    assert_preserved(before, catalog)
    atomic_json(stage / "anime-lista.json", catalog, pretty=True)

    pending = [item for item in catalog if not item.get("title_es") or (item.get("description") and not item.get("description_es"))]
    if pending and not args.offline:
        # Translate only incomplete records; old aliases and review flags stay intact.
        translation_file = "translation-pending.full.json"
        atomic_json(stage / translation_file, pending)
        run(stage, "generar_titulos_es.py", "--input", translation_file, "--in-place", "--batch-size", 20, "--quiet")
        run(stage, "traducir_descripciones.py", "--input", translation_file, "--in-place", "--workers", 2, "--quiet")
        translated = {item["mal_id"]: item for item in read_json(stage / translation_file)}
        for item in catalog:
            candidate = translated.get(item["mal_id"])
            if not candidate:
                continue
            if not item.get("title_es") and candidate.get("title_es_status") in {"fallback", "offline"}:
                raise SourceError(f"Traduccion de titulo pendiente: {item['mal_id']}")
            for field in ("title_es", "title_es_reviewed", "title_es_source", "title_es_status", "search_titles_es", "description_es"):
                if not item.get(field) and candidate.get(field):
                    item[field] = candidate[field]
    # Only clean new content, never silently rewrite already curated descriptions.
    from limpiar_descripciones import clean_data
    new_records = [item for item in catalog if item["mal_id"] in added]
    clean_data(new_records)
    assert_preserved(before, catalog)
    atomic_json(stage / "anime-lista.json", catalog, pretty=True)
    if not args.skip_sagas:
        refresh_graph(stage, catalog, full, report)

    upcoming_files = build_upcoming_files(stage, catalog, remote, years)
    command = ["--input", upcoming_files[0], "--output", "anime-upcoming.json", "--master", "anime-lista.json", "--season", 10, "--extra-year-top", 10, "--no-backup"]
    for path in upcoming_files[1:]:
        command.extend(["--extra-year-input", path])
    run(stage, "curar_upcoming.py", *command)
    run(stage, "generar_schedule_jikan.py", "--local-only")
    schedule_path = stage / "anime-schedule.json"
    schedule = read_json(schedule_path)
    schedule["source"] = "Local catalogue checked via Tenrai/Jikan-Edge; previous data preserved"
    schedule["stats"]["remote_source"] = schedule["source"]
    atomic_json(schedule_path, schedule)
    run(stage, "generar_catalogo_web.py")
    run(stage, "actualizar_extras_anime.py", *( ["--offline"] if args.offline else [] ))
    report["extras"] = read_json(stage / "cache" / "extras-report.json", {})
    report.update(initial_count=len(before), final_count=len(catalog), added=added, network=client.stats)
    pending_relations = (missing | set(report.get("missing_related_ids", []))) - {item["mal_id"] for item in before}
    atomic_json(root / "cache" / "catalog-related-pending.json", sorted(pending_relations))
    # This generates version tokens in the isolated candidate only.
    run(stage, "catalog_release_version.py")
    run(stage, "verificar_publicacion.py")
    assert_preserved(before, read_json(stage / "anime-lista.json"))
    return report


def main():
    parser = argparse.ArgumentParser(description="Actualizacion protegida Tenrai + Jikan-Edge (sin consultas a AniList)")
    parser.add_argument("--year", type=int, default=dt.date.today().year)
    parser.add_argument("--years-ahead", type=int, default=2)
    parser.add_argument("--max-details", type=int, default=200, help="Fichas completas por pasada; se rota por antiguedad")
    parser.add_argument("--max-new", type=int, default=120)
    parser.add_argument("--ids", default="", help="IDs MAL prioritarios separados por coma")
    parser.add_argument("--no-discovery", action="store_true", help="Piloto de fichas concretas, sin consultar temporadas")
    parser.add_argument("--offline", action="store_true", help="Solo cache, para pruebas; nunca consulta proveedores")
    parser.add_argument("--skip-sagas", action="store_true")
    parser.add_argument("--apply", action="store_true", help="Promueve localmente tras validar. No sube nada a GitHub")
    args = parser.parse_args()
    if args.offline and args.apply:
        parser.error("--offline es solo para validar; no se puede publicar como una actualizacion reciente")
    if args.max_details < 0 or args.max_new < 0 or args.years_ahead < 1:
        parser.error("Limites invalidos")
    try:
        args.ids = [int(value) for value in args.ids.split(",") if value.strip()]
    except ValueError:
        parser.error("--ids necesita numeros MAL")
    folder, stage, baseline = prepare_stage(ROOT)
    report = {"started_at": now(), "provider_order": ["tenrai", "edge"], "anilist_requests": 0,
              "state": "staging", "candidate": str(stage), "backup": str(folder / "before.tar.gz")}
    try:
        sync(stage, ROOT, args, report)
        report["state"] = "validated"
        if args.apply:
            report["changed_files"] = promote(ROOT, stage, baseline, folder)
            report["state"] = "applied_locally"
        print(f"[OK] {report['state']}. Revision: {folder / 'report.json'}", flush=True)
    except Exception as error:
        report.update(state="failed_no_publication", error=str(error))
        print(f"[ERROR] No se publica: {error}", file=sys.stderr, flush=True)
        return 1
    finally:
        report["finished_at"] = now()
        atomic_json(folder / "report.json", report)
        atomic_json(ROOT / "cache" / "catalog-sync-report.json", report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
