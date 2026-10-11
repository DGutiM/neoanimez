# Prueba de entrada y primer guardado

Objetivo: comprobar que una persona nueva entiende NeoAnimeZ, descubre un anime y sabe guardarlo sin recibir ayuda. La interfaz mantiene la lista como entrada para usuarios con sesion; los visitantes llegan a Descubrir.

## Prueba con personas nuevas

Invitar a 3-5 personas que no hayan usado la web, incluyendo movil y escritorio. No explicar los botones antes de empezar. Pedir permiso antes de grabar y no recoger correos ni contrasenas en las notas.

1. Abre la web y cuenta para que crees que sirve.
2. Encuentra un anime que conozcas y abre su ficha.
3. Descubre un anime que no conocias y que te interese.
4. Guardalo para verlo mas adelante. La persona decide si quiere crear una cuenta; detenerse antes del registro tambien aporta informacion.
5. Con una cuenta de prueba, entra de nuevo y encuentra el anime guardado.

Anotar por tarea: completada sin ayuda / con ayuda / abandonada, donde se atasca y que esperaba encontrar. No presentar estas pruebas como realizadas hasta tener participantes. Las pruebas automatizadas comprueban funcionamiento, no comprension ni retencion.

## Medicion disponible

Los eventos propios solo se envian si se acepta la analitica existente. No incluyen texto buscado, correo, nombre del anime, identificador de usuario ni parametros o fragmentos de URL. No hay grabacion de sesiones ni nuevas tablas.

| Evento | Que indica |
| --- | --- |
| search_submitted | Busqueda de al menos dos letras enviada con boton o Enter; no mide cada pulsacion de la busqueda en vivo. |
| discovery_cover_open | Apertura desde las caratulas de Descubrir. |
| recommendation_surprise / recommendation_personal / recommendation_mood | Se ha encontrado una recomendacion para mostrar. |
| featured_open | Entrada en Destacados desde otra seccion. |
| anime_open | Apertura de una ficha. |
| list_save_requested | Un visitante sin sesion quiere guardar un anime. |
| signup_submitted | Envio de registro con validacion local correcta; no garantiza creacion. |
| signup_confirmation_prompted | Se ha mostrado el aviso de revisar el correo; no prueba que el correo llegue ni que sea una cuenta nueva. |
| sign_up | Registro con sesion inmediata. No cuenta las altas que requieren confirmacion por correo. |
| login | Inicio de sesion completado. |
| list_saved | Guardado completado. Puede incluir mas de un guardado por persona. |

Revisar estos eventos en el informe de eventos de la propiedad de Google Analytics ya conectada. Comparar periodos con trafico suficiente y similares; no dividir recuentos brutos como si fueran conversiones de usuarios unicos. Un embudo requiere agrupar por usuario o sesion en Analytics. Quien rechaza la analitica no aparece en esta medicion.

Priorizar dificultades repetidas en las pruebas humanas. Con poco trafico, una diferencia de dos o tres eventos no demuestra que un cambio de interfaz sea mejor.

## Verificacion tecnica

```sh
node --test scripts/test_*.cjs
node scripts/serve-preview.cjs --port=4195 --mock-auth
```

La vista previa usa cuentas ficticias y bloquea peticiones a Supabase. Probar `?scenario=guest`, `?scenario=member` y `?scenario=recovery&type=recovery`; nunca introducir credenciales reales en la vista previa. Verificar en movil y escritorio: busqueda al escribir, boton/Enter, borrar consulta, recomendacion, registro contextual, cambio a cuenta existente y recuperacion de contrasena.

No hace falta ejecutar SQL ni cambiar la configuracion de Supabase para estos ajustes de interfaz.

## Revision del 11 de octubre de 2026

Se conserva la entrada directa, el registro solo al querer guardar, el logo y el aspecto general. No se han migrado ni editado cuentas, listas, puntuaciones o datos de produccion.

Correcciones verificables:
- Los formularios se conectan antes de esperar al catalogo. La sesion y el catalogo cargan en paralelo.
- Catalogo, fichas, calendario y proximos estrenos ofrecen reintento cuando falla la carga.
- Una descarga de detalles rechazada se retira de las peticiones compartidas; no bloquea reintentos posteriores. Los bloques ya cargados no se vuelven a descargar innecesariamente.
- El calendario comparte una sola peticion en curso y conserva los datos anteriores si falla un refresco.
- La cache de la aplicacion valida JSON antes de guardarlo y descarta entradas que no se pueden leer.
- El catalogo admite OVA, ONA y especiales. Solo la busqueda enviada desplaza a resultados; las actualizaciones de fondo no mueven la pantalla.
- Tarjetas accesibles por teclado, foco dentro de los dialogos, nombres completos de los dias y estados anunciados en los selectores.
- Los titulos y etiquetas importados se escapan al construir tarjetas. Un anime sin puntuacion no se presenta como un cero.

Escenarios locales, siempre con `--mock-auth`:
- `?scenario=catalogRetry`: fallan las dos primeras descargas del catalogo; el boton debe recuperar la pagina sin recargarla.
- `?scenario=detailRetry`: falla el primer bloque de detalles; reintentar debe recuperar la descripcion completa.
- `?scenario=scheduleRetry`: cuenta ficticia y primera descarga del calendario fallida; la lista sigue disponible.
- `?scenario=slowCatalog`: cinco segundos de demora artificial; formularios y navegacion deben responder durante la espera.

Estas comprobaciones no equivalen a probar todos los dispositivos fisicos ni a una auditoria de disponibilidad de Supabase. Sigue siendo util observar a personas nuevas realizando las cinco tareas iniciales. No se debe prometer un aumento de visitas sin medirlo.
