# Fuentes y actualizaciones del catalogo

Transicion preparada el 25 de octubre de 2026. No cambia el alojamiento, la
interfaz, los identificadores MAL ni las cuentas, listas o notas de Supabase.

## Arquitectura

1. `catalog_sources.py` consulta Tenrai como proveedor principal y Jikan-Edge
   como respaldo, normalizando ambos al esquema interno.
2. `catalog_transition.py` combina respuestas con el maestro sin sustituir las
   traducciones, alias, descripciones y clasificaciones editoriales existentes.
3. `actualizar_datos_mensuales.py` prepara un candidato aislado, genera los JSON
   derivados, valida y solo entonces puede reemplazar los archivos locales.
4. El navegador sigue consumiendo los JSON estaticos de GitHub Pages. No llama
   a estas APIs para buscar, filtrar ni abrir los mapas.

Las imagenes existentes se conservan. Se pueden anadir URLs alternativas de
MAL en `image_candidates`. Si ninguna funciona, el navegador intenta recuperar
una caratula por el mismo ID MAL, con timeout, deduplicacion y pausa tras errores.
Nunca elige la primera imagen de una busqueda por nombre. No se han descargado
ni re-alojado masivamente caratulas; sus URLs dependen del CDN de origen.

## Actualizar

Desde la raiz del proyecto:

```sh
# Prepara y valida una copia, sin modificar los archivos publicos.
python3 scripts/actualizar_datos_mensuales.py

# Mismo proceso, aplicando localmente solo despues de validar.
python3 scripts/actualizar_datos_mensuales.py --apply

# Piloto pequeno. --offline reutiliza cache sin consultar las APIs.
python3 scripts/actualizar_datos_mensuales.py --no-discovery --max-details 0 --max-new 0 --ids 52991,1254

# Pruebas sin red ni acceso a cuentas reales.
python3 -m unittest discover -s scripts -p 'test_*.py' -v
node --test scripts/test_source_images.cjs
python3 scripts/verificar_publicacion.py
```

Por defecto se descubren el ano actual y los dos siguientes, mas anuncios sin
fecha. Se limitan las altas a 120 y las fichas completas a 200 por pasada.
Los listados actualizan metadatos conocidos de los titulos existentes; las
fichas detalladas rotan por antiguedad, reservando tambien un cupo para titulos
historicos. `--max-new` y `--max-details` permiten ampliar esos limites.
No implica que se hayan vuelto a descargar todas las fichas de todo el catalogo.

Los antiguos comandos de red `actualizar_jikan.py`, `sincronizar_jikan_2026.py`,
`actualizar_estado_episodios_jikan.py`, `generar_upcoming_jikan.py`,
`generar_relaciones_jikan.py`, `generar_arboles_sagas.py` e
`importar_animes_externos_sagas.py` redirigen ahora al actualizador protegido.
Utilizan sus nuevos argumentos; no usar `--anilist-only`, `--provider anilist`
ni los parametros antiguos. Los generadores de traducciones, limpieza y bloques
siguen disponibles, pero para actualizar todo es preferible el comando unico.

## Protecciones

- Copia previa en `backups/catalog-sync-<fecha>/before.tar.gz` y candidato en
  la subcarpeta `candidate/`. La copia completa previa a la transicion incluye
  tambien scripts y caches, excluyendo otras copias anteriores.
- `report.json` explica altas, consultas, conflictos y fichas que han desaparecido
  de las fuentes. Una respuesta 404 de ambos proveedores NO borra nuestra ficha.
- Una pagina de un listado que falla invalida el listado; no se publica como si
  fuera completo. Los errores de red detienen la pasada y conservan lo anterior.
- Los identificadores, textos existentes y aristas publicadas de los mapas se
  comparan con el estado anterior, tambien en un checkout sin cache.
- Un total de episodios desconocido puede rellenarse. Un cambio entre dos totales
  ya conocidos se deja pendiente: podria contar peliculas, actos o capitulos de
  otra manera y no debe alterar el significado del progreso guardado.
