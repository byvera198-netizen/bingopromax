# Manual de administración

## Datos y recuperación

La información estructurada se guarda en D1. Los PDF se procesan en el
navegador y no se conservan después de extraer y confirmar los cartones. La
interfaz restaura la partida, cartones, bolillas, patrón y ganadores al volver
a abrirse.

## Roles operativos

La plataforma puede identificar al usuario mediante el encabezado autenticado
del espacio de trabajo. La API no confía en nombres enviados por el navegador:
la auditoría toma la identidad del servidor. Para restringir la aplicación a
un grupo concreto, configura la política privada del sitio publicado.

## Copias de seguridad

La capa de alojamiento gestiona la durabilidad de D1. Para respaldo externo,
exporta periódicamente los reportes Excel/CSV y los datos operativos necesarios.
Las migraciones versionadas están en `drizzle/`.

## Mantenimiento

1. Ejecuta `npm install`.
2. Verifica cambios con `npm test`.
3. Si cambia el esquema, ejecuta `npm run db:generate`.
4. Revisa el SQL generado antes de publicar.

## Controles implementados

- sentencias preparadas contra inyección SQL;
- React escapa contenido de usuario contra XSS;
- validación de tipo, checksum y metadatos de PDF antes del procesamiento;
- índices y restricciones únicas para cartones, bolillas y ganadores;
- registro de auditoría para cambios relevantes;
- límites funcionales de 1–90 en el bolillero.
