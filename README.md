# Bingo Control Pro

## Abrir la aplicación

### [▶ Abrir Bingo Control Pro Ecuador](https://bingo-control-pro-ecuador.eemite.chatgpt.site)

Esta página de GitHub conserva el código fuente y la documentación. La aplicación
funcional se abre desde el botón anterior.

Aplicación web para gestionar partidas de bingo en tiempo real. Permite importar
cartones desde PDF, crearlos manualmente, registrar bolillas, validar patrones y
detectar uno o varios ganadores de forma automática.

## Funciones incluidas

- Importación múltiple de PDF con extracción directa de texto y OCR de respaldo.
- Detección de cuadrículas 5×5 y reconocimiento OCR de la numeración `Tab#`.
- Edición manual del número de cada cartón y validación de duplicados.
- Ingreso manual con centro libre, número de cartón y serie.
- Bolillero manual y teclado visual del 1 al 75, sin números repetidos.
- Motor incremental de validación para cartones activos.
- Patrones simultáneos editables, eliminables y personalizables por cada usuario.
- Pausa automática configurable cuando se detecta un ganador.
- Historial de bolillas, cartones anulables, ganadores y auditoría.
- Reporte PDF con bolillas, patrones y cartones ganadores completos.
- Tema claro/oscuro, sonidos, diseño adaptable y recuperación automática.
- Persistencia estructurada de partidas, membresías y administradores.
- Procesamiento local de los PDF: los archivos originales no se almacenan.
- Usuarios autorizados por membresía y vinculados a un solo dispositivo.

## Inicio local

Requisitos: Node.js 22.13 o superior.

```bash
npm install
npm run dev
```

La aplicación queda disponible en `http://localhost:3000`.

## Verificación

```bash
npm run build
npm run lint
npm test
```

Después de modificar `db/schema.ts`, genera una migración con:

```bash
npm run db:generate
```

## Estructura

- `app/page.tsx`: interfaz y flujos de operación.
- `app/api/state/route.ts`: API de partidas, cartones, bolillas y ganadores.
- `app/api/files/route.ts`: bloqueo explícito del almacenamiento de PDF.
- `lib/bingo.ts`: patrones y motor de validación.
- `lib/pdf-parser.ts`: extracción PDF, reconocimiento OCR y armado de cartones.
- `db/schema.ts`: modelo de datos.
- `drizzle/`: migraciones versionadas.
- `docs/`: manuales de usuario, administración y arquitectura.

## Seguridad y datos

Todas las consultas usan sentencias preparadas y cada partida queda aislada por
usuario. Los PDF se procesan únicamente en el navegador para extraer los
cartones; no se envían ni se guardan en la plataforma.

El OCR es una ayuda de reconocimiento: antes de iniciar una partida conviene
revisar visualmente los cartones importados, especialmente cuando el escaneo
tiene baja resolución, inclinación o sombras.
