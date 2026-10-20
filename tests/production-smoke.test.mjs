import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('el build conserva el endpoint público de salud', async () => {
  const route = await readFile(new URL('../app/api/health/route.ts', import.meta.url), 'utf8')

  assert.match(route, /export async function GET/)
  assert.match(route, /ok: true/)
  assert.match(route, /bingo-control-promax/)
  assert.doesNotMatch(route, /authorization|SUPABASE|DB|service_role/)
})

test('la documentación de producción exige el binding D1 correcto', async () => {
  const deployment = await readFile(new URL('../docs/DESPLIEGUE.md', import.meta.url), 'utf8')
  const checklist = await readFile(new URL('../docs/PRODUCCION_CHECKLIST.md', import.meta.url), 'utf8')

  assert.match(deployment, /\/api\/health/)
  assert.match(deployment, /binding D1.*`DB`/)
  assert.match(checklist, /`service_role`/)
})
