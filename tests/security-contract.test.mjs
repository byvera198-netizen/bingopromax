import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function read(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('protege la API de estado con sesión, membresía y dispositivo', async () => {
  const route = await read('app/api/state/route.ts')

  assert.match(route, /authorization\.startsWith\("Bearer "\)/)
  assert.match(route, /auth\/v1\/user/)
  assert.match(route, /membership\.status !== "approved"/)
  assert.match(route, /device_id/)
  assert.match(route, /storedDevice !== deviceId/)
  assert.match(route, /access\.role !== "admin"/)
})

test('mantiene las operaciones administrativas fuera del alcance de jugadores', async () => {
  const route = await read('app/api/state/route.ts')
  const consoleSource = await read('app/game-console.tsx')

  assert.match(route, /adminOnlyActions/)
  assert.match(route, /source.*studio-package.*access\.role !== "admin"/s)
  assert.match(route, /Solo un administrador puede importar paquetes generados por Studio/)
  assert.match(consoleSource, /access\?\.role === "admin" && <input/)
  assert.match(consoleSource, /access\?\.role === "admin" && proMaxImport\.patterns\.length/)
})

test('no conserva documentos fuente en los endpoints de compatibilidad', async () => {
  const route = await read('app/api/files/route.ts')

  assert.match(route, /no conserva archivos fuente/)
  assert.match(route, /status: 410/)
})
