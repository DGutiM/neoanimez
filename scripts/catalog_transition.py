#!/usr/bin/env python3
"""Conservative MAL-ID merge; no user data or database access."""

from __future__ import annotations

import copy
import datetime as dt
import json
from pathlib import Path
import re

from catalog_sources import atomic_json, now, SourceError
from sincronizar_jikan_2026 import build_anime_record, image_url
import generar_arboles_sagas as trees
import generar_relaciones_jikan as relations
import generar_upcoming_jikan as upcoming

STATUSES = {"Not yet aired", "Currently Airing", "Finished Airing"}
STATUS_ORDER = {"Not yet aired": 0, "Currently Airing": 1, "Finished Airing": 2}
MUTABLE_FIELDS = {
    "ongoing", "airing_status", "aired_from", "aired_to", "year", "episodes",
    "broadcast_day", "broadcast_time", "broadcast_timezone", "broadcast_string",
    "image_candidates", "_catalog_sync", "score", "scored_by",
}
RELATION_NAMES = {
    "prequel": "PREQUEL", "sequel": "SEQUEL", "parent story": "PARENT",
    "side story": "SIDE_STORY", "spin-off": "SPIN_OFF", "spin off": "SPIN_OFF",
    "alternative version": "ALTERNATIVE", "alternative setting": "ALTERNATIVE",
    "summary": "SUMMARY", "compilation": "COMPILATION", "full story": "PARENT",
}


def read_json(path, default=None):
    path = Path(path)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else copy.deepcopy(default)


def date_value(value):
    """Keep partial dates partial; never turn a year/month into day one."""
    value = str(value or "").strip()
    if re.fullmatch(r"\d{4}", value):
        return value if 1900 <= int(value) <= 2200 else ""
    if re.fullmatch(r"\d{4}-\d{2}", value):
        return value if 1 <= int(value[-2:]) <= 12 else ""
    try:
        return dt.date.fromisoformat(value[:10]).isoformat()
    except ValueError:
        return ""


def note(report, anime_id, field, previous, incoming):
    report.setdefault("review", []).append({
        "mal_id": anime_id, "field": field, "kept": previous, "proposed": incoming,
    })


def merge_anime(local, remote, report):
    """Existing editorial content wins. Remote null never erases good data."""
    if int(local["mal_id"]) != remote.get("mal_id"):
        raise SourceError("No se pueden mezclar dos identificadores MAL distintos")
    item = copy.deepcopy(local)
    anime_id = item["mal_id"]
    source = remote.get("_source", "unknown")
    provenance = copy.deepcopy(item.get("_catalog_sync") or {})
    provenance.update(provider=source, fetched_at=remote.get("_fetched_at", now()))
    if isinstance(remote.get("relations"), list):
        provenance["details_fetched_at"] = remote.get("_fetched_at", now())
    proposed = build_anime_record(remote)
    status = remote.get("status")
    old_status = item.get("airing_status")
    if status in STATUSES:
        if STATUS_ORDER.get(old_status, -1) > STATUS_ORDER[status]:
            note(report, anime_id, "airing_status", old_status, status)
        else:
            item.update(airing_status=status, ongoing=status == "Currently Airing")
    for field in ("aired_from", "aired_to"):
        incoming, previous = date_value(proposed.get(field)), date_value(item.get(field))
        if incoming and incoming != previous:
            if not previous or incoming.startswith(previous):
                item[field] = incoming
            else:
                note(report, anime_id, field, item.get(field), incoming)
    if not item.get("year") and proposed.get("year"):
        item["year"] = proposed["year"]
    episodes = remote.get("episodes")
    if isinstance(episodes, int) and not isinstance(episodes, bool) and episodes > 0:
        if not item.get("episodes"):
            item["episodes"] = episodes
        elif item["episodes"] != episodes:
            note(report, anime_id, "episodes", item["episodes"], episodes)
    for field in ("broadcast_day", "broadcast_time", "broadcast_timezone", "broadcast_string"):
        if proposed.get(field):
            item[field] = proposed[field]
    # Do not mix an AniList/unknown score with a MAL voting population.
    score, votes = remote.get("score"), remote.get("scored_by")
    if isinstance(score, (int, float)) and 0 <= score <= 10 and isinstance(votes, int) and votes > 0:
        if provenance.get("score_source") == "myanimelist" or item.get("score") is None:
            item.update(score=score, scored_by=votes)
            provenance["score_source"] = "myanimelist"
    candidates = list(item.get("image_candidates") or [])
    candidate = image_url(remote)
    if candidate.startswith("https://") and candidate != item.get("image") and candidate not in candidates:
        candidates.append(candidate)
    if candidates:
        item["image_candidates"] = candidates
    # Fill blanks only, including historical fallback records. Never replace the record.
    for field in ("image", "description", "title_english", "title_japanese", "title_synonyms", "search_titles"):
        if not item.get(field) and proposed.get(field):
            item[field] = proposed[field]
    item["_catalog_sync"] = provenance
    return item


