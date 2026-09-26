# Publicacion en GitHub

Esta es la lista limpia para publicar NeoAnimeZ sin subir archivos de trabajo, backups o caches locales.

## Subir siempre

Archivos de raiz:

- `index.html`
- `assets/neoanimez.css`
- `assets/neoanimez.js`
- `service-worker.js`
- `manifest.json`
- `CNAME`
- `robots.txt`
- `sitemap.xml`
- `googleb2a25f85ee142dba.html`
- `logo.png`
- `icon.png`
- `preview.png`
- `anime-index.json`
- `anime-lista.json`
- `anime-upcoming.json`
- `anime-schedule.json`
- `anime-news.json`
- `anime-relations.json`
- `anime-timeline-index.json`

Carpetas necesarias para la web:

- `anime-details/`
- `anime-timelines/`

## Subir si quieres mantener herramientas en el repo

No son necesarias para que la web funcione en el navegador, pero ayudan a mantener el proyecto:

- `scripts/`
- `sql/`
- `docs/`
- `.gitignore`

Dentro de `sql/`, el archivo de referencia recomendado es:

- `sql/supabase-neoanimez-master.sql`

Los SQL antiguos pueden quedarse como historial, pero para futuras revisiones es mejor usar el maestro.

## No subir

Estos son archivos o carpetas de trabajo local:

- `cache/`
- `backups/`
- `archivo/`
- `neoanimez-repo/` dentro de esta carpeta
- `.DS_Store`
- `anime-upcoming.full.json`
- `anime-upcoming-2027.full.json`
- `anime-timelines.full.json`
- Cualquier archivo `*.full.json`

## Comprobacion antes de subir

Ejecuta:

```bash
python3 scripts/verificar_publicacion.py
```

Si dice `OK`, puedes subir los archivos de la lista limpia. Si avisa de `FALTA`, primero hay que corregirlo.

La tarea mensual de GitHub Actions prepara estos cambios en una pull request. GitHub Pages solo los publica despues de revisar y fusionar esa propuesta.

## Nota sobre el dominio

El archivo `CNAME` debe quedarse en GitHub Pages para mantener el dominio personalizado:

```text
www.neoanimez.com
```

No lo borres al subir cambios.
