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

## Las cuatro mejoras, despues de la transicion

No se activan en este cambio. Ninguna es de riesgo cero.

1. **Paginas compartibles de orden de visionado:** viables con nuestros mapas,
   sin otra API. Primera candidata: aprovechar los datos ya validados, aclarar
   rutas alternativas y probar enlaces directos, retroceso y movil.
2. **Guia de episodios y relleno:** las fuentes ofrecen episodios y marcas
   filler/recap. Probar primero unas pocas series; ausencia de una marca no
   demuestra que el capitulo sea canon. Los arcos requieren una fuente/editorial
   adicional, no se deben inventar ni prometer para todos los animes.
3. **Si te gusto este anime:** hay recomendaciones por ID MAL. Se pueden cruzar
   con el catalogo, guardar offline y filtrar duplicados, secuelas y contenido
   adulto. Son recomendaciones de una comunidad, no afinidad personal garantizada.
4. **Openings/endings por temporada:** hay metadatos de canciones. Los videos
   oficiales necesitan verificacion adicional; no hay garantia de un enlace
   oficial para cada cancion. No descargar musica ni subir videos de terceros.

Recomendacion: empezar por 1 y 3, incorporar 2 de forma piloto y dejar 4 para
cuando podamos verificar los enlaces. Todas pueden anadirse mediante datos
estaticos, de forma opcional, sin hacer depender la web de una API en directo.