def assert_preserved(before, after):
    old = {item["mal_id"]: item for item in before}
    new = {item["mal_id"]: item for item in after}
    if len(new) != len(after) or not set(old).issubset(new):
        raise ValueError("Se han perdido o duplicado identificadores del catalogo")
    for anime_id, previous in old.items():
        current = new[anime_id]
        for field, value in previous.items():
            if field not in current:
                raise ValueError(f"Se ha eliminado {anime_id}.{field}")
            if field not in MUTABLE_FIELDS and value not in (None, "", []) and current.get(field) != value:
                raise ValueError(f"Se ha modificado contenido protegido: {anime_id}.{field}")
        if previous.get("episodes") and current.get("episodes") != previous["episodes"]:
            raise ValueError(f"Cambio de unidad/total de episodios sin revisar: {anime_id}")
        if not set(previous.get("image_candidates") or []).issubset(current.get("image_candidates") or []):
            raise ValueError(f"Se han perdido alternativas de imagen: {anime_id}")


def load_published_graph(root):
    nodes, timelines = {}, {}
    for path in sorted((Path(root) / "anime-timelines").glob("*.json")):
        block = read_json(path)
        nodes.update(block.get("nodes") or {})
        timelines.update(block.get("timelines") or {})
    return nodes, timelines


def seed_graph(root):
    """Published JSON is the baseline even on a fresh checkout without any cache."""
    nodes, timelines = load_published_graph(root)
    records = {key: {"status": "ok", "source": "published_baseline", "media": node, "edges": []}
               for key, node in nodes.items()}
    seen = set()
    for timeline in timelines.values():
        for edge in timeline["edges"]:
            source, target = str(edge["from"]), str(edge["to"])
            relation = "SEQUEL" if edge["kind"] == "continuity" else edge["relation"]
            if relation == "PARENT":
                source, target = target, source
            key = (source, target, relation)
            if key not in seen:
                records[source]["edges"].append({"relation": relation, "node": nodes[target]})
                seen.add(key)
    direct = read_json(Path(root) / "anime-relations.json", {}).get("relations", {})
    direct_records = {key: {"status": "ok", "source": "published_baseline", **value}
                      for key, value in direct.items()}
    return records, direct_records


def edge_signature(timelines):
    return {(edge["from"], edge["to"], edge["kind"]) for timeline in timelines.values()
            for edge in timeline.get("edges", [])}


def introduces_cycle(previous, candidate):
    successors = {}
    for source, target in candidate:
        successors.setdefault(source, set()).add(target)
    for source, target in candidate - previous:
        pending, seen = [target], set()
        while pending:
            current = pending.pop()
            if current == source:
                return True
            if current not in seen:
                seen.add(current)
                pending.extend(successors.get(current, set()) - seen)
    return False