- No se mezclan notas de AniList con cantidades de votos de MAL. Una nota antigua
  de origen incierto se conserva; las parejas ya identificadas como MAL pueden
  actualizarse juntas. La nota personal del usuario nunca se toca.
- Fechas contradictorias, regresiones de estado y rutas narrativas divergentes
  se conservan y anotan para revision, no se resuelven por el ano de estreno.
- Una fecha parcial permanece parcial. No se inventa el dia 1 del mes.
- Se comprueba que nadie haya editado los archivos durante la actualizacion;
  si ocurre, se cancela el reemplazo. Una interrupcion durante la copia local
  intenta restaurar los archivos ya reemplazados.
- La publicacion web debe ser un commit completo: no subir primero el indice y
  despues los bloques. No hay una transaccion atomica entre todos los archivos
  locales; GitHub Pages despliega la version del commit.

## GitHub Actions

El workflow mensual sigue preparando una rama de revision, no publicando en
`main` a ciegas. Crea primero una etiqueta de restauracion y conserva la cache
de respuestas/traducciones. El informe queda como artifact del workflow durante
90 dias. No se anaden credenciales, pagos ni nuevas tablas.

Un run correcto puede contener conflictos para revision: se conserva su valor
anterior. Revisar especialmente `review`, `unavailable_ids_kept_locally`,
`new_deferred`, `map_update` y `relations_update`. Un cambio de esquema, fallo de
traduccion o API caida no deberia llegar a la web. La cache permite repetir una
ejecucion sin empezar todas las descargas desde cero.

Para volver atras, usar la etiqueta `backup/...` del repositorio o restaurar los
archivos del tar en una carpeta separada, validar y publicar un nuevo commit de
restauracion. No borrar tablas ni reiniciar Supabase.

## AniList y condiciones de las fuentes

Los datos e imagenes que ya estaban guardados no se han eliminado. El adaptador
de AniList queda disponible pero las peticiones estan desactivadas por defecto.
Su uso para un catalogo/list tracker necesita aclarar la autorizacion con AniList;
que la web sea gratuita no elimina sus restricciones. Solo tras obtener permiso
se debe habilitar `NEO_ANILIST_AUTHORIZED=yes` y revisar la integracion. El flujo
mensual nuevo no activa esa variable ni consulta AniList.

Tenrai y Jikan-Edge ofrecen acceso publico gratuito a fecha de esta transicion,
sin garantia permanente de disponibilidad. Comparten MAL como fuente de fondo:
son respaldo tecnico entre si, no dos verificaciones independientes de un dato.
Se respetan los limites y `Retry-After`; un rechazo de acceso no se sortea cambiando
de proveedor. La licencia del software no concede derechos sobre textos o imagenes.

Referencias:
- https://github.com/jikan-me/jikan-rest/issues/613
- https://api.tenrai.org/documentation
- https://api.tenrai.org/llms.txt
- https://tenrai.org/terms
- https://jikan.lucashdo.com/docs
- https://github.com/LucasHenriqueDiniz/jikan-edge
- https://docs.anilist.co/guide/terms-of-use

## Extras de las fichas

Las cuatro mejoras estan integradas en las fichas y los mapas, sin nuevas tablas:

1. **Compartir mapa:** copia un enlace `?saga=<ID MAL>` que abre el orden existente,
   con las rutas alternativas y los formatos. Funciona sin cuenta. El enlace no
   incluye correo, perfil ni tokens de sesion. Es una ruta de la misma web, no una
   pagina HTML independiente para SEO.
2. **Guia de episodios:** disponible para cualquier anime que tenga registros de
   episodios en las fuentes, con cobertura parcial cuando falten datos. Solo numeros y marcas filler/recap de MAL;
   no se publican titulos, sinopsis, supuestos arcos ni deducciones de canon.
   Paginacion de 50 filas y filtros por relleno/resumen. No cambia el progreso.
3. **Si te gusto este anime:** recomendaciones MAL cruzadas por ID con el catalogo,
   excluyendo la misma saga, precuelas conocidas, estrenos futuros, contenido adulto
   y duplicados. Se muestran hasta seis. No son una promesa de afinidad personal.
