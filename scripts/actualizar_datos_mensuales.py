#!/usr/bin/env python3
"""Monthly update entry point; static publication stays isolated until validated."""

import datetime as dt
import hashlib
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def update_publication_version(today: dt.date) -> None:
    js_path = ROOT / "assets" / "neoanimez.js"
    js = js_path.read_text(encoding="utf-8")
    signature = hashlib.sha256()
    for path in sorted(ROOT.glob("anime-*.json")):
        if not path.name.endswith(".full.json"):
            signature.update(path.read_bytes())
    signature.update(re.sub(r"const APP_VERSION = '[^']+';", "", js).encode())
    version = f"{today:%Y%m%d}-sources-{signature.hexdigest()[:10]}"
    js, count = re.subn(r"const APP_VERSION = '[^']+';", f"const APP_VERSION = '{version}';", js, count=1)
    if count != 1:
        raise ValueError("No se pudo actualizar APP_VERSION")
    js_path.write_text(js, encoding="utf-8")
    worker_path = ROOT / "service-worker.js"
    worker, count = re.subn(r"const CACHE_VERSION = '[^']+';", f"const CACHE_VERSION = '{version}';",
                            worker_path.read_text(encoding="utf-8"), count=1)
    if count != 1:
        raise ValueError("No se pudo actualizar CACHE_VERSION")
    worker_path.write_text(worker, encoding="utf-8")
    index_path = ROOT / "index.html"
    index, count = re.subn(r"(assets/neoanimez\.(?:css|js)\?v=)[^\"']+", rf"\g<1>{version}",
                           index_path.read_text(encoding="utf-8"))
    if count != 2:
        raise ValueError("Se esperaban dos assets versionados")
    index_path.write_text(index, encoding="utf-8")
    sitemap_path = ROOT / "sitemap.xml"
    sitemap, count = re.subn(r"<lastmod>[^<]+</lastmod>", f"<lastmod>{today.isoformat()}</lastmod>",
                             sitemap_path.read_text(encoding="utf-8"), count=1)
    if count != 1:
        raise ValueError("No se pudo actualizar sitemap.xml")
    sitemap_path.write_text(sitemap, encoding="utf-8")
    print(f"[OK] Version publica: {version}")


if __name__ == "__main__":
    from sync_catalog_sources import main
    raise SystemExit(main())
