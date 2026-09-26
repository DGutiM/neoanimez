#!/usr/bin/env python3
"""Audita index.html sin modificarlo.

Sirve para detectar riesgos basicos antes de tocar una web grande:
- tamano de HTML/CSS/JS
- ids duplicados
- funciones JS duplicadas
- cantidad de manejadores inline
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
APP_CSS = ROOT / "assets" / "neoanimez.css"
APP_JS = ROOT / "assets" / "neoanimez.js"


def line_count(text: str) -> int:
    return text.count("\n") + (1 if text and not text.endswith("\n") else 0)


def find_blocks(text: str, tag: str) -> list[str]:
    pattern = re.compile(rf"<{tag}\b[^>]*>(.*?)</{tag}>", re.IGNORECASE | re.DOTALL)
    return [match.group(1) for match in pattern.finditer(text)]


def print_counter(title: str, counter: Counter[str], limit: int = 20) -> None:
    items = [(key, count) for key, count in counter.items() if count > 1]
    print(title)
    if not items:
      print("  OK sin duplicados")
      return
    for key, count in sorted(items, key=lambda item: (-item[1], item[0]))[:limit]:
        print(f"  {key}: {count}")


def main() -> int:
    if not INDEX.exists():
        print(f"FALTA {INDEX}")
        return 1

    html = INDEX.read_text(encoding="utf-8")
    inline_styles = find_blocks(html, "style")
    inline_scripts = [block for block in find_blocks(html, "script") if block.strip()]
    css = APP_CSS.read_text(encoding="utf-8") if APP_CSS.exists() else "\n".join(inline_styles)
    javascript = APP_JS.read_text(encoding="utf-8") if APP_JS.exists() else "\n".join(inline_scripts)
    ids = re.findall(r'\bid=["\']([^"\']+)["\']', html)
    functions = re.findall(r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\(", javascript)
    inline_handlers = re.findall(r"\s(on[a-z]+)=['\"]", html, flags=re.IGNORECASE)

    print("Auditoria index.html")
    print("====================")
    print(f"Archivo: {INDEX}")
    print(f"Tamano: {INDEX.stat().st_size / 1024:.1f} KB")
    print(f"Lineas totales: {line_count(html)}")
    print(f"CSS propio: {APP_CSS if APP_CSS.exists() else 'embebido'} ({line_count(css)} lineas)")
    print(f"JavaScript propio: {APP_JS if APP_JS.exists() else 'embebido'} ({line_count(javascript)} lineas)")
    print(f"Bloques CSS/JS embebidos: {len(inline_styles)}/{len(inline_scripts)}")
    print(f"Ids HTML: {len(ids)}")
    print(f"Funciones JS declaradas: {len(functions)}")
    print(f"Manejadores inline: {len(inline_handlers)}")
    print()

    print_counter("Ids duplicados:", Counter(ids))
    print()
    print_counter("Funciones duplicadas:", Counter(functions))
    print()

    if line_count(javascript) > 7000:
        print("Aviso: el JS ya esta separado del HTML, pero conviene modularizarlo por funciones en futuras reformas.")
    if len(inline_handlers) > 40:
        print("Aviso: hay muchos manejadores inline. A medio plazo conviene moverlos a addEventListener.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
