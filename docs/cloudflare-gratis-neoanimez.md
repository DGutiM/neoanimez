# Cloudflare gratis para NeoAnimeZ

Objetivo: acelerar y proteger `neoanimez.com` sin meter una pantalla molesta antes de entrar.

## Idea principal

Cloudflare no tiene que mostrar ningun aviso si se configura suave.
La pantalla tipo "Checking your browser" suele aparecer cuando se activa:

- Under Attack Mode
- Managed Challenge agresivo
- reglas de seguridad demasiado duras

Para NeoAnimeZ, de inicio conviene usar Cloudflare como CDN/DNS normal, no como barrera visible.

## Configuracion recomendada

### DNS

- `www` apuntando a GitHub Pages y con nube naranja activa.
- Dominio raiz `neoanimez.com` redirigido a `www.neoanimez.com`.
- Mantener el archivo `CNAME` en GitHub con:

```text
www.neoanimez.com
```

### SSL/TLS

- Modo recomendado: `Full`.
- Activar `Always Use HTTPS`.
- Activar redireccion de HTTP a HTTPS.

### Cache

Regla mental:

- HTML: que pueda actualizarse rapido.
- JSON grandes: cachear, pero poder refrescar/purgar cuando subas nuevos datos.
- Imagenes y assets: cache mas larga.

Recomendacion inicial:

- No crear reglas agresivas para `index.html`.
- Cache normal para `logo.png`, `icon.png`, `preview.png`.
- Cache normal para carpetas de datos, sabiendo que tras subir JSON nuevos puedes purgar cache en Cloudflare.

Rutas de datos importantes:

- `/anime-index.json`
- `/anime-lista.json`
- `/anime-upcoming.json`
- `/anime-schedule.json`
- `/anime-details/*`
- `/anime-timelines/*`

Assets estaticos importantes:

- `/assets/neoanimez.css`
- `/assets/neoanimez.js`

### Seguridad

Activar suave:

- Bot Fight Mode si no rompe nada.
- WAF/Managed Rules basicas si estan disponibles en el plan gratis.

No activar al principio:

- Under Attack Mode permanente.
- Bloqueos por pais.
- Challenges para todo el trafico.

## Cuando actualices datos

Si cambias JSON importantes y ves que la web tarda en reflejarlo:

1. En Cloudflare, ir a cache.
2. Purgar cache.
3. Mejor purgar por URL concreta si solo cambiaste un archivo.
4. Purgar todo solo cuando hayas cambiado muchas cosas.

## Beneficio esperado

- Mejor carga de archivos estaticos.
- Menos golpes directos a GitHub Pages.
- DNS mas robusto.
- Proteccion basica ante trafico raro.

## Riesgo principal

Configurar Cloudflare demasiado agresivo puede dar sensacion de web lenta o bloqueada.
Por eso la primera configuracion debe ser suave: CDN + HTTPS + cache normal.
