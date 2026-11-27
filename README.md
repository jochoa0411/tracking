# Mensajero (PWA)

Bitácora de servicios del mensajero. Funciona sin señal y sincroniza con el PFS cuando hay conexión.

## Estructura

| Archivo | Qué hace |
|---|---|
| `index.html` | Cascarón de la app y carga de `app.js` |
| `app.js` | Pantallas: login, inicio, servicios, nuevo, detalle (entrega con foto + firma + GPS), tarifas, perfil |
| `api.js` | Sesión, llamadas al relay del PFS y sincronización (reintenta lo pendiente) |
| `db.js` | Almacén local en IndexedDB: servicios, tarifas, metadatos |
| `config.js` | URL del relay y clave pública (igual que el cotizador móvil) |
| `sw.js` | Service worker: la app abre sin señal; la API nunca se cachea |
| `manifest.webmanifest` | Instalable en pantalla de inicio |

## Publicar en GitHub Pages

1. Sube el código a `main` (`git push -u origin main`).
2. En GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)`**.
3. La app queda en `https://jochoa0411.github.io/tracking/`.

## Probar

- Abre la URL en Chrome (escritorio o celular) para revisar las pantallas.
- En el celular: Safari → Compartir → **Agregar a pantalla de inicio** (en iPhone las notificaciones y el modo sin conexión funcionan mejor desde la app instalada).
- Requiere que el PFS tenga la migración `0352` aplicada y el permiso `mensajeria.registrar` concedido a la cuenta del mensajero.

## Al cambiar archivos

Sube `CACHE` en `sw.js` (por ejemplo `mensajero-v2`) para que los teléfonos reciban la versión nueva.
