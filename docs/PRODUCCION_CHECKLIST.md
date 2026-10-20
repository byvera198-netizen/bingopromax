# Checklist de producción — Bingo Control ProMax

## Validación local

```bash
npm ci
npm run build
npm run smoke
npm run smoke:worker
npm run lint
```

`smoke` comprueba el contrato del endpoint. `smoke:worker`, después del build,
levanta el artefacto con Wrangler y comprueba portada 200, `/api/health` 200 y
`/api/state` 403 sin sesión.

## Configuración externa

1. Configurar el proyecto Supabase con autenticación por correo, confirmación
   de correo y Redirect URLs locales y de producción.
2. Publicar con un binding D1 llamado exactamente `DB`; no cambiar ese nombre.
   El artefacto debe construirse con `CLOUDFLARE_D1_DATABASE_NAME` y
   `CLOUDFLARE_D1_DATABASE_ID` de `bingo-control-pro-db`; no usar la base de
   plantilla `site-creator-d1`.
3. Mantener la clave publishable en el cliente solamente. Nunca subir una
   `service_role` ni secretos a `VITE_*` o al repositorio.
4. Configurar HTTPS, dominio definitivo y un mecanismo de respaldo/exportación
   de D1 antes de aceptar partidas reales.
5. Configurar un monitor para `GET /api/health` y alertar si no recibe `200`.

## Aceptación real

- Entrar como `byvera198@gmail.com` y verificar acceso administrativo.
- Registrar una cuenta de prueba, aprobarla desde **Usuarios** y validar su
  vínculo de dispositivo.
- Subir un PDF digital y uno escaneado; revisar OCR y guardar cartones.
- Importar un paquete JSON v1.1 generado por Studio como administrador.
- Ejecutar una partida con patrones, bolillas repetidas y ganadores simultáneos.
- Cerrar sesión, volver a entrar y comprobar que el estado se restaura desde D1.
- Consultar `/api/health` desde el dominio de producción.

La publicación real, las migraciones/configuración de Supabase, el binding D1,
el dominio y los respaldos son acciones externas que deben ejecutarse con las
credenciales del propietario; no se consideran completadas por un build local.
