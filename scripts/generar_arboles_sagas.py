#!/usr/bin/env python3
"""Genera el indice y los bloques web de arboles de continuidad y ramas.

La salida es independiente de anime-relations.json: las relaciones directas
siguen sirviendo para navegar rapido y este archivo describe el mapa completo
de una saga. AniList aporta tipos de relacion, fechas e informacion basica de
entradas que aun no formen parte del catalogo local.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import random
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "anime-lista.json"
DEFAULT_OUTPUT = ROOT / "anime-timelines.full.json"
DEFAULT_INDEX_OUTPUT = ROOT / "anime-timeline-index.json"
DEFAULT_DETAILS_DIR = ROOT / "anime-timelines"
DEFAULT_CACHE = ROOT / "cache" / "anime-timelines-cache.json"
DEFAULT_REPORT = ROOT / "cache" / "anime-timelines-report.json"
ANILIST_URL = "https://graphql.anilist.co"
ANILIST_PAGE_SIZE = 50
ANILIST_BATCH_SIZE = 1000
REQUEST_INTERVAL = 2.1
MAX_RETRIES = 4
TIMEOUT_SECONDS = 35
CACHE_SCHEMA = 1

CONTINUITY_RELATIONS = {"PREQUEL", "SEQUEL"}
BRANCH_RELATIONS = {
    "PARENT",
    "SIDE_STORY",
    "SPIN_OFF",
    "ALTERNATIVE",
    "SUMMARY",
    "COMPILATION",
    "CONTAINS",
}
RELEVANT_RELATIONS = CONTINUITY_RELATIONS | BRANCH_RELATIONS
SYMMETRIC_RELATIONS = {"ALTERNATIVE"}
BRANCH_PRIORITY = {
    "SIDE_STORY": 0,
    "SPIN_OFF": 1,
    "SUMMARY": 2,
    "ALTERNATIVE": 3,
    "COMPILATION": 4,
    "CONTAINS": 5,
    "PARENT": 6,
}

# AniList describe la relacion entre entradas, pero no expone un indicador
# universal de canon. Por eso solo las series evidentes forman la linea
# principal; peliculas, OVA y especiales se conservan como ramas. Estos sets
# permiten corregir casos verificados sin inventar canon por heuristicas.
MAIN_LINE_INCLUDE_IDS: set[int] = set()
MAIN_LINE_EXCLUDE_IDS: set[int] = set()
MAIN_SERIES_FORMATS = {"TV", "TV_SHORT", "ANIME"}
IGNORED_TIMELINE_FORMATS = {"MANGA", "NOVEL", "ONE_SHOT", "MUSIC", "PV", "CM"}


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def safe_int(value: Any) -> int | None:
    try:
        result = int(value)
        return result if result > 0 else None
    except (TypeError, ValueError):
        return None


def is_main_series_media(value: dict[str, Any]) -> bool:
    anime_id = safe_int(value.get("mal_id"))
    if anime_id in MAIN_LINE_INCLUDE_IDS:
        return True
    if anime_id in MAIN_LINE_EXCLUDE_IDS:
        return False

    media_format = str(value.get("format") or "").strip().upper()
    if media_format in MAIN_SERIES_FORMATS:
        return True
    if media_format != "ONA":
        return False

    episodes = safe_int(value.get("episodes")) or 0
    title = str(value.get("title") or "").casefold()
    season_markers = ("season", "temporada", "part ", "cour ")
    return episodes >= 4 or any(marker in title for marker in season_markers)


def is_ignored_timeline_media(value: dict[str, Any]) -> bool:
    media_format = str(value.get("format") or value.get("type") or "").strip().upper()
    return media_format in IGNORED_TIMELINE_FORMATS


def load_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, payload: Any, *, pretty: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(
            payload,
            handle,
            ensure_ascii=False,
            indent=2 if pretty else None,
            separators=None if pretty else (",", ":"),
        )
        handle.write("\n")
    temporary.replace(path)


def date_from_parts(value: Any, fallback_year: Any = None) -> str:
    value = value if isinstance(value, dict) else {}
    year = safe_int(value.get("year")) or safe_int(fallback_year)
    if not year:
        return ""
    month = safe_int(value.get("month"))
    day = safe_int(value.get("day"))
    if month and day:
        return f"{year:04d}-{month:02d}-{day:02d}"
    if month:
        return f"{year:04d}-{month:02d}"
    return str(year)


def normalize_media(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    mal_id = safe_int(value.get("idMal") or value.get("mal_id"))
    if not mal_id:
        return None
    titles = value.get("title") if isinstance(value.get("title"), dict) else {}
    title = str(titles.get("romaji") or value.get("title_romaji") or value.get("title") or "").strip()
    title_english = str(titles.get("english") or value.get("title_english") or "").strip()
    year = safe_int(value.get("seasonYear") or value.get("year"))
    release_date = date_from_parts(value.get("startDate"), year)
    if release_date and release_date[:4].isdigit():
        year = safe_int(release_date[:4]) or year
    cover = value.get("coverImage") if isinstance(value.get("coverImage"), dict) else {}
    image = str(cover.get("large") or cover.get("extraLarge") or value.get("image") or "").strip()
    return {
        "mal_id": mal_id,
        "anilist_id": safe_int(value.get("id") or value.get("anilist_id")),
        "title": title or title_english or f"Anime {mal_id}",
        "title_english": title_english,
        "media_type": str(value.get("type") or "").strip(),
        "format": str(value.get("format") or value.get("type") or "").strip(),
        "episodes": safe_int(value.get("episodes")),
        "year": year,
        "release_date": release_date,
        "image": image,
    }


def local_media(anime: dict[str, Any]) -> dict[str, Any] | None:
    mal_id = safe_int(anime.get("mal_id"))
    if not mal_id:
        return None
    aired_from = str(anime.get("aired_from") or "").strip()
    year = safe_int(anime.get("year"))
    if not aired_from and year:
        aired_from = str(year)
    return {
        "mal_id": mal_id,
        "anilist_id": None,
        "title": str(anime.get("title") or f"Anime {mal_id}"),
        "title_english": str(anime.get("title_english") or ""),
        "title_es": str(anime.get("title_es") or ""),
        "format": str(anime.get("type") or ""),
        "episodes": safe_int(anime.get("episodes")),
        "year": year,
        "release_date": aired_from,
        "image": str(anime.get("image") or ""),
        "local": True,
    }


class RequestPacer:
    def __init__(self, interval: float) -> None:
        self.interval = max(0.0, float(interval))
        self.last_request_at = 0.0

    def wait(self) -> None:
        remaining = self.interval - (time.monotonic() - self.last_request_at)
        if remaining > 0:
            time.sleep(remaining)
        self.last_request_at = time.monotonic()


def fetch_graphql(query: str, variables: dict[str, Any], pacer: RequestPacer) -> dict[str, Any]:
    body = json.dumps({"query": query, "variables": variables}, separators=(",", ":")).encode("utf-8")
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        pacer.wait()
        try:
            request = urllib.request.Request(
                ANILIST_URL,
                data=body,
                method="POST",
                headers={
                    "User-Agent": "NeoAnimeZ timeline generator/1.0 (+local script)",
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
            )
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if not isinstance(payload.get("data"), dict):
                message = "; ".join(
                    str(item.get("message") or item) for item in (payload.get("errors") or [])
                )
                raise RuntimeError(message or "AniList no devolvio datos.")
            return payload
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code not in {403, 429, 500, 502, 503, 504}:
                raise
            retry_after = error.headers.get("Retry-After")
            try:
                wait = float(retry_after) if retry_after else attempt * 2.0
            except ValueError:
                wait = attempt * 2.0
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, RuntimeError) as error:
            last_error = error
            wait = attempt * 2.0
        wait = min(45.0, wait + random.uniform(0.2, 0.8))
        print(f"[WARN] AniList intento {attempt}/{MAX_RETRIES}: {last_error}; espera {wait:.1f}s")
        time.sleep(wait)
    raise RuntimeError(f"No se pudo consultar AniList: {last_error}")


def media_fields() -> str:
    return """
      id
      idMal
      type
      format
      episodes
      seasonYear
      startDate { year month day }
      title { romaji english }
      coverImage { large }
    """


def build_query(item_count: int) -> str:
    page_count = max(1, (item_count + ANILIST_PAGE_SIZE - 1) // ANILIST_PAGE_SIZE)
    fields = []
    node_fields = media_fields()
    for page in range(1, page_count + 1):
        fields.append(
            f"""p{page}: Page(page: {page}, perPage: {ANILIST_PAGE_SIZE}) {{
              media(idMal_in: $ids, type: ANIME, sort: ID) {{
                {media_fields()}
                relations {{
                  edges {{
                    relationType
                    node {{ {node_fields} }}
                  }}
                }}
              }}
            }}"""
        )
    return "query ($ids: [Int]) {\n" + "\n".join(fields) + "\n}"


def fetch_batch(anime_ids: list[int], pacer: RequestPacer) -> dict[int, dict[str, Any]]:
    payload = fetch_graphql(build_query(len(anime_ids)), {"ids": anime_ids}, pacer)
    fetched_at = utc_now()
    media_by_id: dict[int, dict[str, Any]] = {}
    for page_payload in (payload.get("data") or {}).values():
        if not isinstance(page_payload, dict):
            continue
        for media in page_payload.get("media") or []:
            metadata = normalize_media(media)
            if metadata:
                media_by_id[metadata["mal_id"]] = media

    records: dict[int, dict[str, Any]] = {}
    for anime_id in anime_ids:
        media = media_by_id.get(anime_id)
        if not media:
            records[anime_id] = {
                "schema": CACHE_SCHEMA,
                "status": "not_found",
                "media": None,
                "edges": [],
                "fetched_at": fetched_at,
            }
            continue
        edges = []
        for edge in ((media.get("relations") or {}).get("edges") or []):
            relation = str(edge.get("relationType") or "").strip().upper()
            if relation not in RELEVANT_RELATIONS:
                continue
            raw_node = edge.get("node") or {}
            if str(raw_node.get("type") or "").strip().upper() != "ANIME":
                continue
            node = normalize_media(raw_node)
            if not node or node["mal_id"] == anime_id:
                continue
            edges.append({"relation": relation, "node": node})
        edges.sort(key=lambda item: (item["relation"], item["node"]["mal_id"]))
        records[anime_id] = {
            "schema": CACHE_SCHEMA,
            "status": "ok",
            "media": normalize_media(media),
            "edges": edges,
            "fetched_at": fetched_at,
        }
    return records


def should_refresh(record: Any, refresh_after_days: int) -> bool:
    if not isinstance(record, dict) or record.get("schema") != CACHE_SCHEMA:
        return True
    if record.get("status") not in {"ok", "not_found"}:
        return True
    if refresh_after_days < 0:
        return False
    try:
        fetched = dt.datetime.fromisoformat(str(record.get("fetched_at") or "").replace("Z", "+00:00"))
        return (dt.datetime.now(dt.timezone.utc) - fetched.astimezone(dt.timezone.utc)).days >= refresh_after_days
    except (TypeError, ValueError):
        return True


def release_key(anime_id: int, nodes: dict[int, dict[str, Any]]) -> tuple[int, int, int, int]:
    node = nodes.get(anime_id) or {}
    raw = str(node.get("release_date") or node.get("year") or "").strip()
    match = re.match(r"^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?", raw)
    if not match:
        return 9999, 99, 99, anime_id
    return (
        int(match.group(1)),
        int(match.group(2) or 99),
        int(match.group(3) or 99),
        anime_id,
    )


def normalize_graph_edge(
    source_id: int,
    target_id: int,
    relation: str,
    nodes: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    if relation == "SEQUEL":
        from_id, to_id, kind = source_id, target_id, "continuity"
    elif relation == "PREQUEL":
        from_id, to_id, kind = target_id, source_id, "continuity"
    elif relation == "PARENT":
        from_id, to_id, kind = target_id, source_id, "branch"
    elif relation in SYMMETRIC_RELATIONS:
        ordered = sorted((source_id, target_id), key=lambda item: release_key(item, nodes))
        from_id, to_id, kind = ordered[0], ordered[1], "branch"
    else:
        from_id, to_id, kind = source_id, target_id, "branch"
    return {"from": from_id, "to": to_id, "kind": kind, "relation": relation}


def compute_levels(component: set[int], edges: list[dict[str, Any]], nodes: dict[int, dict[str, Any]]) -> dict[int, int]:
    continuity = [edge for edge in edges if edge["kind"] == "continuity"]
    outgoing = {anime_id: set() for anime_id in component}
    indegree = {anime_id: 0 for anime_id in component}
    for edge in continuity:
        source_id, target_id = edge["from"], edge["to"]
        if target_id in outgoing[source_id]:
            continue
        outgoing[source_id].add(target_id)
        indegree[target_id] += 1

    levels = {anime_id: 0 for anime_id in component}
    available = sorted(
        (anime_id for anime_id in component if indegree[anime_id] == 0),
        key=lambda item: release_key(item, nodes),
    )
    processed: set[int] = set()
    while available:
        anime_id = available.pop(0)
        processed.add(anime_id)
        for target_id in sorted(outgoing[anime_id], key=lambda item: release_key(item, nodes)):
            levels[target_id] = max(levels[target_id], levels[anime_id] + 1)
            indegree[target_id] -= 1
            if indegree[target_id] == 0:
                available.append(target_id)
                available.sort(key=lambda item: release_key(item, nodes))

    if len(processed) != len(component):
        remaining = sorted(component - processed, key=lambda item: release_key(item, nodes))
        start_level = max(levels.values(), default=0)
        for offset, anime_id in enumerate(remaining, start=1):
            levels[anime_id] = start_level + offset

    for _ in range(3):
        changed = False
        for edge in edges:
            if edge["kind"] != "branch":
                continue
            suggested = levels[edge["from"]] + 1
            if levels[edge["to"]] < suggested and not outgoing[edge["to"]]:
                levels[edge["to"]] = suggested
                changed = True
        if not changed:
            break
    return levels


def build_public_payload(
    catalog: list[dict[str, Any]],
    records: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    local_nodes = {
        metadata["mal_id"]: metadata
        for anime in catalog
        if (metadata := local_media(anime)) is not None
    }
    local_ids = set(local_nodes)
    nodes: dict[int, dict[str, Any]] = {}

    for record in records.values():
        if not isinstance(record, dict) or record.get("status") != "ok":
            continue
        metadata = record.get("media")
        if isinstance(metadata, dict) and safe_int(metadata.get("mal_id")):
            nodes[int(metadata["mal_id"])] = dict(metadata)
        for edge in record.get("edges") or []:
            metadata = edge.get("node") if isinstance(edge, dict) else None
            if isinstance(metadata, dict) and safe_int(metadata.get("mal_id")):
                nodes[int(metadata["mal_id"])] = dict(metadata)

    for anime_id, metadata in local_nodes.items():
        remote = nodes.get(anime_id) or {}
        merged = dict(remote)
        for key, value in metadata.items():
            if value not in (None, "", []):
                merged[key] = value
        merged["local"] = True
        nodes[anime_id] = merged

    edge_map: dict[tuple[int, int, str], dict[str, Any]] = {}
    for source_key, record in records.items():
        source_id = safe_int(source_key)
        if not source_id or source_id not in nodes or not isinstance(record, dict):
            continue
        if is_ignored_timeline_media(nodes[source_id]):
            continue
        for raw_edge in record.get("edges") or []:
            relation = str((raw_edge or {}).get("relation") or "").upper()
            metadata = (raw_edge or {}).get("node") or {}
            target_id = safe_int(metadata.get("mal_id"))
            if relation not in RELEVANT_RELATIONS or not target_id or target_id not in nodes:
                continue
            if is_ignored_timeline_media(metadata) or is_ignored_timeline_media(nodes[target_id]):
                continue
            edge = normalize_graph_edge(source_id, target_id, relation, nodes)
            key = (edge["from"], edge["to"], edge["kind"])
            current = edge_map.get(key)
            if not current or BRANCH_PRIORITY.get(relation, -1) < BRANCH_PRIORITY.get(current["relation"], 99):
                edge_map[key] = edge

    edges = list(edge_map.values())
    neighbours: dict[int, set[int]] = {}
    for edge in edges:
        neighbours.setdefault(edge["from"], set()).add(edge["to"])
        neighbours.setdefault(edge["to"], set()).add(edge["from"])

    components: list[set[int]] = []
    pending = set(neighbours)
    while pending:
        start = min(pending)
        component: set[int] = set()
        stack = [start]
        while stack:
            anime_id = stack.pop()
            if anime_id in component:
                continue
            component.add(anime_id)
            pending.discard(anime_id)
            stack.extend(neighbours.get(anime_id, set()) - component)
        components.append(component)

    timelines: dict[str, Any] = {}
    navigation: dict[str, Any] = {}
    public_nodes: dict[str, Any] = {}
    skipped_small = 0
    accepted_local_ids: set[int] = set()
    max_nodes = 0

    for component in sorted(components, key=lambda item: min(item)):
        component_local = component & local_ids
        component_edges = [
            edge for edge in edges if edge["from"] in component and edge["to"] in component
        ]
        continuity_edges = [edge for edge in component_edges if edge["kind"] == "continuity"]
        if not component_local or len(component) < 3 or not continuity_edges:
            skipped_small += 1
            continue
        timeline_id = min(component_local)
        levels = compute_levels(component, component_edges, nodes)
        continuity_nodes = {
            anime_id
            for edge in continuity_edges
            for anime_id in (edge["from"], edge["to"])
        }
        ordered_nodes = sorted(
            component,
            key=lambda anime_id: (
                release_key(anime_id, nodes),
                anime_id not in continuity_nodes,
                levels.get(anime_id, 0),
            ),
        )
        incoming_continuity = {anime_id: 0 for anime_id in component}
        for edge in continuity_edges:
            incoming_continuity[edge["to"]] += 1
        roots = sorted(
            (anime_id for anime_id in continuity_nodes if incoming_continuity[anime_id] == 0),
            key=lambda anime_id: release_key(anime_id, nodes),
        )
        has_routes = any(
            sum(1 for edge in continuity_edges if edge["from"] == anime_id) > 1
            or sum(1 for edge in continuity_edges if edge["to"] == anime_id) > 1
            for anime_id in continuity_nodes
        )
        timelines[str(timeline_id)] = {
            "nodes": ordered_nodes,
            "edges": sorted(
                component_edges,
                key=lambda edge: (
                    release_key(edge["from"], nodes),
                    release_key(edge["to"], nodes),
                    edge["kind"],
                    edge["from"],
                    edge["to"],
                ),
            ),
            "roots": roots,
            "levels": {str(anime_id): levels.get(anime_id, 0) for anime_id in ordered_nodes},
            "has_routes": has_routes,
            "has_secondary": any(edge["kind"] == "branch" for edge in component_edges),
        }
        for anime_id in component:
            navigation[str(anime_id)] = {"timeline_id": timeline_id}
            node = dict(nodes[anime_id])
            node["local"] = anime_id in local_ids
            node["role"] = (
                "continuity"
                if anime_id in continuity_nodes and is_main_series_media(node)
                else "secondary"
            )
            public_nodes[str(anime_id)] = node
        accepted_local_ids.update(component_local)
        max_nodes = max(max_nodes, len(component))

    generated_at = utc_now()
    payload = {
        "version": 2,
        "generated_at": generated_at,
        "source": "AniList GraphQL Media.relations",
        "timeline_count": len(timelines),
        "anime_with_timeline": len(accepted_local_ids),
        "nodes": public_nodes,
        "timelines": timelines,
        "navigation": navigation,
    }
    report = {
        "generated_at": generated_at,
        "catalog_count": len(local_ids),
        "cached_records": len(records),
        "timeline_count": len(timelines),
        "anime_with_timeline": len(accepted_local_ids),
        "public_nodes": len(public_nodes),
        "external_nodes": sum(1 for node in public_nodes.values() if not node.get("local")),
        "continuity_edges": sum(
            1 for timeline in timelines.values() for edge in timeline["edges"] if edge["kind"] == "continuity"
        ),
        "secondary_edges": sum(
            1 for timeline in timelines.values() for edge in timeline["edges"] if edge["kind"] == "branch"
        ),
        "max_nodes_in_timeline": max_nodes,
        "skipped_components": skipped_small,
    }
    return payload, report


def save_split_payload(
    payload: dict[str, Any],
    index_path: Path,
    details_dir: Path,
    block_count: int,
) -> None:
    block_count = max(1, int(block_count))
    details_dir.mkdir(parents=True, exist_ok=True)
    for stale in details_dir.glob("*.json"):
        stale.unlink()

    timelines = payload.get("timelines") or {}
    nodes = payload.get("nodes") or {}
    navigation = payload.get("navigation") or {}
    blocks: list[dict[str, Any]] = [
        {"timelines": {}, "nodes": {}} for _ in range(block_count)
    ]
    timeline_blocks: dict[str, int] = {}

    for timeline_id, timeline in timelines.items():
        block_index = int(timeline_id) % block_count
        timeline_blocks[timeline_id] = block_index
        block = blocks[block_index]
        block["timelines"][timeline_id] = timeline
        for anime_id in timeline.get("nodes") or []:
            node = nodes.get(str(anime_id))
            if node:
                block["nodes"][str(anime_id)] = node

    public_navigation: dict[str, Any] = {}
    for anime_id, value in navigation.items():
        node = nodes.get(str(anime_id)) or {}
        timeline_id = str((value or {}).get("timeline_id") or "")
        if not node.get("local") or timeline_id not in timeline_blocks:
            continue
        public_navigation[str(anime_id)] = [int(timeline_id), timeline_blocks[timeline_id]]

    for block_index, block in enumerate(blocks):
        save_json(
            details_dir / f"timeline-{block_index:02d}.json",
            {
                "version": payload.get("version"),
                "generated_at": payload.get("generated_at"),
                "timelines": block["timelines"],
                "nodes": block["nodes"],
            },
        )

    save_json(
        index_path,
        {
            "version": payload.get("version"),
            "generated_at": payload.get("generated_at"),
            "timeline_count": payload.get("timeline_count"),
            "anime_with_timeline": payload.get("anime_with_timeline"),
            "files": [f"anime-timelines/timeline-{index:02d}.json" for index in range(block_count)],
            "navigation": public_navigation,
        },
    )


def fetch_and_store(
    anime_ids: list[int],
    records: dict[str, Any],
    cache_path: Path,
    pacer: RequestPacer,
    batch_size: int,
) -> None:
    for start in range(0, len(anime_ids), batch_size):
        batch = anime_ids[start:start + batch_size]
        print(f"[INFO] AniList {start + 1}-{start + len(batch)} de {len(anime_ids)}")
        fetched = fetch_batch(batch, pacer)
        for anime_id, record in fetched.items():
            records[str(anime_id)] = record
        save_json(
            cache_path,
            {"version": CACHE_SCHEMA, "updated_at": utc_now(), "items": records},
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Genera arboles cronologicos de sagas para NeoAnimeZ.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--index-output", type=Path, default=DEFAULT_INDEX_OUTPUT)
    parser.add_argument("--details-dir", type=Path, default=DEFAULT_DETAILS_DIR)
    parser.add_argument("--blocks", type=int, default=12)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--batch-size", type=int, default=ANILIST_BATCH_SIZE)
    parser.add_argument("--delay", type=float, default=REQUEST_INTERVAL)
    parser.add_argument("--expand-depth", type=int, default=1)
    parser.add_argument("--refresh-after-days", type=int, default=180)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    catalog = load_json(args.input)
    if not isinstance(catalog, list):
        raise ValueError(f"{args.input} debe contener una lista.")
    cache_payload = load_json(args.cache, default={}) or {}
    records = cache_payload.get("items") if isinstance(cache_payload, dict) else {}
    records = records if isinstance(records, dict) else {}
    local_ids = sorted(
        anime_id
        for anime in catalog
        if (anime_id := safe_int(anime.get("mal_id"))) is not None
    )
    pacer = RequestPacer(args.delay)
    to_fetch = [
        anime_id
        for anime_id in local_ids
        if args.force or should_refresh(records.get(str(anime_id)), args.refresh_after_days)
    ]
    print(f"[INFO] Catalogo local: {len(local_ids)}")
    print(f"[INFO] Consultas locales pendientes: {len(to_fetch)}")
    if to_fetch:
        fetch_and_store(to_fetch, records, args.cache, pacer, max(1, args.batch_size))

    frontier = set(local_ids)
    known = set(local_ids)
    for depth in range(max(0, args.expand_depth)):
        discovered: set[int] = set()
        for anime_id in frontier:
            record = records.get(str(anime_id)) or {}
            for edge in record.get("edges") or []:
                relation = str((edge or {}).get("relation") or "").upper()
                target_id = safe_int((((edge or {}).get("node") or {}).get("mal_id")))
                if relation in RELEVANT_RELATIONS and target_id and target_id not in known:
                    discovered.add(target_id)
        if not discovered:
            break
        pending = sorted(
            anime_id
            for anime_id in discovered
            if args.force or should_refresh(records.get(str(anime_id)), args.refresh_after_days)
        )
        print(
            f"[INFO] Expansion {depth + 1}: {len(discovered)} relacionados; "
            f"{len(pending)} consultas pendientes"
        )
        if pending:
            fetch_and_store(pending, records, args.cache, pacer, max(1, args.batch_size))
        known.update(discovered)
        frontier = discovered

    payload, report = build_public_payload(catalog, records)
    save_json(args.output, payload, pretty=args.pretty)
    save_split_payload(payload, args.index_output, args.details_dir, args.blocks)
    save_json(args.report, report, pretty=True)
    save_json(
        args.cache,
        {"version": CACHE_SCHEMA, "updated_at": utc_now(), "items": records},
    )
    print("\n[OK] Arboles de saga generados")
    print(f"[OK] Salida: {args.output}")
    print(f"[OK] Indice web: {args.index_output}")
    print(f"[OK] Bloques web: {args.details_dir} ({max(1, args.blocks)} archivos)")
    print(f"[OK] Sagas: {payload['timeline_count']}")
    print(f"[OK] Anime local con arbol: {payload['anime_with_timeline']}")
    print(f"[OK] Nodos externos informativos: {report['external_nodes']}")
    print(f"[OK] Arbol mas grande: {report['max_nodes_in_timeline']} nodos")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
