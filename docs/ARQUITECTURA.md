# Arquitectura técnica

## Componentes

La aplicación usa React, TypeScript y el App Router compatible con Workers. Los
endpoints se ejecutan en el mismo despliegue:

- `GET /api/state`: crea/restaura la partida más reciente y entrega su estado.
- `POST /api/state`: comandos de cartones, bolillas, patrones y ganadores.
- `POST /api/files`: almacena un PDF validado y deduplicado.

## Persistencia

D1 contiene `games`, `cards`, `draws`, `patterns`, `winners`, `files` y
`audit_logs`. R2 guarda los bytes originales de los PDF. El checksum SHA-256
relaciona cada archivo con sus metadatos.

## Importación PDF

El navegador usa PDF.js para obtener posiciones y valores numéricos. Las filas
se agrupan por coordenadas, se dividen en bloques de cinco y se ensamblan en
cuadrículas. Si una página no produce una cuadrícula válida, Tesseract aplica
OCR y el analizador busca secuencias de 24/25 valores.

## Motor de validación

Cada patrón contiene una o varias variantes de índices de casillas. Después de
una bolilla, un `Set` ofrece búsqueda O(1) y cada cartón se verifica únicamente
contra las casillas requeridas por el patrón. Las restricciones únicas del
servidor impiden duplicar bolillas o ganadores incluso ante solicitudes
simultáneas.

## Evolución

Para volúmenes sostenidos de cientos de miles de cartones, el siguiente paso es
mantener un índice invertido `número → cartón/casilla` en servidor o Durable
Objects y procesar únicamente candidatos afectados por la última bolilla. La
interfaz actual ya usa actualización incremental y puede adoptar ese motor sin
cambiar la experiencia del operador.
