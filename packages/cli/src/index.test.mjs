import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('./index.ts', import.meta.url))
const tsx = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url))

test('wide layout is accepted and listed in help', () => {
  const help = spawnSync(tsx, [cli, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /standard\|essay\|feature\|wide/)

  const update = spawnSync(tsx, [cli, 'posts', 'update', 'post-1', '--expected-version', '1',
    '--layout', 'wide', '--dry-run', '--api-url', 'https://example.com', '--token', 'vc_test'],
  { encoding: 'utf8' })
  assert.equal(update.status, 0, update.stderr)
  assert.match(update.stdout, /"layout":\s*"wide"/)
})

test('CLI layout list matches @vc/config PRESENTATION_LAYOUTS', async () => {
  const { readFile } = await import('node:fs/promises')
  const list = (src) => JSON.parse(/PRESENTATION_LAYOUTS = (\[[^\]]*\])/.exec(src)[1].replace(/'/g, '"'))
  const cliSrc = await readFile(cli, 'utf8')
  const configSrc = await readFile(fileURLToPath(new URL('../../config/src/index.ts', import.meta.url)), 'utf8')
  assert.deepEqual(list(cliSrc), list(configSrc))
})
