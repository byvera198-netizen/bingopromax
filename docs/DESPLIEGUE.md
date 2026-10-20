# Despliegue de Bingo Control ProMax

## Requisitos

- Node.js 22.13 o superior.
- Un proyecto Supabase con autenticación por correo habilitada.
- Un despliegue compatible con Cloudflare Workers/Vinext con un binding D1 llamado `DB`.

## Comprobación local

```bash
npm install
npm run build
npm test
```

El build debe terminar con las rutas `/`, `/api/health`, `/api/state` y `/api/files`.
`/api/health` devuelve un JSON mínimo para los monitores del hosting y no exige
autenticación. El endpoint `/api/files` se conserva por compatibilidad, pero devuelve `410`: los PDF se
procesan en el navegador y no se almacenan.

`vinext start` no es un servidor Node genérico: las rutas de la aplicación usan
`cloudflare:workers` y deben ejecutarse en el runtime Workers/Vinext compatible
con Cloudflare. Si el entorno local no proporciona ese runtime, un error
`ERR_UNSUPPORTED_ESM_URL_SCHEME` de Node indica una limitación del adaptador
local, no un error de autenticación o de la aplicación. El build sigue siendo
el artefacto de despliegue y debe validarse con el proveedor Cloudflare elegido.

## Supabase

La URL y la clave publishable están en `lib/supabase-client.ts`. Son valores
públicos; nunca reemplaces la clave por una `service_role` en el cliente o en
una variable `VITE_*`. Configura en Supabase:

1. Proveedor Email.
2. URL local y URL de producción en Redirect URLs.
3. Confirmación de correo y recuperación de contraseña.

## Base de datos

La API crea y actualiza sus tablas D1 mediante `ensureSchema`. El binding de
producción debe llamarse exactamente `DB`. La API crea índices y columnas de
compatibilidad en la primera solicitud; revisa los cambios antes de usar una
instalación existente.

## Acceso y roles

- `byvera198@gmail.com` es el administrador inicial de ProMax.
- Los demás usuarios se registran, solicitan membresía y esperan aprobación.
- Una membresía aprobada queda vinculada al primer dispositivo autorizado.
- Solo el administrador puede administrar patrones, aprobar membresías e
  importar paquetes JSON generados por Studio.
- Los jugadores autorizados pueden subir sus PDF; el navegador guarda solo los
  cartones confirmados en D1.

## Aceptación antes de producción

1. Registrar una cuenta de prueba y aprobarla desde **Usuarios**.
2. Comprobar que la cuenta aprobada solo funciona en el dispositivo vinculado.
3. Subir un PDF digital y uno escaneado; revisar los cartones marcados para OCR.
4. Importar un paquete JSON v1.1 desde Studio con la cuenta administradora.
5. Registrar bolillas repetidas y confirmar que la API las rechaza.
6. Completar un patrón, verificar el ganador y exportar PDF, Excel y CSV.
7. Cerrar sesión, volver a entrar y comprobar que la partida se restaura.

## Comprobación de disponibilidad

Después de publicar, solicita `GET https://tu-dominio/api/health`. Debe devolver
`200` y un objeto con `ok: true` y `service: "bingo-control-promax"`. Este
endpoint no valida Supabase ni D1; para validar autenticación y persistencia se
debe ejecutar la lista de aceptación anterior con una cuenta real.