def refresh_graph(root, catalog, full_records, report):
    root = Path(root)
    old_nodes, old_timelines = load_published_graph(root)
    records, direct = seed_graph(root)
    by_id = {item["mal_id"]: item for item in catalog}
    metadata = {key: dict(node) for key, node in old_nodes.items()}
    metadata.update({str(key): trees.local_media(value) for key, value in by_id.items()})
    for anime_id, raw in full_records.items():
        key = str(anime_id)
        if anime_id not in by_id:
            continue
        extracted = relations.extract_relations({"data": raw})
        previous = direct.setdefault(key, {"status": "ok", "prequels": [], "sequels": []})
        disputed = False
        for direction in ("prequels", "sequels"):
            known = {entry.get("mal_id") if isinstance(entry, dict) else entry for entry in previous[direction]}
            incoming = {entry["mal_id"] for entry in extracted[direction]}
            if known - incoming:
                note(report, anime_id, direction, sorted(known), sorted(incoming))
                disputed = True
        if disputed:
            # A provider switch is not a mandate to rewrite the curated narrative route.
            continue
        new_edges = []
        for group in raw.get("relations", []):
            relation = RELATION_NAMES.get(str(group.get("relation", "")).lower())
            if not relation:
                continue
            for entry in group.get("entry", []):
                if entry.get("type") != "anime" or not isinstance(entry.get("mal_id"), int):
                    continue
                target = entry["mal_id"]
                # Missing related metadata is not an excuse to invent a format/date.
                node = metadata.get(str(target))
                if not node:
                    report.setdefault("missing_related_ids", []).append(target)
                    continue
                new_edges.append({"relation": relation, "node": node})
        record = records.setdefault(key, {"status": "ok", "media": metadata[key], "edges": []})
        signatures = {(edge["relation"], edge["node"]["mal_id"]) for edge in record["edges"]}
        for edge in new_edges:
            signature = (edge["relation"], edge["node"]["mal_id"])
            if signature not in signatures:
                record["edges"].append(edge)
                signatures.add(signature)
        record.update(source=raw.get("_source"), fetched_at=raw.get("_fetched_at"))
        for direction in ("prequels", "sequels"):
            known = {entry.get("mal_id") if isinstance(entry, dict) else entry for entry in previous[direction]}
            for entry in extracted[direction]:
                if entry["mal_id"] not in known:
                    previous[direction].append(entry)
            previous["source"] = raw.get("_source")

    candidate, _ = trees.build_public_payload(catalog, records)
    old_edges = edge_signature(old_timelines)
    new_edges = edge_signature(candidate["timelines"])
    old_continuity = {(a, b) for a, b, kind in old_edges if kind == "continuity"}
    new_continuity = {(a, b) for a, b, kind in new_edges if kind == "continuity"}
    if not old_edges.issubset(new_edges) or introduces_cycle(old_continuity, new_continuity):
        report["map_update"] = "kept_published_graph_conflict"
    else:
        candidate["source"] = "Published baseline + MAL relations via Tenrai/Jikan-Edge"
        trees.save_split_payload(candidate, root / "anime-timeline-index.json", root / "anime-timelines", 12)
        report["map_update"] = {"before_edges": len(old_edges), "after_edges": len(new_edges)}

    previous = read_json(root / "anime-relations.json")
    candidate_relations, _ = relations.build_public_payload(catalog, direct)
    old_pairs = {(int(key), target) for key, value in previous["relations"].items() for target in value["sequels"]}
    new_pairs = {(int(key), target) for key, value in candidate_relations["relations"].items() for target in value["sequels"]}
    if old_pairs.issubset(new_pairs) and not introduces_cycle(old_pairs, new_pairs):
        candidate_relations["sources"] = ["Published baseline", "MyAnimeList via Tenrai/Jikan-Edge"]
        atomic_json(root / "anime-relations.json", candidate_relations)
        report["relations_update"] = {"before_edges": len(old_pairs), "after_edges": len(new_pairs)}
    else:
        report["relations_update"] = "kept_published_navigation_conflict"


def build_upcoming_files(root, catalog, remote_items, years):
    """Keep announced titles absent from a provider; only confirmed status removes them."""
    root = Path(root)
    previous = {item["mal_id"]: item for item in read_json(root / "anime-upcoming.json", {}).get("items", [])}
    for path in root.glob("anime-upcoming*.full.json"):
        for item in read_json(path, {}).get("items", []):
            previous.setdefault(item["mal_id"], item)
    records = []
    for local in catalog:
        anime_id = local["mal_id"]
        if local.get("airing_status") != "Not yet aired" and anime_id not in previous:
            continue
        raw = remote_items.get(anime_id)
        record = upcoming.build_record(raw, None, [raw.get("_source", "unknown")]) if raw else copy.deepcopy(previous.get(anime_id, {}))
        record.update(local)
        release = date_value(local.get("aired_from"))
        year = int(release[:4]) if release else record.get("upcoming_year") or local.get("year")
        month = int(release[5:7]) if len(release) >= 7 else None
        record["upcoming_year"] = year
        record["upcoming_season"] = upcoming.season_from_month(month) if month else record.get("upcoming_season", "unknown")
        record["upcoming_season_label"] = upcoming.SEASON_LABELS.get(record["upcoming_season"], "Fecha indefinida")
        records.append(record)
    paths = []
    for offset, year in enumerate(years):
        selected = [item for item in records if item.get("upcoming_year") == year or (offset == 0 and not item.get("upcoming_year"))]
        path = root / f"anime-upcoming-{year}.full.json"
        atomic_json(path, {
            "meta": {"year": year, "generated_at": now(), "source": "Tenrai/Jikan-Edge + preserved catalogue", "total": len(selected)},
            "items": selected, "sections": upcoming.build_sections(selected),
            "section_labels": {season: f"{upcoming.SEASON_LABELS[season]} {year}" for season in upcoming.SEASONS},
        })
        paths.append(path.name)
    return paths