4. **Openings/endings:** nombres originales de canciones, artistas y tramos de
   episodios. La interfaz esta en espanol; los nombres propios no se traducen.
   Enlace a la ficha fuente de MAL, sin alojar musica, letras ni videos no verificados.

La primera carga de 104 animes se amplia al catalogo completo, sin lista de pilotos.
`anime-extras-index.json` indica la disponibilidad; `anime-extras/` contiene 64 bloques descargados al abrir
un apartado. Los tres apartados empiezan cerrados. Un fallo deja la ficha utilizable
y ofrece reintento; el navegador no consulta a las APIs de catalogo para estos extras.
Los bloques activos son `extras-16.json` a `extras-79.json`. Se conservan sin cambios
los 16 antiguos (`00` a `15`) para no romper fichas en navegadores que aun tengan
el indice previo en cache: hay 80 archivos en la carpeta, pero el indice usa 64.

`actualizar_extras_anime.py` actualiza 80 fichas por pasada mensual, priorizando las pendientes
y las mas antiguas. Consulta los tres recursos en cualquier formato (TV, OVA, pelicula, etc.).
Las respuestas y los recursos ya transformados se guardan en cache, por lo que una interrupcion no obliga a repetir las descargas. Un error de un
recurso conserva su version anterior, registrada con su fecha real; el informe
`cache/extras-report.json` enumera esos casos. Una pagina incompleta no se acepta
como guia completa. El workflow mensual ya incluye este paso dentro del candidato.

```sh
python3 scripts/actualizar_extras_anime.py --limit 80
python3 scripts/actualizar_extras_anime.py --bootstrap --limit 250 --max-seconds 1500
python3 scripts/actualizar_extras_anime.py --status
python3 scripts/actualizar_extras_anime.py --validate
python3 scripts/catalog_release_version.py
python3 scripts/verificar_publicacion.py
```

El comando aislado conserva copia previa de los extras; el actualizador mensual
conserva ademas la publicacion completa antes de promoverla. Publicar juntos indice,
bloques y version, nunca carpetas cache/backups.

### Ampliacion completa por fases

El workflow manual **Ampliar extras del catalogo** procesa lotes secuenciales de
250 animes (primer lote reducido a 25 para comprobar el despliegue), con un presupuesto de 25 minutos por lote. No exige dejar el ordenador
encendido. Solo consulta recursos aun no comprobados: una respuesta vacia valida
queda registrada y no se vuelve a pedir durante la ampliacion. Las guias no se
inventan a partir del numero total de capitulos. Las recomendaciones siguen limitadas
a animes adecuados que ya existan en el catalogo local.

Cada lote valida los 64 bloques y publica indice, bloques y version juntos en un
commit. No modifica usuarios, traducciones, catalogo maestro, mapas ni calendarios.
Guarda un tag de restauracion antes de empezar. Los commits son sin force-push: si
alguien cambia main mientras se descarga, la publicacion se detiene para no pisarlo.
Pages se solicita explicitamente porque los commits del token de Actions no lo
disparan por si solos. No se cambia el workflow mensual de revision a publicacion directa.

Los checkpoints de `cache/extras-checkpoints-v1` se guardan tambien en la cache de
Actions. `scripts/data/anime-extras-state.json` conserva los fallos y su plazo de
reintento; no contiene datos de usuarios. Un 403/429 o diez errores seguidos detienen
la expansion, sin cambiar de IP ni ignorar limites. Un reinicio recupera el avance.
Los lotes son finitos: si quedan errores al terminar, el resumen los mantiene como
pendientes; no se afirma cobertura total. Se puede volver a ejecutar el workflow.
La rutina mensual normal revisa de nuevo los recursos, incluidos los antes vacios.

## Orden de Mi lista

Continuar viendo mantiene el orden de sus cinco tarjetas durante la visita a
Mi lista. Los cambios de episodios conservan sus fechas reales; el orden por
actividad se recalcula al salir a otra seccion y volver. Ir a segundo plano o abrir
una ficha no reinicia ese orden. Completados o eliminados dejan de mostrarse y los
animes nuevos ocupan las vacantes. La lista completa mantiene su orden alfabetico.
