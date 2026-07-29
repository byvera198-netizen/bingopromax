# Bingo Control Pro

Aplicación web para gestionar partidas de bingo en tiempo real. Permite importar
cartones desde PDF, crearlos manualmente, registrar bolillas, validar patrones y
detectar uno o varios ganadores de forma automática.

## Funciones incluidas

- Importación múltiple de PDF con extracción directa de texto y OCR de respaldo.
- Detección de cuadrículas 5×5, páginas de origen y archivos duplicados.
- Ingreso manual con centro libre, número de cartón y serie.
- Bolillero manual y teclado visual del 1 al 90, sin números repetidos.
- Motor incremental de validación para cartones activos.
- 14 patrones predefinidos y editor visual de patrones personalizados.
- Pausa automática configurable cuando se detecta un ganador.
- Historial de bolillas, cartones anulables, ganadores y auditoría.
- Exportación de reportes a PDF, Excel y CSV.
- Tema claro/oscuro, sonidos, diseño adaptable y recuperación automática.
- Persistencia estructurada en D1 y almacenamiento de los PDF originales en R2.

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
- `app/api/files/route.ts`: almacenamiento y deduplicación de PDF.
- `lib/bingo.ts`: patrones y motor de validación.
- `lib/pdf-parser.ts`: extracción PDF, reconocimiento OCR y armado de cartones.
- `db/schema.ts`: modelo de datos.
- `drizzle/`: migraciones versionadas.
- `docs/`: manuales de usuario, administración y arquitectura.

## Seguridad y datos

Todas las consultas usan sentencias preparadas. El almacenamiento de archivos
acepta únicamente PDF y comprueba su huella SHA-256 para evitar duplicados. Las
acciones quedan asociadas al usuario autenticado del espacio de trabajo cuando
la plataforma envía su identidad; en desarrollo se registran como
`Operador local`.

El OCR es una ayuda de reconocimiento: antes de iniciar una partida conviene
revisar visualmente los cartones importados, especialmente cuando el escaneo
tiene baja resolución, inclinación o sombras.
