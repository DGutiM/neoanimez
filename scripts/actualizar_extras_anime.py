#!/usr/bin/env python3
"""Optional static discovery data. No account data, lyrics or episode spoilers."""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
import re
import shutil
import time
import uuid

from catalog_sources import CatalogClient, SourceError, atomic_json, now

ROOT = Path(__file__).resolve().parents[1]
BLOCKS = 64
LEGACY_BLOCKS = 16
RESOURCES = ("themes", "recommendations", "episodes")
STATE_FILE = "scripts/data/anime-extras-state.json"


def read(path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def song(raw):
    if isinstance(raw, dict):
        title, artist, episodes = raw.get("title"), raw.get("artist"), raw.get("episodes")
    elif isinstance(raw, str):
        match = re.fullmatch(r'\s*(?:\d+:\s*)?"(.+)"\s+by\s+(.+?)(?:\s+\((eps?[^)]*)\))?\s*', raw)
        # Keep unparsed metadata verbatim rather than inventing artist or range.
        title, artist, episodes = match.groups() if match else (raw.strip(), None, None)
    else:
        raise SourceError("Cancion con formato desconocido")
    if not isinstance(title, str) or not title.strip():
        raise SourceError("Cancion sin titulo")
    return {"title": title.strip(), "artist": str(artist or "").strip(),
            "episodes": re.sub(r"^eps?\.?\s*", "", str(episodes or "")).strip()}


def safe_anime(anime):
    labels = anime.get("genres", []) + anime.get("themes", [])
    labels = [str(x.get("name", "") if isinstance(x, dict) else x).lower() for x in labels]
    return not any(x in {"hentai", "erotica", "ecchi"} for x in labels)


def recommendations(anime_id, rows, catalog, relations, navigation):
    result = {}
    own_saga = (navigation.get(str(anime_id)) or [None])[0]
    own_franchise = catalog[anime_id].get("franchise")
    for raw in rows:
        if not isinstance(raw, dict):
            raise SourceError("Recomendacion con formato desconocido")
        entry = raw.get("entry", raw)
        if not isinstance(entry, dict):
            raise SourceError("Recomendacion sin ficha")
        candidate_id = entry.get("mal_id", entry.get("malId"))
        if not isinstance(candidate_id, int) or isinstance(candidate_id, bool):
            raise SourceError("Recomendacion sin ID MAL")
        anime = catalog.get(candidate_id)
        if not anime or candidate_id == anime_id or not safe_anime(anime):
            continue
        if anime.get("type") not in {"TV", "Movie", "ONA"} or anime.get("airing_status") == "Not yet aired":
            continue
        if relations.get(str(candidate_id), {}).get("prequels"):
            continue
        if own_saga is not None and (navigation.get(str(candidate_id)) or [None])[0] == own_saga:
            continue
        if own_franchise and anime.get("franchise") == own_franchise:
            continue
        # Additional conservative guard for seasons not linked in the source graph.
        if re.search(r"\b(?:[2-9](?:nd|rd|th)? season|season [2-9]|part [2-9])\b", anime.get("title", ""), re.I):
            continue
        votes = raw.get("votes")
        if not isinstance(votes, (float, int)) or isinstance(votes, bool) or votes < 0:
            raise SourceError("Votos de recomendacion invalidos")
        result[candidate_id] = max(result.get(candidate_id, 0), int(votes))
    return [{"mal_id": key, "votes": votes} for key, votes in sorted(result.items(), key=lambda x: (-x[1], x[0]))[:12]]


def load_entries(root):
    index = read(root / "anime-extras-index.json", {})
    entries = {}
    for name in index.get("files", []):
        if not re.fullmatch(r"anime-extras/extras-\d{2}\.json", name):
            raise SourceError("Ruta de extras invalida")
        block = read(root / name, {})
        if block.get("version") != 1 or not isinstance(block.get("entries"), dict):
            raise SourceError("Bloque de extras incompleto")
        if set(entries).intersection(block["entries"]):
            raise SourceError("Anime duplicado en los bloques de extras")
        entries.update(block["entries"])
    return entries


def block_files():
    # Keep 00-15 immutable for visitors with the previous index still in cache.
    return [f"anime-extras/extras-{i + LEGACY_BLOCKS:02d}.json" for i in range(BLOCKS)]


def write_entries(root, entries):
    generated = now()
    files = block_files()
    blocks = [{"version": 1, "entries": {}} for _ in files]
    index = {"version": 1, "generated_at": generated, "files": files, "entries": {}}
    for key, item in sorted(entries.items(), key=lambda x: int(x[0])):
        block = int(key) % BLOCKS
        blocks[block]["entries"][key] = item
        index["entries"][key] = {"block": block, **{name: bool(item.get(name, {}).get("items")) for name in ("episodes", "recommendations")},
                                  "themes": any(item.get("themes", {}).get(kind) for kind in ("openings", "endings"))}
    for file, block in zip(files, blocks):
        atomic_json(root / file, block)
    atomic_json(root / "anime-extras-index.json", index)


def validate(root):
    catalog = {row["mal_id"]: row for row in read(root / "anime-lista.json")}
    index = read(root / "anime-extras-index.json", {})
    entries = load_entries(root)
    if index.get("files") != block_files() or set(entries) != set(index.get("entries", {})):
        raise SourceError("Indice de extras incompleto")
    blocks = {name: read(root / name) for name in index["files"]}
    for name in index["files"]:
        if (root / name).stat().st_size > 2_000_000:
            raise SourceError("Bloque de extras demasiado grande; revisar particionado")
    for key, item in entries.items():
        if int(key) not in catalog or item.get("mal_id") != int(key):
            raise SourceError("Extra sin anime local")
        expected = index["files"][int(key) % BLOCKS]
        if index["entries"][key].get("block") != int(key) % BLOCKS or key not in blocks[expected]["entries"]:
            raise SourceError("Bloque de extras incorrecto")
        flags = index["entries"][key]
        for resource in RESOURCES:
            value = item.get(resource, {})
            available = bool(value.get("openings") or value.get("endings")) if resource == "themes" else bool(value.get("items"))
            if flags.get(resource) is not available:
                raise SourceError("Disponibilidad de extras distinta al bloque")
        numbers = [row["number"] for row in item.get("episodes", {}).get("items", [])]
        if numbers != sorted(set(numbers)) or any(not isinstance(n, int) or isinstance(n, bool) or n < 1 for n in numbers):
            raise SourceError("Episodios no validos")
        for row in item.get("episodes", {}).get("items", []):
            if any(row.get(flag) is not None and not isinstance(row[flag], bool) for flag in ("filler", "recap")):
                raise SourceError("Marca de episodio no valida")
        for row in item.get("recommendations", {}).get("items", []):
            if row["mal_id"] not in catalog or row["mal_id"] == int(key):
                raise SourceError("Recomendacion ajena al catalogo")
        for name in ("episodes", "themes", "recommendations"):
            resource = item.get(name)
            if resource and (resource.get("provider") not in {"tenrai", "edge"} or not resource.get("fetched_at")):
                raise SourceError("Recurso sin procedencia o fecha")
        for kind in ("openings", "endings"):
            for row in item.get("themes", {}).get(kind, []):
                song(row)
    return {"anime": len(entries), "guides": sum(bool(x.get("episodes", {}).get("items")) for x in entries.values()),
            "recommendations": sum(bool(x.get("recommendations", {}).get("items")) for x in entries.values()),
            "themes": sum(bool(x.get("themes", {}).get("openings") or x.get("themes", {}).get("endings")) for x in entries.values())}


def progress(catalog, entries):
    checked = {name: sum(name in entries.get(str(key), {}) for key in catalog) for name in RESOURCES}
    completed = sum(all(name in entries.get(str(key), {}) for name in RESOURCES) for key in catalog)
    return {"catalog": len(catalog), "checked": checked, "complete": completed,
            "pending_anime": len(catalog) - completed, "pending_resources": len(catalog) * len(RESOURCES) - sum(checked.values())}


def recover_checkpoints(root, catalog, entries, state, *, only_missing=False):
    """Only newer resources are recovered; an interrupted run cannot erase output."""
    for path in (root / "cache" / "extras-checkpoints-v1").glob("*.json"):
        checkpoint = read(path)
        key = path.stem
        if not key.isdigit() or int(key) not in catalog or checkpoint.get("version") != 1:
            continue
        item = checkpoint.get("item", {})
        if item.get("mal_id") != int(key):
            raise SourceError("Checkpoint de extras con ID distinto")
        current = entries.setdefault(key, {"mal_id": int(key)})
        for resource in RESOURCES:
            value = item.get(resource)
            if only_missing and resource in current:
                continue
            if value and value.get("fetched_at", "") > current.get(resource, {}).get("fetched_at", ""):
                current[resource] = value
        for resource, failure in checkpoint.get("failures", {}).items():
            current_failures = state["failures"].setdefault(key, {})
            if resource in RESOURCES and failure.get("last_attempt", "") > max(
                    current_failures.get(resource, {}).get("last_attempt", ""), current.get(resource, {}).get("fetched_at", "")):
                current_failures[resource] = failure
        for resource in list(state["failures"].get(key, {})):
            if state["failures"][key][resource].get("last_attempt", "") <= current.get(resource, {}).get("fetched_at", ""):
                del state["failures"][key][resource]


def refresh(root=ROOT, *, limit=80, ids=(), offline=False, bootstrap=False, max_seconds=0, retry_errors=False):
    root = Path(root)
    catalog = {row["mal_id"]: row for row in read(root / "anime-lista.json")}
    relations = read(root / "anime-relations.json", {}).get("relations", {})
    navigation = read(root / "anime-timeline-index.json", {}).get("navigation", {})
    entries = load_entries(root)
    state = read(root / STATE_FILE, {"version": 1, "failures": {}})
    original = {key: dict(item) for key, item in entries.items()}
    recover_checkpoints(root, catalog, entries, state, only_missing=bootstrap)
    client = CatalogClient(root, timeout=15, retries=1, offline=offline)
    started = time.monotonic()
    def due(key, resource):
        if bootstrap and resource in entries.get(str(key), {}):
            return False
        failure = state["failures"].get(str(key), {}).get(resource, {})
        return retry_errors or failure.get("retry_after", "") <= now()
    eligible = [a for a in catalog.values() if any(due(a["mal_id"], name) for name in RESOURCES)]
    def age(anime):
        entry = entries.get(str(anime["mal_id"]), {})
        return min(entry.get(name, {}).get("fetched_at", "") for name in RESOURCES)
    eligible.sort(key=lambda a: (age(a), -(a.get("scored_by") or 0), a["mal_id"]))
    selected = list(dict.fromkeys(list(ids) + [a["mal_id"] for a in eligible[:limit]]))
    report = {"generated_at": now(), "updated": [], "kept_on_error": [], "stopped": None}
    consecutive_errors = 0
    for position, anime_id in enumerate(selected):
        if anime_id not in catalog:
            continue
        key = str(anime_id)
        item = entries.get(key, {"mal_id": anime_id})
        resources = [name for name in RESOURCES if due(anime_id, name)]
        print(f"[EXTRAS] {position+1}/{len(selected)} MAL {anime_id}", flush=True)
        for resource in resources:
            if max_seconds and time.monotonic() - started >= max_seconds:
                report["stopped"] = "time_budget"
                break
            try:
                payload = client.extra(anime_id, resource)
                meta = {"provider": payload["provider"], "fetched_at": payload["fetched_at"]}
                if resource == "themes":
                    value = {**meta, **{kind: [song(s) for s in payload["data"][kind]] for kind in ("openings", "endings")}}
                    previous = item.get(resource, {})
                    if not value["openings"] and not value["endings"] and (previous.get("openings") or previous.get("endings")):
                        raise SourceError("La fuente ahora devuelve cero canciones; conservamos las anteriores")
                elif resource == "recommendations":
                    value = {**meta, "items": recommendations(anime_id, payload["data"], catalog, relations, navigation)}
                    if not value["items"] and item.get(resource, {}).get("items"):
                        raise SourceError("La fuente devuelve cero recomendaciones; conservamos las anteriores")
                else:
                    rows = payload["data"]
                    if not {r["number"] for r in item.get(resource, {}).get("items", [])}.issubset({r["number"] for r in rows}):
                        raise SourceError("La guia ha perdido episodios; se conserva la anterior")
                    total = catalog[anime_id].get("episodes")
                    complete = bool(total and [r["number"] for r in rows] == list(range(1, int(total) + 1)))
                    value = {**meta, "items": rows, "coverage": "complete" if complete else "partial"}
                item[resource] = value
                state["failures"].setdefault(key, {}).pop(resource, None)
                consecutive_errors = 0
                report["updated"].append([anime_id, resource])
            except (SourceError, ValueError, TypeError) as error:
                if offline and "Sin cache" in str(error):
                    report["kept_on_error"].append({"mal_id": anime_id, "resource": resource, "error": str(error)})
                    continue
                consecutive_errors += 1
                previous = state["failures"].setdefault(key, {}).get(resource, {})
                attempts = previous.get("attempts", 0) + 1
                state["failures"][key][resource] = {
                    "last_attempt": now(), "attempts": attempts, "error": str(error)[:500],
                    "retry_after": (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=min(168, 6 * 2 ** min(attempts - 1, 5)))).replace(microsecond=0).isoformat()}
                report["kept_on_error"].append({"mal_id": anime_id, "resource": resource, "error": str(error)})
                print(f"[KEEP] {anime_id}/{resource}: {error}", flush=True)
                if "Acceso rechazado" in str(error) or "Limite de" in str(error):
                    report["stopped"] = "provider_limit"
                elif consecutive_errors >= 10:
                    report["stopped"] = "provider_unavailable"
            atomic_json(root / "cache" / "extras-checkpoints-v1" / (key + ".json"), {
                "version": 1, "item": item, "failures": state["failures"].get(key, {})})
            if report["stopped"]:
                break
        if len(item) > 1:
            entries[key] = item
        if report["stopped"]:
            break
    if bootstrap:
        for key, item in original.items():
            if any(entries.get(key, {}).get(name) != value for name, value in item.items()):
                raise SourceError("La ampliacion ha alterado datos existentes; no se publica")
    if entries != original or read(root / "anime-extras-index.json", {}).get("files") != block_files():
        write_entries(root, entries)
    report["coverage"] = validate(root)
    report["progress"] = progress(catalog, entries)
    state["failures"] = {key: value for key, value in state["failures"].items() if value}
    atomic_json(root / STATE_FILE, state)
    report["requests"] = client.stats
    atomic_json(root / "cache" / "extras-report.json", report, pretty=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=80)
    parser.add_argument("--ids", default="")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--bootstrap", action="store_true", help="Solo recursos que aun no se han consultado")
    parser.add_argument("--max-seconds", type=int, default=0, help="Presupuesto por lote; 0 sin limite")
    parser.add_argument("--retry-errors", action="store_true", help="Reintentar errores antes de su plazo")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--validate", action="store_true")
    args = parser.parse_args()
    if args.limit < 0 or args.max_seconds < 0:
        parser.error("Los limites no pueden ser negativos")
    if args.status:
        print(json.dumps(progress({a["mal_id"]: a for a in read(ROOT / "anime-lista.json")}, load_entries(ROOT))))
        return
    if args.validate:
        print(validate(ROOT))
        return
    # Standalone updates preserve their previous static output too.
    backup = ROOT / "backups" / ("anime-extras-" + dt.datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6])
    if (ROOT / "anime-extras-index.json").exists():
        backup.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / "anime-extras-index.json", backup)
        shutil.copytree(ROOT / "anime-extras", backup / "anime-extras")
        if (ROOT / STATE_FILE).exists():
            shutil.copy2(ROOT / STATE_FILE, backup / "state.json")
    try:
        report = refresh(limit=args.limit, ids=[int(x) for x in args.ids.split(",") if x], offline=args.offline,
                         bootstrap=args.bootstrap, max_seconds=args.max_seconds, retry_errors=args.retry_errors)
        print(json.dumps({key: report[key] for key in ("coverage", "progress", "stopped")}, ensure_ascii=False))
    except BaseException:
        if backup.exists():
            shutil.copy2(backup / "anime-extras-index.json", ROOT)
            shutil.copytree(backup / "anime-extras", ROOT / "anime-extras", dirs_exist_ok=True)
            for path in (ROOT / "anime-extras").glob("*.json"):
                if not (backup / "anime-extras" / path.name).exists():
                    path.unlink()
            if (backup / "state.json").exists():
                shutil.copy2(backup / "state.json", ROOT / STATE_FILE)
        raise
    if report["stopped"] in {"provider_limit", "provider_unavailable"}:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
