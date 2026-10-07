#!/usr/bin/env python3
"""Actualiza los datos publicos de NeoAnimeZ y deja el resultado listo para revisar."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def run_script(name: str, *arguments: object) -> None:
    command = [sys.executable, str(SCRIPTS / name), *(str(value) for value in arguments)]
    print(f"\n[RUN] {' '.join(command)}", flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def catalog_count() -> int:
    payload = load_json(ROOT / "anime-lista.json")
    if not isinstance(payload, list):
        raise ValueError("anime-lista.json no contiene una lista.")
    return len(payload)


def translate_and_clean_catalog() -> None:
    run_script(
        "generar_titulos_es.py",
        "--input", "anime-lista.json",
        "--in-place",
        "--batch-size", 20,
        "--save-every", 500,
        "--quiet",
    )
    run_script(
        "traducir_descripciones.py",
        "--input", "anime-lista.json",
        "--in-place",
        "--workers", 4,
        "--save-every", 100,
        "--quiet",
    )
    run_script(
        "limpiar_descripciones.py",
        "--input", "anime-lista.json",
        "--apply",
        "--no-backup",
    )


def refresh_relations_and_timelines(max_passes: int) -> None:
    imported_any = False
    for pass_number in range(1, max_passes + 1):
        print(f"\n[INFO] Relaciones y mapas: pasada {pass_number}/{max_passes}")
        run_script(
            "generar_relaciones_jikan.py",
            "--provider", "anilist",
            "--batch-size", 50,
            "--refresh-after-days", 30,
        )
        run_script(
            "generar_arboles_sagas.py",
            "--batch-size", 50,
            "--refresh-after-days", 30,
        )

        before = catalog_count()
        run_script(
            "importar_animes_externos_sagas.py",
            "--batch-size", 50,
            "--max-items", 120,
            "--apply",
        )
        after = catalog_count()
        if after == before:
            return

        imported_any = True
        print(f"[INFO] Importadas {after - before} fichas relacionadas.")
        translate_and_clean_catalog()

    if imported_any:
        print("\n[INFO] Regeneracion final de relaciones y mapas.")
        run_script(
            "generar_relaciones_jikan.py",
            "--provider", "anilist",
            "--batch-size", 50,
            "--refresh-after-days", 30,
        )
        run_script(
            "generar_arboles_sagas.py",
            "--batch-size", 50,
            "--refresh-after-days", 30,
        )


def update_publication_version(today: dt.date) -> None:
    version = f"{today:%Y%m%d}-monthly-data"

    js_path = ROOT / "assets" / "neoanimez.js"
    js = js_path.read_text(encoding="utf-8")
    js, js_count = re.subn(
        r"const APP_VERSION = '[^']+';",
        f"const APP_VERSION = '{version}';",
        js,
        count=1,
    )
    if js_count != 1:
        raise ValueError("No se pudo actualizar APP_VERSION.")
    js_path.write_text(js, encoding="utf-8")

    worker_path = ROOT / "service-worker.js"
    worker = worker_path.read_text(encoding="utf-8")
    worker, worker_count = re.subn(
        r"const CACHE_VERSION = '[^']+';",
        f"const CACHE_VERSION = '{version}';",
        worker,
        count=1,
    )
    if worker_count != 1:
        raise ValueError("No se pudo actualizar CACHE_VERSION.")
    worker_path.write_text(worker, encoding="utf-8")

    index_path = ROOT / "index.html"
    index = index_path.read_text(encoding="utf-8")
    index, asset_count = re.subn(
        r"(assets/neoanimez\.(?:css|js)\?v=)[^\"']+",
        rf"\g<1>{version}",
        index,
    )
    if asset_count != 2:
        raise ValueError(f"Se esperaban 2 assets versionados y se encontraron {asset_count}.")
    index_path.write_text(index, encoding="utf-8")

    sitemap_path = ROOT / "sitemap.xml"
    sitemap = sitemap_path.read_text(encoding="utf-8")
    sitemap, sitemap_count = re.subn(
        r"<lastmod>[^<]+</lastmod>",
        f"<lastmod>{today.isoformat()}</lastmod>",
        sitemap,
        count=1,
    )
    if sitemap_count != 1:
        raise ValueError("No se pudo actualizar sitemap.xml.")
    sitemap_path.write_text(sitemap, encoding="utf-8")

    print(f"[OK] Version publica: {version}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Actualiza catalogo, emisiones, estrenos, relaciones y mapas de NeoAnimeZ."
    )
    parser.add_argument("--year", type=int, default=dt.date.today().year)
    parser.add_argument("--years-ahead", type=int, default=2)
    parser.add_argument("--max-saga-passes", type=int, default=4)
    parser.add_argument("--skip-sagas", action="store_true")
    args = parser.parse_args()

    if args.years_ahead < 1:
        parser.error("--years-ahead debe ser al menos 1.")
    if args.max_saga_passes < 1:
        parser.error("--max-saga-passes debe ser al menos 1.")

    today = dt.date.today()
    initial_count = catalog_count()
    years = [args.year + offset for offset in range(args.years_ahead + 1)]

    for year in years:
        run_script(
            "sincronizar_jikan_2026.py",
            "--year", year,
            "--apply",
            "--include-upcoming",
            "--anilist-only",
        )

    run_script(
        "actualizar_estado_episodios_jikan.py",
        "--year", args.year,
        "--apply",
        "--anilist-only",
    )
    translate_and_clean_catalog()

    if not args.skip_sagas:
        refresh_relations_and_timelines(args.max_saga_passes)

    upcoming_files = []
    for year in years:
        output = f"anime-upcoming-{year}.full.json"
        upcoming_files.append(output)
        command = [
            "--year", year,
            "--master", "anime-lista.json",
            "--output", output,
            "--anilist-only",
            "--no-translate",
            "--quiet",
        ]
        if year == args.year:
            command.append("--include-tba")
        else:
            command.append("--no-include-tba")
        run_script("generar_upcoming_jikan.py", *command)

    curate_arguments = [
        "--input", upcoming_files[0],
        "--output", "anime-upcoming.json",
        "--master", "anime-lista.json",
        "--season", 10,
        "--extra-year-top", 10,
        "--no-backup",
    ]
    for extra_file in upcoming_files[1:]:
        curate_arguments.extend(["--extra-year-input", extra_file])
    run_script("curar_upcoming.py", *curate_arguments)

    run_script("generar_schedule_jikan.py")
    run_script("generar_novedades_mes.py", "--month", f"{today:%Y-%m}", "--limit", 6)
    run_script("generar_catalogo_web.py")
    update_publication_version(today)
    run_script("verificar_publicacion.py")

    final_count = catalog_count()
    if final_count < initial_count:
        raise RuntimeError(
            f"El catalogo se redujo de {initial_count} a {final_count}; se cancela la actualizacion."
        )

    print(f"\n[OK] Catalogo: {initial_count} -> {final_count}")
    print("[OK] Actualizacion mensual lista para revision.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
