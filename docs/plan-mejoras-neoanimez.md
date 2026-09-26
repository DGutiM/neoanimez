# Plan de mejoras NeoAnimeZ

## Etapa 0 - Calendario modal

Objetivo: que al tocar un dia del calendario se abra una ventana con las emisiones del dia, con X para cerrar, y que tocar un anime abra su ficha normal.

Estado local:
- El modal `scheduleDayModal` existe en `index.html`.
- Los dias del calendario llaman a `openScheduleDayModal`.
- La X llama a `closeScheduleDayModal`.
- Tocar un anime dentro del modal cierra el calendario y abre `openAnimeModal`.
- `anime-schedule.json` esta incluido en la cache de datos del service worker.

Validacion pendiente en navegador real:
- Subir `index.html`, `service-worker.js` y `anime-schedule.json`.
- Probar en movil y ordenador.

## Etapa 1 - Cache y actualizaciones de datos

Objetivo: evitar que la web muestre datos antiguos cuando se actualizan JSON.

Tareas:
- Revisar que todos los JSON de datos pasen por la cache de datos, no por cache fija.
- Separar version de app y version de datos si hace falta.
- Documentar cada cuanto actualizar `anime-schedule.json`, `anime-upcoming.json` y catalogo.

Estado local:
- `anime-schedule.json` ya pasa por la cache de datos del service worker.
- Cuando la app pide un JSON con refresco real, usa `fetch(..., { cache: 'reload' })`.
- El service worker responde a `request.cache === 'reload'` con estrategia network-first y fallback a cache.

## Etapa 2 - Carpeta limpia de publicacion

Objetivo: evitar subir backups, cache local o archivos gigantes que no necesita la web.

Tareas:
- Crear una lista clara de archivos que si se suben a GitHub.
- Separar `cache/`, `backups/`, `archivo/` y JSON full de trabajo.
- Valorar una carpeta `public/` o un script de preparacion.

Estado local:
- Existe la guia `docs/publicacion-github.md`.
- Existe el verificador `scripts/verificar_publicacion.py`.
- Existe `.gitignore` para no subir cache, backups, archivos full ni la copia `neoanimez-repo/`.
- Existe `CNAME` en la raiz local para conservar el dominio de GitHub Pages.

## Etapa 3 - SQL unico y seguro

Objetivo: que Supabase sea facil de mantener y no dependa de ejecutar SQL en orden equivocado.

Estado local:
- Existe `sql/supabase-neoanimez-master.sql` como SQL maestro.
- Incluye estados de usuario, puntuaciones, progreso, ranking agregado, tablon, votos, moderadores, RPCs e indices.
- Las puntuaciones individuales quedan privadas: usuarios autenticados solo leen sus propias notas.
- El ranking de comunidad usa `get_community_anime_ratings()`, que devuelve solo datos agregados.
- Mantiene como moderadores iniciales a `diegogutimartinez@gmail.com` y `kb24god14@gmail.com`.

Validacion local:
- El SQL maestro contiene `user_anime_status`, `get_my_anime_data()`, `get_community_anime_ratings()` y funciones del tablon.
- No contiene `grant select on public.user_anime_ratings to anon`.
- Elimina la politica antigua `ratings_read_for_community` si existiera.

Pendiente:
- No hace falta ejecutarlo ahora si Supabase ya funciona.
- Guardarlo como referencia y usarlo si se recrea el proyecto, se revisan permisos o falta alguna tabla/funcion.

## Etapa 4 - Retirada de NeoAdivino

Objetivo: retirar una funcion que ya no se mostraba y evitar mantener 94.000 personajes sin uso.

Estado local:
- Eliminados el HTML, CSS y JavaScript de NeoAdivino.
- Eliminados sus indices, bloques de detalle y scripts de generacion.
- Eliminadas sus rutas del service worker y del verificador de publicacion.

Validacion local:
- La aplicacion funciona sin solicitar ningun archivo de personajes.

## Etapa 5 - Mantenimiento del HTML

Objetivo: reducir riesgo al tocar una web de mas de 10.000 lineas.

Estado local:
- Existe `scripts/auditar_index_html.py` para revisar tamano, ids duplicados, funciones duplicadas y manejadores inline.
- `index.html` ya esta separado de `assets/neoanimez.css` y `assets/neoanimez.js`.
- El service worker versiona y precarga los dos assets.

Pendiente:
- Dividir el JavaScript en modulos menores cuando se vaya a reformar una zona funcional concreta.

## Etapa 6 - Cloudflare y proteccion

Objetivo: mejorar velocidad, cache y proteccion sin pagar.

Estado local:
- Existe `docs/cloudflare-gratis-neoanimez.md` con la configuracion recomendada.
- La estrategia es usar Cloudflare como CDN/DNS suave, sin pantallas de verificacion antes de entrar.

Pendiente fuera de Codex:
- Crear/abrir cuenta Cloudflare.
- Cambiar nameservers en Namecheap.
- Activar HTTPS y cache suave.
- No activar `Under Attack Mode` salvo ataque real.

## Etapa 7 - Producto y comunidad

Objetivo: aumentar uso diario sin cargar demasiado la app.

Ideas:
- "Continuar viendo" en Mi Lista.
- Calendario de proximos 7 dias.
- Perfil publico opcional.
- Comparar gustos.
- Opiniones por anime con paginacion.
- Mejoras de moderacion del tablon.
