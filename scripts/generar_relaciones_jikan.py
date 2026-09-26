#!/usr/bin/env python3
"""Genera relaciones y orden narrativo para el catalogo.

AniList se consulta por lotes usando los ids de MyAnimeList del catalogo. Jikan
queda disponible como alternativa individual y una semilla CC0 permite arrancar
incluso durante una caida de ambas APIs. El proceso guarda una cache reanudable.
El JSON publico solo contiene ids presentes en anime-lista.json, por lo que cada
destino siempre puede abrirse dentro de NeoAnimeZ. Ademas de las relaciones
directas, normaliza los enlaces Prequel/Sequel y elimina atajos transitivos.
Por ejemplo, si la fuente declara A -> C pero tambien A -> B -> C, la salida
publica conserva los pasos A -> B -> C para no saltarse entregas ni spoilers.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import heapq
import io
import json
import random
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "anime-lista.json"
DEFAULT_OUTPUT = ROOT / "anime-relations.json"
DEFAULT_CACHE = ROOT / "cache" / "anime-relations-cache.json"
DEFAULT_REPORT = ROOT / "cache" / "anime-relations-report.json"
JIKAN_BASE = "https://api.jikan.moe/v4"
ANILIST_URL = "https://graphql.anilist.co"
JIKAN_REQUEST_INTERVAL = 1.1
# AniList anuncia temporalmente 30 solicitudes/minuto. Cada solicitud contiene
# muchos animes, asi que este ritmo sigue siendo rapido y respeta el limite.
ANILIST_REQUEST_INTERVAL = 2.1
ANILIST_PAGE_SIZE = 50
ANILIST_BATCH_SIZE = 1000
MAX_RETRIES = 4
TIMEOUT_SECONDS = 30
KAGGLE_SEED_DATE = "2022-03-27T00:47:58+00:00"
KAGGLE_SEED_SOURCE = "kaggle_svanoo_mal_2022"
ANILIST_SOURCE = "anilist_graphql"


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


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
            sort_keys=False,
        )
        handle.write("\n")
    temporary.replace(path)


def safe_int(value: Any) -> int | None:
    try:
        result = int(value)
        return result if result > 0 else None
    except (TypeError, ValueError):
        return None


class RequestPacer:
    def __init__(self, interval: float) -> None:
        self.interval = max(0.0, float(interval))
        self.last_request_at = 0.0

    def wait(self) -> None:
        elapsed = time.monotonic() - self.last_request_at
        remaining = self.interval - elapsed
        if remaining > 0:
            time.sleep(remaining)
        self.last_request_at = time.monotonic()


def fetch_json(url: str, pacer: RequestPacer) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        pacer.wait()
        try:
            request = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "NeoAnimeZ relation generator/1.0 (+local script)",
                    "Accept": "application/json",
                },
            )
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            last_error = error
            if error.code == 404:
                raise
            if error.code not in {429, 500, 502, 503, 504}:
                raise
            retry_after = error.headers.get("Retry-After")
            try:
                wait = float(retry_after) if retry_after else attempt * 1.5
            except ValueError:
                wait = attempt * 1.5
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            last_error = error
            wait = attempt * 1.5

        wait = min(20.0, wait + random.uniform(0.15, 0.65))
        print(f"[WARN] {url} intento {attempt}/{MAX_RETRIES}: {last_error}; espera {wait:.1f}s")
        time.sleep(wait)

    raise RuntimeError(f"No se pudo descargar {url}: {last_error}")


def fetch_graphql(
    query: str,
    pacer: RequestPacer,
    variables: dict[str, Any] | None = None,
) -> dict[str, Any]:
    body = json.dumps(
        {"query": query, "variables": variables or {}},
        separators=(",", ":"),
    ).encode("utf-8")
    last_error: Exception | None = None

    for attempt in range(1, MAX_RETRIES + 1):
        pacer.wait()
        try:
            request = urllib.request.Request(
                ANILIST_URL,
                data=body,
                method="POST",
                headers={
                    "User-Agent": "NeoAnimeZ relation generator/1.1 (+local script)",
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
            )
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if not isinstance(payload.get("data"), dict):
                errors = payload.get("errors") or []
                message = "; ".join(str(item.get("message") or item) for item in errors)
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


def build_anilist_query(item_count: int) -> str:
    page_count = max(1, (item_count + ANILIST_PAGE_SIZE - 1) // ANILIST_PAGE_SIZE)
    fields = []
    for page in range(1, page_count + 1):
        fields.append(
            f"""p{page}: Page(page: {page}, perPage: {ANILIST_PAGE_SIZE}) {{
              media(idMal_in: $ids, type: ANIME, sort: ID) {{
                idMal
                relations {{
                  edges {{
                    relationType
                    node {{ idMal type title {{ romaji }} }}
                  }}
                }}
              }}
            }}"""
        )
    return "query ($ids: [Int]) {\n" + "\n".join(fields) + "\n}"


def fetch_anilist_batch(anime_ids: list[int], pacer: RequestPacer) -> dict[int, dict[str, Any]]:
    payload = fetch_graphql(
        build_anilist_query(len(anime_ids)),
        pacer,
        {"ids": anime_ids},
    )
    data = payload.get("data") or {}
    fetched_at = utc_now()
    records: dict[int, dict[str, Any]] = {}
    media_by_mal_id: dict[int, dict[str, Any]] = {}

    for page_payload in data.values():
        if not isinstance(page_payload, dict):
            continue
        for media in page_payload.get("media") or []:
            media_id = safe_int((media or {}).get("idMal"))
            if media_id:
                media_by_mal_id[media_id] = media

    for anime_id in anime_ids:
        media = media_by_mal_id.get(anime_id)
        if not isinstance(media, dict):
            records[anime_id] = {
                "status": "not_found",
                "source": ANILIST_SOURCE,
                "prequels": [],
                "sequels": [],
                "fetched_at": fetched_at,
            }
            continue

        relations: dict[str, dict[int, str]] = {"prequels": {}, "sequels": {}}
        edges = ((media.get("relations") or {}).get("edges") or [])
        for edge in edges:
            relation_type = str(edge.get("relationType") or "").strip().upper()
            if relation_type == "PREQUEL":
                key = "prequels"
            elif relation_type == "SEQUEL":
                key = "sequels"
            else:
                continue
            node = edge.get("node") or {}
            if str(node.get("type") or "").strip().upper() != "ANIME":
                continue
            target_id = safe_int(node.get("idMal"))
            if not target_id or target_id == anime_id:
                continue
            title = str(((node.get("title") or {}).get("romaji")) or "").strip()
            relations[key][target_id] = title

        records[anime_id] = {
            "status": "ok",
            "source": ANILIST_SOURCE,
            "prequels": [
                {"mal_id": target_id, "title": title}
                for target_id, title in sorted(relations["prequels"].items())
            ],
            "sequels": [
                {"mal_id": target_id, "title": title}
                for target_id, title in sorted(relations["sequels"].items())
            ],
            "fetched_at": fetched_at,
        }

    return records


def relation_entries(payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = payload.get("data")
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("relations") or []
    return []


def extract_relations(payload: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    output: dict[str, list[dict[str, Any]]] = {"prequels": [], "sequels": []}
    seen: dict[str, set[int]] = {"prequels": set(), "sequels": set()}

    for relation in relation_entries(payload):
        relation_name = str(relation.get("relation") or "").strip().casefold()
        if relation_name == "prequel":
            key = "prequels"
        elif relation_name == "sequel":
            key = "sequels"
        else:
            continue

        for entry in relation.get("entry") or []:
            if str(entry.get("type") or "").strip().casefold() != "anime":
                continue
            target_id = safe_int(entry.get("mal_id"))
            if not target_id or target_id in seen[key]:
                continue
            seen[key].add(target_id)
            output[key].append(
                {
                    "mal_id": target_id,
                    "title": str(entry.get("name") or "").strip(),
                }
            )

    for key in output:
        output[key].sort(key=lambda item: item["mal_id"])
    return output


def fetch_anime_relations(anime_id: int, pacer: RequestPacer) -> tuple[dict[str, Any], str]:
    relations_url = f"{JIKAN_BASE}/anime/{anime_id}/relations"
    try:
        return fetch_json(relations_url, pacer), "relations"
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return {"data": []}, "not_found"
        raise
    except RuntimeError as relation_error:
        print(f"[WARN] mal_id={anime_id}: relations fallo; probando /full ({relation_error})")

    full_url = f"{JIKAN_BASE}/anime/{anime_id}/full"
    try:
        return fetch_json(full_url, pacer), "full"
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return {"data": []}, "not_found"
        raise


def cache_items(cache: Any) -> dict[str, Any]:
    if not isinstance(cache, dict):
        return {}
    items = cache.get("items")
    if isinstance(items, dict):
        return items
    # Compatibilidad con una cache inicial sin envoltorio.
    return {key: value for key, value in cache.items() if str(key).isdigit()}


def open_seed_table(path: Path) -> tuple[io.TextIOBase, zipfile.ZipFile | None]:
    if path.suffix.casefold() == ".zip":
        archive = zipfile.ZipFile(path)
        members = [name for name in archive.namelist() if not name.endswith("/")]
        if not members:
            archive.close()
            raise ValueError(f"{path} no contiene ningun archivo.")
        stream = io.TextIOWrapper(archive.open(members[0]), encoding="utf-8-sig", newline="")
        return stream, archive
    return path.open("r", encoding="utf-8-sig", newline=""), None


def import_kaggle_seed(
    catalog: list[dict[str, Any]],
    cached: dict[str, Any],
    anime_archive: Path,
    relations_archive: Path,
    *,
    force: bool = False,
) -> dict[str, int]:
    if not anime_archive.exists():
        raise FileNotFoundError(anime_archive)
    if not relations_archive.exists():
        raise FileNotFoundError(relations_archive)

    catalog_by_id = {
        anime_id: anime
        for anime in catalog
        if (anime_id := safe_int(anime.get("mal_id"))) is not None
    }

    anime_stream, anime_zip = open_seed_table(anime_archive)
    try:
        dataset_ids = {
            anime_id
            for row in csv.DictReader(anime_stream, delimiter="\t")
            if (anime_id := safe_int(row.get("anime_id"))) is not None
        }
    finally:
        anime_stream.close()
        if anime_zip:
            anime_zip.close()

    seeded_ids = sorted(set(catalog_by_id) & dataset_ids)
    relation_map: dict[int, dict[str, dict[int, str]]] = {
        anime_id: {"prequels": {}, "sequels": {}} for anime_id in seeded_ids
    }

    relation_stream, relation_zip = open_seed_table(relations_archive)
    try:
        for row in csv.DictReader(relation_stream, delimiter="\t"):
            if str(row.get("related") or "").strip() not in {"1", "1.0", "true", "True"}:
                continue
            relation_name = str(row.get("relation_type") or "").strip().casefold()
            if relation_name == "prequel":
                key = "prequels"
            elif relation_name == "sequel":
                key = "sequels"
            else:
                continue
            source_id = safe_int(row.get("animeA"))
            target_id = safe_int(row.get("animeB"))
            if source_id not in relation_map or not target_id or source_id == target_id:
                continue
            target = catalog_by_id.get(target_id) or {}
            relation_map[source_id][key][target_id] = str(target.get("title") or "")
    finally:
        relation_stream.close()
        if relation_zip:
            relation_zip.close()

    imported = 0
    preserved = 0
    links = 0
    for anime_id in seeded_ids:
        existing = cached.get(str(anime_id)) or {}
        if not force and existing.get("status") in {"ok", "not_found"} and existing.get("source") != KAGGLE_SEED_SOURCE:
            preserved += 1
            continue
        parsed = relation_map[anime_id]
        prequels = [
            {"mal_id": target_id, "title": title}
            for target_id, title in sorted(parsed["prequels"].items())
        ]
        sequels = [
            {"mal_id": target_id, "title": title}
            for target_id, title in sorted(parsed["sequels"].items())
        ]
        cached[str(anime_id)] = {
            "status": "ok",
            "source": KAGGLE_SEED_SOURCE,
            "prequels": prequels,
            "sequels": sequels,
            "fetched_at": KAGGLE_SEED_DATE,
        }
        imported += 1
        links += len(prequels) + len(sequels)

    return {
        "dataset_ids": len(dataset_ids),
        "catalog_covered": len(seeded_ids),
        "imported": imported,
        "preserved": preserved,
        "links": links,
    }


def should_refresh(record: Any, refresh_after_days: int) -> bool:
    if not isinstance(record, dict) or record.get("status") not in {"ok", "not_found"}:
        return True
    if refresh_after_days < 0:
        return False
    fetched_at = str(record.get("fetched_at") or "")
    try:
        fetched = dt.datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
        age = dt.datetime.now(dt.timezone.utc) - fetched.astimezone(dt.timezone.utc)
        return age.days >= refresh_after_days
    except (TypeError, ValueError):
        return True


def release_sort_key(anime_id: int, catalog_by_id: dict[int, dict[str, Any]]) -> tuple[int, str, int]:
    anime = catalog_by_id.get(anime_id) or {}
    year = safe_int(anime.get("year")) or 9999
    aired_from = str(anime.get("aired_from") or "").strip()
    if len(aired_from) < 10 or not aired_from[:4].isdigit():
        aired_from = f"{year:04d}-99-99"
    return year, aired_from, anime_id


def has_directed_path(
    start_id: int,
    target_id: int,
    outgoing: dict[int, set[int]],
) -> bool:
    """Indica si target_id es alcanzable sin modificar el grafo."""
    pending = list(outgoing.get(start_id, set()))
    visited = {start_id}
    while pending:
        anime_id = pending.pop()
        if anime_id == target_id:
            return True
        if anime_id in visited:
            continue
        visited.add(anime_id)
        pending.extend(outgoing.get(anime_id, set()) - visited)
    return False


def reduce_watch_order_edges(
    edges: set[tuple[int, int]],
    catalog_by_id: dict[int, dict[str, Any]],
) -> tuple[set[tuple[int, int]], list[tuple[int, int]], int]:
    """Elimina saltos transitivos sin tocar enlaces que formen ciclos.

    Las relaciones Prequel/Sequel de MAL pueden incluir a la vez una entrega
    inmediata y otra posterior. La reduccion conserva bifurcaciones reales,
    pero evita que Antes/Despues permita saltarse una entrega intermedia.
    """
    outgoing: dict[int, set[int]] = {anime_id: set() for anime_id in catalog_by_id}
    for source_id, target_id in edges:
        outgoing.setdefault(source_id, set()).add(target_id)
        outgoing.setdefault(target_id, set())

    reduced = set(edges)
    removed: list[tuple[int, int]] = []
    cyclic_edges = 0
    ordered_edges = sorted(
        edges,
        key=lambda edge: (
            release_sort_key(edge[0], catalog_by_id),
            release_sort_key(edge[1], catalog_by_id),
        ),
    )
    for source_id, target_id in ordered_edges:
        # Una arista dentro de un ciclo no tiene una reduccion transitiva unica.
        if has_directed_path(target_id, source_id, outgoing):
            cyclic_edges += 1
            continue
        outgoing[source_id].discard(target_id)
        if has_directed_path(source_id, target_id, outgoing):
            reduced.discard((source_id, target_id))
            removed.append((source_id, target_id))
        else:
            outgoing[source_id].add(target_id)

    return reduced, removed, cyclic_edges


def build_series_navigation(
    catalog_by_id: dict[int, dict[str, Any]],
    compact_relations: dict[str, dict[str, list[int]]],
) -> tuple[dict[str, Any], dict[str, Any], dict[str, int]]:
    related_ids = {int(anime_id) for anime_id in compact_relations}
    outgoing: dict[int, set[int]] = {anime_id: set() for anime_id in related_ids}
    incoming: dict[int, set[int]] = {anime_id: set() for anime_id in related_ids}
    neighbours: dict[int, set[int]] = {anime_id: set() for anime_id in related_ids}

    for anime_id in related_ids:
        relation = compact_relations[str(anime_id)]
        for sequel_id in relation["sequels"]:
            if sequel_id not in related_ids:
                continue
            outgoing[anime_id].add(sequel_id)
            incoming[sequel_id].add(anime_id)
            neighbours[anime_id].add(sequel_id)
            neighbours[sequel_id].add(anime_id)

    components: list[set[int]] = []
    pending = set(related_ids)
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
            stack.extend(neighbours[anime_id] - component)
        components.append(component)

    series: dict[str, Any] = {}
    navigation: dict[str, Any] = {}
    branched_count = 0
    cyclic_count = 0

    for component in sorted(components, key=lambda item: min(item)):
        series_id = min(component)
        indegree = {
            anime_id: len(incoming[anime_id] & component)
            for anime_id in component
        }
        original_indegree = dict(indegree)
        available: list[tuple[tuple[int, str, int], int]] = []
        for anime_id in component:
            if indegree[anime_id] == 0:
                heapq.heappush(available, (release_sort_key(anime_id, catalog_by_id), anime_id))

        ordered: list[int] = []
        while available:
            _, anime_id = heapq.heappop(available)
            ordered.append(anime_id)
            for sequel_id in outgoing[anime_id] & component:
                indegree[sequel_id] -= 1
                if indegree[sequel_id] == 0:
                    heapq.heappush(
                        available,
                        (release_sort_key(sequel_id, catalog_by_id), sequel_id),
                    )

        has_cycle = len(ordered) != len(component)
        if has_cycle:
            cyclic_count += 1
            ordered.extend(
                sorted(component - set(ordered), key=lambda item: release_sort_key(item, catalog_by_id))
            )

        has_branches = any(
            len(outgoing[anime_id] & component) > 1
            or len(incoming[anime_id] & component) > 1
            for anime_id in component
        )
        if has_branches:
            branched_count += 1

        roots = sorted(
            (anime_id for anime_id in component if original_indegree[anime_id] == 0),
            key=lambda item: release_sort_key(item, catalog_by_id),
        )
        series[str(series_id)] = {
            "entries": ordered,
            "roots": roots,
            "has_branches": has_branches,
            "has_cycle": has_cycle,
        }
        for index, anime_id in enumerate(ordered, start=1):
            relation = compact_relations[str(anime_id)]
            navigation[str(anime_id)] = {
                "series_id": series_id,
                "order_index": index,
                "previous": relation["prequels"],
                "next": relation["sequels"],
            }

    stats = {
        "series_count": len(series),
        "branched_series": branched_count,
        "cyclic_series": cyclic_count,
    }
    return series, navigation, stats


def build_public_payload(
    catalog: list[dict[str, Any]],
    cached: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    catalog_by_id = {
        anime_id: anime
        for anime in catalog
        if (anime_id := safe_int(anime.get("mal_id"))) is not None
    }
    local_ids = {
        anime_id for anime_id in catalog_by_id
    }
    direct_edges: set[tuple[int, int]] = set()
    unavailable: list[dict[str, Any]] = []
    direct_links = 0

    for source_id in sorted(local_ids):
        record = cached.get(str(source_id)) or {}
        if record.get("status") not in {"ok", "not_found"}:
            continue
        for key in ("prequels", "sequels"):
            for target in record.get(key) or []:
                target_id = safe_int(target.get("mal_id") if isinstance(target, dict) else target)
                if not target_id or target_id == source_id:
                    continue
                if target_id not in local_ids:
                    unavailable.append(
                        {
                            "source_id": source_id,
                            "relation": key,
                            "target_id": target_id,
                            "target_title": target.get("title", "") if isinstance(target, dict) else "",
                        }
                    )
                    continue
                if key == "prequels":
                    direct_edges.add((target_id, source_id))
                else:
                    direct_edges.add((source_id, target_id))
                direct_links += 1

    reduced_edges, removed_shortcuts, cyclic_edges = reduce_watch_order_edges(
        direct_edges,
        catalog_by_id,
    )
    relations: dict[int, dict[str, set[int]]] = {
        anime_id: {"prequels": set(), "sequels": set()} for anime_id in local_ids
    }
    for source_id, target_id in reduced_edges:
        relations[source_id]["sequels"].add(target_id)
        relations[target_id]["prequels"].add(source_id)

    compact_relations: dict[str, dict[str, list[int]]] = {}
    total_links = 0
    for anime_id in sorted(local_ids):
        prequels = sorted(
            relations[anime_id]["prequels"],
            key=lambda item: release_sort_key(item, catalog_by_id),
        )
        sequels = sorted(
            relations[anime_id]["sequels"],
            key=lambda item: release_sort_key(item, catalog_by_id),
        )
        if not prequels and not sequels:
            continue
        compact_relations[str(anime_id)] = {
            "prequels": prequels,
            "sequels": sequels,
        }
        total_links += len(prequels) + len(sequels)

    series, navigation, series_stats = build_series_navigation(catalog_by_id, compact_relations)

    fetched_ok = sum(
        1
        for anime_id in local_ids
        if (cached.get(str(anime_id)) or {}).get("status") in {"ok", "not_found"}
    )
    errors = [
        {
            "mal_id": anime_id,
            "error": (cached.get(str(anime_id)) or {}).get("error", "sin consultar"),
        }
        for anime_id in sorted(local_ids)
        if (cached.get(str(anime_id)) or {}).get("status") not in {"ok", "not_found"}
    ]
    source_counts: dict[str, int] = {}
    for anime_id in local_ids:
        source = str((cached.get(str(anime_id)) or {}).get("source") or "pending")
        source_counts[source] = source_counts.get(source, 0) + 1

    generated_at = utc_now()
    public_payload = {
        "version": 3,
        "generated_at": generated_at,
        "sources": [
            "AniList GraphQL Media.relations",
            "Jikan /anime/{mal_id}/relations",
            "Kaggle svanoo MyAnimeList relations (CC0, 2022 seed)",
        ],
        "catalog_count": len(local_ids),
        "anime_with_relations": len(compact_relations),
        "series_count": series_stats["series_count"],
        "watch_order": {
            "strategy": "prequel_sequel_transitive_reduction",
            "direct_source_links": direct_links,
            "unique_source_edges": len(direct_edges),
            "narrative_edges": len(reduced_edges),
            "removed_shortcuts": len(removed_shortcuts),
        },
        "relations": compact_relations,
        "series": series,
        "navigation": navigation,
    }
    report = {
        "generated_at": generated_at,
        "catalog_count": len(local_ids),
        "fetched_ok": fetched_ok,
        "pending_or_errors": len(errors),
        "anime_with_relations": len(compact_relations),
        "direct_available_links": direct_links,
        "unique_direct_edges": len(direct_edges),
        "removed_transitive_shortcuts": len(removed_shortcuts),
        "cyclic_edges_preserved": cyclic_edges,
        "public_directional_links": total_links,
        **series_stats,
        "unavailable_target_links": len(unavailable),
        "unavailable_targets": unavailable,
        "errors": errors,
        "cache_sources": dict(sorted(source_counts.items())),
    }
    return public_payload, report


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Genera anime-relations.json con continuidad y orden de saga desde AniList o Jikan."
    )
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument(
        "--provider",
        choices=("anilist", "jikan"),
        default="anilist",
        help="Proveedor remoto. AniList permite consultar el catalogo por lotes.",
    )
    parser.add_argument("--delay", type=float, default=None)
    parser.add_argument("--batch-size", type=int, default=ANILIST_BATCH_SIZE)
    parser.add_argument(
        "--refresh-after-days",
        type=int,
        default=180,
        help="Refresca relaciones con esta antiguedad; -1 conserva toda la cache.",
    )
    parser.add_argument("--max-items", type=int, default=None, help="Limita las consultas nuevas para pruebas.")
    parser.add_argument("--ids", nargs="*", type=int, help="Procesa solo estos mal_id.")
    parser.add_argument("--force", action="store_true", help="Ignora la cache de los ids procesados.")
    parser.add_argument("--pretty", action="store_true", help="Formatea el JSON publico.")
    parser.add_argument("--seed-anime-archive", type=Path, help="anime.csv o su ZIP de la semilla Kaggle.")
    parser.add_argument("--seed-relations-archive", type=Path, help="anime_anime.csv o su ZIP de la semilla Kaggle.")
    parser.add_argument("--force-seed", action="store_true", help="Sobrescribe incluso resultados Jikan con la semilla.")
    parser.add_argument("--seed-only", action="store_true", help="Importa la semilla y genera la salida sin consultar Jikan.")
    args = parser.parse_args()

    catalog = load_json(args.input)
    if not isinstance(catalog, list):
        raise ValueError(f"{args.input} debe contener una lista.")

    cache_payload = load_json(args.cache, default={})
    cached = cache_items(cache_payload)
    if bool(args.seed_anime_archive) != bool(args.seed_relations_archive):
        raise ValueError("Debes indicar juntos --seed-anime-archive y --seed-relations-archive.")
    if args.seed_anime_archive and args.seed_relations_archive:
        seed_stats = import_kaggle_seed(
            catalog,
            cached,
            args.seed_anime_archive,
            args.seed_relations_archive,
            force=args.force_seed,
        )
        print(
            "[INFO] Semilla Kaggle: "
            f"{seed_stats['catalog_covered']} animes cubiertos, "
            f"{seed_stats['links']} enlaces, {seed_stats['preserved']} resultados actuales preservados"
        )
    all_ids = sorted(
        anime_id
        for anime in catalog
        if (anime_id := safe_int(anime.get("mal_id"))) is not None
    )
    selected_ids = set(args.ids or all_ids)
    candidates = [anime_id for anime_id in all_ids if anime_id in selected_ids]
    to_fetch = [
        anime_id
        for anime_id in candidates
        if args.force or should_refresh(cached.get(str(anime_id)), args.refresh_after_days)
    ]
    if args.seed_only:
        to_fetch = []
    if args.max_items is not None:
        to_fetch = to_fetch[: max(0, args.max_items)]

    print(f"[INFO] Catalogo: {len(all_ids)} animes")
    cached_available = sum(
        1
        for anime_id in candidates
        if (cached.get(str(anime_id)) or {}).get("status") in {"ok", "not_found"}
    )
    print(f"[INFO] Registros disponibles en cache: {cached_available}")
    print(f"[INFO] Proveedor remoto: {args.provider}")
    print(f"[INFO] Consultas previstas: {len(to_fetch)}")
    if to_fetch:
        delay = args.delay
        if delay is None:
            delay = ANILIST_REQUEST_INTERVAL if args.provider == "anilist" else JIKAN_REQUEST_INTERVAL
        remote_requests = len(to_fetch)
        if args.provider == "anilist":
            batch_size = max(1, args.batch_size)
            remote_requests = (len(to_fetch) + batch_size - 1) // batch_size
        estimate_minutes = remote_requests * max(delay, 0) / 60
        print(f"[INFO] Tiempo minimo estimado: {estimate_minutes:.1f} minutos")

    delay = args.delay
    if delay is None:
        delay = ANILIST_REQUEST_INTERVAL if args.provider == "anilist" else JIKAN_REQUEST_INTERVAL
    pacer = RequestPacer(delay)

    def save_progress() -> None:
        save_json(
            args.cache,
            {"version": 1, "updated_at": utc_now(), "items": cached},
            pretty=False,
        )
        progress_payload, progress_report = build_public_payload(catalog, cached)
        save_json(args.output, progress_payload, pretty=args.pretty)
        save_json(args.report, progress_report, pretty=True)

    if args.provider == "anilist":
        batch_size = max(1, args.batch_size)
        batches = [to_fetch[index:index + batch_size] for index in range(0, len(to_fetch), batch_size)]
        for batch_index, batch in enumerate(batches, start=1):
            try:
                records = fetch_anilist_batch(batch, pacer)
                for anime_id, record in records.items():
                    cached[str(anime_id)] = record
                links = sum(
                    len(record.get("prequels") or []) + len(record.get("sequels") or [])
                    for record in records.values()
                )
                print(
                    f"[{batch_index}/{len(batches)}] AniList | "
                    f"{len(batch)} animes | {links} relaciones"
                )
            except Exception as error:  # El siguiente arranque reintentara este lote.
                for anime_id in batch:
                    cached[str(anime_id)] = {
                        "status": "error",
                        "source": ANILIST_SOURCE,
                        "error": str(error),
                        "fetched_at": utc_now(),
                    }
                print(f"[ERROR] [{batch_index}/{len(batches)}] AniList: {error}")
            save_progress()
    else:
        for index, anime_id in enumerate(to_fetch, start=1):
            try:
                payload, source = fetch_anime_relations(anime_id, pacer)
                parsed = extract_relations(payload)
                cached[str(anime_id)] = {
                    "status": "not_found" if source == "not_found" else "ok",
                    "source": f"jikan_{source}",
                    "prequels": parsed["prequels"],
                    "sequels": parsed["sequels"],
                    "fetched_at": utc_now(),
                }
                count = len(parsed["prequels"]) + len(parsed["sequels"])
                print(f"[{index}/{len(to_fetch)}] mal_id={anime_id} | {count} relaciones | {source}")
            except Exception as error:  # El siguiente arranque reintentara este registro.
                cached[str(anime_id)] = {
                    "status": "error",
                    "source": "jikan",
                    "error": str(error),
                    "fetched_at": utc_now(),
                }
                print(f"[ERROR] [{index}/{len(to_fetch)}] mal_id={anime_id}: {error}")

            if index % 20 == 0:
                save_progress()

    save_json(
        args.cache,
        {"version": 1, "updated_at": utc_now(), "items": cached},
        pretty=False,
    )
    public_payload, report = build_public_payload(catalog, cached)
    save_json(args.output, public_payload, pretty=args.pretty)
    save_json(args.report, report, pretty=True)

    print("\n[OK] Relaciones generadas")
    print(f"[OK] Salida publica: {args.output}")
    print(f"[OK] Cache reanudable: {args.cache}")
    print(f"[OK] Anime con continuidad: {public_payload['anime_with_relations']}")
    print(f"[OK] Pendientes/errores: {report['pending_or_errors']}")
    print(f"[OK] Destinos fuera del catalogo: {report['unavailable_target_links']}")
    return 0 if args.seed_only or report["pending_or_errors"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
