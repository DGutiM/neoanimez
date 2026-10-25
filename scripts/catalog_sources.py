#!/usr/bin/env python3
"""Read-only catalogue providers. Public output always uses our own schema."""

from __future__ import annotations

import copy
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

BASES = {"tenrai": "https://api.tenrai.org/v1", "edge": "https://jikan.lucashdo.com/v1"}
ROOT = Path(__file__).resolve().parents[1]
KEYS = {
    "malId": "mal_id", "titleEnglish": "title_english", "titleJapanese": "title_japanese",
    "titleSynonyms": "title_synonyms", "scoredBy": "scored_by", "imageUrl": "image_url",
    "smallImageUrl": "small_image_url", "largeImageUrl": "large_image_url",
    "maximumImageUrl": "maximum_image_url", "lastVisiblePage": "last_visible_page",
    "hasNextPage": "has_next_page", "currentPage": "current_page", "themeSongs": "theme",
}


class SourceError(RuntimeError):
    pass


class MissingAnime(SourceError):
    """Both providers explicitly report absence; keep any local record."""


class NotFound(SourceError):
    pass


def now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def atomic_json(path, value, *, pretty=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    options = {"indent": 2} if pretty else {"separators": (",", ":")}
    tmp.write_text(json.dumps(value, ensure_ascii=False, **options) + "\n", encoding="utf-8")
    tmp.replace(path)


def require_anilist_permission():
    if os.environ.get("NEO_ANILIST_AUTHORIZED") != "yes":
        raise SourceError("AniList desactivado: requiere autorizacion para NeoAnimeZ. Usa el actualizador Tenrai/Edge.")


def snake_fields(value):
    if isinstance(value, list):
        return [snake_fields(item) for item in value]
    if isinstance(value, dict):
        return {KEYS.get(key, key): snake_fields(item) for key, item in value.items()}
    return value


def normalize_edge(value):
    value = snake_fields(value)
    if not isinstance(value, dict):
        return value
    value = copy.deepcopy(value)
    images = value.get("images") or {}
    if "jpg" not in images and any(images.get(key) for key in ("small", "medium", "large")):
        value["images"] = {"jpg": {"small_image_url": images.get("small"),
                                    "image_url": images.get("medium") or value.get("image_url"),
                                    "large_image_url": images.get("large")}}
    if not value.get("images") and value.get("image_url"):
        value["images"] = {"jpg": {"image_url": value["image_url"], "large_image_url": value["image_url"]}}
    for field in ("genres", "themes", "demographics", "studios", "producers"):
        if field in value:
            value[field] = [{"name": item} if isinstance(item, str) else item for item in value[field] or []]
    if isinstance(value.get("relations"), list):
        groups = {}
        for rel in value["relations"]:
            if "entry" in rel:
                groups.setdefault(rel["relation"], []).extend(rel["entry"])
            else:
                groups.setdefault(rel.get("relation", ""), []).append({
                    "mal_id": rel.get("mal_id"), "type": rel.get("type"), "name": rel.get("title", "")
                })
        value["relations"] = [{"relation": kind, "entry": entries} for kind, entries in groups.items()]
    broadcast = value.get("broadcast")
    if isinstance(broadcast, dict) and broadcast.get("timezone") == "JST":
        broadcast["timezone"] = "Asia/Tokyo"
    return value


def valid_anime(data, anime_id=None):
    if not isinstance(data, dict) or not isinstance(data.get("mal_id"), int) or isinstance(data["mal_id"], bool) or data["mal_id"] <= 0:
        raise SourceError("Ficha sin identificador MAL valido")
    if anime_id is not None and data["mal_id"] != anime_id:
        raise SourceError("La fuente ha devuelto otro anime")
    if not isinstance(data.get("title"), str) or not data["title"].strip():
        raise SourceError("Ficha sin titulo")
    return data


class CatalogClient:
    def __init__(self, root=ROOT, *, timeout=20, interval=1.1, retries=2, offline=False):
        self.directory = Path(root) / "cache" / "catalog-sources-v1"
        self.timeout, self.interval, self.retries = timeout, interval, retries
        self.offline = offline
        self.last_request = 0.0
        self.provider_failures = {provider: 0 for provider in BASES}
        self.unavailable_until = {provider: 0.0 for provider in BASES}
        self.stats = {"requests": 0, "cache_hits": 0, "fallbacks": 0}

    def _path(self, provider, path, params):
        key = json.dumps([provider, path, params], sort_keys=True)
        return self.directory / (hashlib.sha256(key.encode()).hexdigest() + ".json")

    def _request(self, provider, path, params=None, max_age=21600):
        params = dict(params or {})
        cache_path = self._path(provider, path, params)
        cached = None
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            age = time.time() - float(cached["timestamp"])
            if cached.get("version") == 1 and (self.offline or age < max_age):
                self.stats["cache_hits"] += 1
                return copy.deepcopy(cached["payload"]), cached["fetched_at"]
        except (OSError, ValueError, KeyError, TypeError):
            pass
        if self.offline:
            raise SourceError(f"Sin cache para {provider} {path}")
        if self.unavailable_until[provider] > time.monotonic():
            raise SourceError(f"{provider} temporalmente en pausa tras fallos de red")
        url = BASES[provider] + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        last_error = None
        for attempt in range(self.retries):
            time.sleep(max(0, self.interval - (time.monotonic() - self.last_request)))
            self.last_request = time.monotonic()
            self.stats["requests"] += 1
            try:
                headers = {"User-Agent": "NeoAnimeZ-catalog-sync/2.0", "Accept": "application/json"}
                if cached and cached.get("etag"):
                    headers["If-None-Match"] = cached["etag"]
                request = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    payload = json.load(response)
                    etag = getattr(response, "headers", {}).get("ETag")
                if not isinstance(payload, dict) or "data" not in payload or payload.get("error") or payload.get("errors"):
                    raise SourceError("Respuesta incompleta o con errores")
                meta = payload.get("meta") or {}
                if meta.get("stale") or meta.get("refreshFailed"):
                    raise SourceError("El proveedor indica que su respuesta esta obsoleta")
                fetched_at = now()
                atomic_json(cache_path, {"version": 1, "timestamp": time.time(), "fetched_at": fetched_at, "payload": payload, "etag": etag})
                self.provider_failures[provider] = 0
                return payload, fetched_at
            except urllib.error.HTTPError as error:
                last_error = error
                if error.code == 304 and cached:
                    cached.update(timestamp=time.time(), fetched_at=now())
                    atomic_json(cache_path, cached)
                    self.stats["cache_hits"] += 1
                    self.provider_failures[provider] = 0
                    return copy.deepcopy(cached["payload"]), cached["fetched_at"]
                if error.code == 404:
                    raise NotFound(f"{provider} {path}: 404") from error
                if error.code in {401, 403}:
                    raise SourceError(f"Acceso rechazado por {provider}: {error.code}") from error
                if error.code == 429:
                    try:
                        delay = max(1, float(error.headers.get("Retry-After", "60")))
                    except ValueError:
                        delay = 60
                    if delay > 120 or attempt + 1 == self.retries:
                        raise SourceError(f"Limite de {provider}; reintentar mas tarde") from error
                    time.sleep(delay)
                    continue
                if error.code not in {500, 502, 503, 504}:
                    break
            except (OSError, ValueError, SourceError) as error:
                last_error = error
            if attempt + 1 < self.retries:
                time.sleep(2 ** attempt)
        self.provider_failures[provider] += 1
        if self.provider_failures[provider] >= 3:
            self.unavailable_until[provider] = time.monotonic() + 300
        raise SourceError(f"{provider} {path}: {last_error}")

    def anime(self, anime_id, *, max_age=21600):
        errors = []
        missing = 0
        for provider in BASES:
            try:
                payload, fetched_at = self._request(provider, f"/anime/{int(anime_id)}/full", max_age=max_age)
                item = normalize_edge(payload["data"]) if provider == "edge" else copy.deepcopy(payload["data"])
                valid_anime(item, int(anime_id))
                if not isinstance(item.get("relations"), list):
                    raise SourceError("Ficha completa sin relaciones explicitas")
                item["_source"] = provider
                item["_fetched_at"] = fetched_at
                if provider == "edge":
                    self.stats["fallbacks"] += 1
                return item
            except SourceError as error:
                errors.append(str(error))
                missing += isinstance(error, NotFound)
                if "Acceso rechazado" in str(error) or "Limite de" in str(error):
                    raise
        if missing == len(BASES):
            raise MissingAnime("; ".join(errors))
        raise SourceError("; ".join(errors))

    def listing(self, path, params=None):
        """A failed page invalidates the entire list; it is never an empty success."""
        errors = []
        for provider in BASES:
            try:
                items, seen = [], set()
                for page in range(1, 501):
                    query = dict(params or {})
                    if provider == "tenrai":
                        query["page"] = page
                    payload, fetched_at = self._request(provider, path, query)
                    if not isinstance(payload["data"], list):
                        raise SourceError("Listado invalido")
                    for raw in payload["data"]:
                        item = normalize_edge(raw) if provider == "edge" else copy.deepcopy(raw)
                        valid_anime(item)
                        if provider == "edge":
                            # Edge season/schedule cards omit status and dates: hydrate by ID.
                            item = self.anime(item["mal_id"])
                        else:
                            item.update(_source=provider, _fetched_at=fetched_at)
                        if item["mal_id"] not in seen:
                            items.append(item)
                            seen.add(item["mal_id"])
                    if provider == "edge":
                        return items
                    pagination = payload.get("pagination")
                    if not isinstance(pagination, dict) or not isinstance(pagination.get("has_next_page"), bool):
                        raise SourceError("Falta informacion de paginacion")
                    if not pagination["has_next_page"]:
                        return items
                    if not payload["data"]:
                        raise SourceError("Pagina vacia antes del final")
                raise SourceError("Demasiadas paginas")
            except SourceError as error:
                errors.append(str(error))
                if "Acceso rechazado" in str(error) or "Limite de" in str(error):
                    raise
        raise SourceError("; ".join(errors))

    def extra(self, anime_id, resource, *, max_age=604800):
        """Fetch a complete optional resource, never a mixture of provider pages."""
        if resource not in {"episodes", "themes", "recommendations"}:
            raise ValueError("Recurso no permitido")
        errors = []
        for provider in BASES:
            try:
                items, seen = [], set()
                for page in range(1, 101):
                    params = {"page": page} if resource == "episodes" else {}
                    payload, fetched_at = self._request(provider, f"/anime/{int(anime_id)}/{resource}", params, max_age)
                    data = payload["data"]
                    if resource == "themes":
                        if not isinstance(data, dict) or any(not isinstance(data.get(k), list) for k in ("openings", "endings")):
                            raise SourceError("Canciones incompletas")
                        return {"data": data, "provider": provider, "fetched_at": fetched_at}
                    if not isinstance(data, list):
                        raise SourceError("Listado de extras invalido")
                    if resource == "recommendations":
                        return {"data": data, "provider": provider, "fetched_at": fetched_at}
                    for row in data:
                        if not isinstance(row, dict):
                            raise SourceError("Episodio sin campos reconocibles")
                        number = row.get("mal_id") if provider == "tenrai" else row.get("number")
                        if not isinstance(number, int) or isinstance(number, bool) or number < 1 or number in seen:
                            raise SourceError("Numeracion de episodios invalida o repetida")
                        seen.add(number)
                        items.append({"number": number,
                                      "filler": row.get("filler") if isinstance(row.get("filler"), bool) else None,
                                      "recap": row.get("recap") if isinstance(row.get("recap"), bool) else None})
                    pagination = payload.get("pagination") if provider == "tenrai" else (payload.get("meta") or {}).get("pagination")
                    next_page = (pagination or {}).get("has_next_page" if provider == "tenrai" else "hasNextPage")
                    if not isinstance(next_page, bool):
                        raise SourceError("Falta paginacion de episodios")
                    if not next_page:
                        return {"data": sorted(items, key=lambda row: row["number"]), "provider": provider, "fetched_at": fetched_at}
                    if not data:
                        raise SourceError("Pagina vacia antes del final de episodios")
                raise SourceError("Demasiadas paginas de episodios")
            except SourceError as error:
                errors.append(str(error))
                if "Acceso rechazado" in str(error) or "Limite de" in str(error):
                    raise
        raise SourceError("; ".join(errors))


_client = None


def default_client():
    global _client
    if _client is None:
        _client = CatalogClient()
    return _client
