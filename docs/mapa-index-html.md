# Mapa de la interfaz web

Este documento sirve para orientarse antes de tocar el HTML principal de NeoAnimeZ.
No cambia la web; solo deja una referencia para mantenerla con menos riesgo.

## Estado actual

- `index.html` contiene la estructura semantica y los modales.
- `assets/neoanimez.css` contiene todos los estilos propios.
- `assets/neoanimez.js` contiene la logica de la aplicacion.
- No se han detectado `id` duplicados.
- No se han detectado funciones JS duplicadas.
- Hay varios manejadores inline (`onclick`, etc.), normales en esta fase, pero conviene reducirlos poco a poco.

Puedes comprobarlo con:

```bash
python3 scripts/auditar_index_html.py
```

## Siguiente orden recomendado

1. Mantener CSS y JavaScript fuera de `index.html`.
2. Separar `assets/neoanimez.js` por modulos solo cuando una mejora lo justifique.
3. Reducir manejadores inline y moverlos a `addEventListener` poco a poco.

## Regla practica

Si una mejora toca logica de Supabase, calendario o modales, primero probar en local.
Si solo toca textos o estilos pequenos, basta con validar sintaxis y ejecutar el verificador.

## Validaciones utiles

```bash
python3 scripts/verificar_publicacion.py
python3 scripts/auditar_index_html.py
```

Para comprobar la sintaxis del JavaScript:

```bash
node --check assets/neoanimez.js
```
