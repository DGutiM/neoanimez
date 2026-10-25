#!/usr/bin/env python3
"""Optional static discovery data. No account data, lyrics or episode spoilers."""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
import re
import shutil

from catalog_sources import CatalogClient, SourceError, atomic_json, now

ROOT = Path(__file__).resolve().parents[1]
BLOCKS = 16
PILOT_IDS = (20, 1735, 21, 269, 223, 813, 225, 249, 38000, 52991)


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
        entries.update(read(root / name, {})["entries"])
    return entries


def write_entries(root, entries):
    generated = now()
    files = [f"anime-extras/extras-{i:02d}.json" for i in range(BLOCKS)]
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
    if len(index.get("files", [])) != BLOCKS or set(entries) != set(index.get("entries", {})):
        raise SourceError("Indice de extras incompleto")
    for key, item in entries.items():
        if int(key) not in catalog or item.get("mal_id") != int(key):
            raise SourceError("Extra sin anime local")
        expected = index["files"][int(key) % BLOCKS]
        if index["entries"][key].get("block") != int(key) % BLOCKS or key not in read(root / expected)["entries"]:
            raise SourceError("Bloque de extras incorrecto")
        numbers = [row["number"] for row in item.get("episodes", {}).get("items", [])]
        if numbers != sorted(set(numbers)) or any(not isinstance(n, int) or n < 1 for n in numbers):
            raise SourceError("Episodios no validos")
        for row in item.get("recommendations", {}).get("items", []):
            if row["mal_id"] not in catalog or row["mal_id"] == int(key):
                raise SourceError("Recomendacion ajena al catalogo")
        for name in ("episodes", "themes", "recommendations"):
            resource = item.get(name)
            if resource and (resource.get("provider") not in {"tenrai", "edge"} or not resource.get("fetched_at")):
                raise SourceError("Recurso sin procedencia o fecha")
    return {"anime": len(entries), "guides": sum(bool(x.get("episodes", {}).get("items")) for x in entries.values()),
            "recommendations": sum(bool(x.get("recommendations", {}).get("items")) for x in entries.values()),
            "themes": sum(bool(x.get("themes", {}).get("openings") or x.get("themes", {}).get("endings")) for x in entries.values())}


def refresh(root=ROOT, *, limit=80, ids=(), offline=False):
    root = Path(root)
    catalog = {row["mal_id"]: row for row in read(root / "anime-lista.json")}
    relations = read(root / "anime-relations.json", {}).get("relations", {})
    navigation = read(root / "anime-timeline-index.json", {}).get("navigation", {})
    entries = load_entries(root)
    client = CatalogClient(root, timeout=15, retries=1, offline=offline)
    eligible = [a for a in catalog.values() if safe_anime(a) and a.get("airing_status") != "Not yet aired"]
    def age(anime):
        entry = entries.get(str(anime["mal_id"]), {})
        return min((entry.get(name, {}).get("fetched_at", "") for name in ("themes", "recommendations")))
    eligible.sort(key=lambda a: (age(a), -(a.get("scored_by") or 0), a["mal_id"]))
    selected = list(dict.fromkeys(list(ids) + list(PILOT_IDS) + [a["mal_id"] for a in eligible[:limit]]))
    report = {"generated_at": now(), "updated": [], "kept_on_error": []}
    for position, anime_id in enumerate(selected):
        if anime_id not in catalog:
            continue
        key = str(anime_id)
        item = entries.get(key, {"mal_id": anime_id})
        resources = ["themes", "recommendations"] + (["episodes"] if anime_id in PILOT_IDS else [])
        print(f"[EXTRAS] {position+1}/{len(selected)} MAL {anime_id}", flush=True)
        for resource in resources:
            try:
                payload = client.extra(anime_id, resource)
                meta = {"provider": payload["provider"], "fetched_at": payload["fetched_at"]}
                if resource == "themes":
                    value = {**meta, **{kind: [song(s) for s in payload["data"][kind]] for kind in ("openings", "endings")}}
                    if not value["openings"] and not value["endings"] and item.get(resource):
                        raise SourceError("La fuente ahora devuelve cero canciones; conservamos las anteriores")
                elif resource == "recommendations":
                    value = {**meta, "items": recommendations(anime_id, payload["data"], catalog, relations, navigation)}
                else:
                    rows = payload["data"]
                    if len(rows) < len(item.get(resource, {}).get("items", [])):
                        raise SourceError("La guia ha perdido episodios; se conserva la anterior")
                    total = catalog[anime_id].get("episodes")
                    complete = bool(total and [r["number"] for r in rows] == list(range(1, int(total) + 1)))
                    value = {**meta, "items": rows, "coverage": "complete" if complete else "partial"}
                item[resource] = value
                report["updated"].append([anime_id, resource])
            except (SourceError, ValueError, TypeError) as error:
                report["kept_on_error"].append({"mal_id": anime_id, "resource": resource, "error": str(error)})
                print(f"[KEEP] {anime_id}/{resource}: {error}", flush=True)
                if "Acceso rechazado" in str(error) or "Limite de" in str(error):
                    raise
        if len(item) > 1:
            entries[key] = item
    if not report["updated"]:
        raise SourceError("No se ha podido actualizar ningun extra; no se publica")
    write_entries(root, entries)
    report["coverage"] = validate(root)
    atomic_json(root / "cache" / "extras-report.json", report, pretty=True)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=80)
    parser.add_argument("--ids", default="")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--validate", action="store_true")
    args = parser.parse_args()
    if args.limit < 0:
        parser.error("--limit no puede ser negativo")
    if args.validate:
        print(validate(ROOT))
        return
    # Standalone updates preserve their previous static output too.
    backup = ROOT / "backups" / ("anime-extras-" + dt.datetime.now().strftime("%Y%m%d-%H%M%S"))
    if (ROOT / "anime-extras-index.json").exists():
        backup.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / "anime-extras-index.json", backup)
        shutil.copytree(ROOT / "anime-extras", backup / "anime-extras")
    try:
        print(refresh(limit=args.limit, ids=[int(x) for x in args.ids.split(",") if x], offline=args.offline)["coverage"])
    except BaseException:
        if backup.exists():
            shutil.copy2(backup / "anime-extras-index.json", ROOT)
            shutil.copytree(backup / "anime-extras", ROOT / "anime-extras", dirs_exist_ok=True)
        raise


if __name__ == "__main__":
    main()
