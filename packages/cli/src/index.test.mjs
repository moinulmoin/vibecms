import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cli = fileURLToPath(new URL('./index.ts', import.meta.url))
const tsx = fileURLToPath(new URL('../../../node_modules/.bin/tsx', import.meta.url))
const fetchMock = fileURLToPath(new URL('./mock-fetch.mjs', import.meta.url))
const env = { ...process.env, VIBECMS_API_URL: 'https://example.com', VIBECMS_TOKEN: 'vc_test' }
const run = (args, extraEnv = {}) => spawnSync(tsx, [cli, ...args], { encoding: 'utf8', env: { ...env, ...extraEnv } })

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

test('agent parity commands build the expected requests', () => {
  const run = (...args) => spawnSync(tsx, [cli, ...args, '--dry-run', '--api-url', 'https://example.com', '--token', 'vc_test'], { encoding: 'utf8' })
  const unarchive = run('posts', 'unarchive', 'post-1')
  assert.equal(unarchive.status, 0, unarchive.stderr)
  assert.match(unarchive.stdout, /posts\/post-1\/unarchive/)
  const update = run('assets', 'update', 'asset-1', '--alt', 'A tree')
  assert.equal(update.status, 0, update.stderr)
  assert.match(update.stdout, /"altText":\s*"A tree"/)
  const schedule = run('--api-url', 'https://example.com', 'posts', 'schedule', 'post-1', '--expected-version', '3', '--at', '2026-10-01T09:00:00Z')
  assert.equal(schedule.status, 0, schedule.stderr)
  assert.match(schedule.stdout, /posts\/post-1\/schedule/)
  assert.match(schedule.stdout, /"versionNumber":\s*3/)
  assert.match(schedule.stdout, /"publishAt":\s*"2026-10-01T09:00:00Z"/)
  const unschedule = run('posts', 'unschedule', 'post-1')
  assert.equal(unschedule.status, 0, unschedule.stderr)
  assert.match(unschedule.stdout, /posts\/post-1\/unschedule/)
  const rotate = run('posts', 'rotate-preview', 'post-1')
  assert.equal(rotate.status, 0, rotate.stderr)
  assert.match(rotate.stdout, /posts\/post-1\/preview\/rotate/)
  const preview = run('posts', 'preview', 'post-1')
  assert.equal(preview.status, 0, preview.stderr)
  assert.match(preview.stdout, /"postId":\s*"post-1"/)
})

test('Manage commands build the REST requests and preserve JSON payloads', () => {
  const run = (...args) => spawnSync(tsx, [cli, ...args, '--dry-run', '--api-url', 'https://example.com', '--token', 'vc_test'], { encoding: 'utf8' })
  const check = (args, method, path, body) => {
    const output = run(...args)
    assert.equal(output.status, 0, output.stderr)
    const request = JSON.parse(output.stdout)
    assert.equal(request.method, method)
    assert.equal(new URL(request.url).pathname, `/api/v1/${path}`)
    if (body) assert.deepEqual(request.body, body)
  }
  check(['sites', 'update', '--expected-updated-at', '12', '--data', '{"name":"Field Notes"}'], 'PATCH', 'site', { expectedUpdatedAt: 12, name: 'Field Notes' })
  check(['sites', 'theme', 'update', '--expected-updated-at', '12', '--data', '{"template":"editorial","keepLook":true}'], 'PATCH', 'site/theme', { expectedUpdatedAt: 12, template: 'editorial', keepLook: true })
  check(['sites', 'theme', 'revert', '--expected-updated-at', '13'], 'POST', 'site/theme/revert', { expectedUpdatedAt: 13 })
  check(['sites', 'voice', 'update', '--expected-updated-at', '0', '--data', '{"audience":"Readers","tone":"Clear","doRules":[],"dontRules":[],"representativePostIds":[]}'], 'PUT', 'site/voice', { expectedUpdatedAt: 0, audience: 'Readers', tone: 'Clear', doRules: [], dontRules: [], representativePostIds: [] })
  check(['sites', 'signup-form', 'update', '--expected-updated-at', '14', '--data', '{"heading":"Join"}'], 'PATCH', 'site/signup-form', { expectedUpdatedAt: 14, heading: 'Join' })
  check(['sites', 'theme', 'get'], 'GET', 'site/theme')
  check(['tags', 'list'], 'GET', 'tags')
  check(['analytics', 'get', '--range', '90'], 'GET', 'analytics')
  const help = spawnSync(tsx, [cli, '--help'], { encoding: 'utf8' })
  assert.match(help.stdout, /tags list/)
  assert.match(help.stdout, /analytics get/)
  assert.match(help.stdout, /sites theme get/)
})

test('every mutation sends zero requests under --dry-run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vibecms-cli-'))
  const log = join(dir, 'fetch.log')
  const data = ['--data', '{}', '--expected-updated-at', '1']
  const cases = [
    ['sites', 'update', ...data], ['sites', 'theme', 'update', ...data],
    ['sites', 'theme', 'revert', '--expected-updated-at', '1'],
    ['sites', 'voice', 'update', ...data], ['sites', 'signup-form', 'update', ...data],
    ['posts', 'create', '--title', 'T', '--slug', 't', '--content', 'Body'],
    ['posts', 'update', 'p', '--expected-version', '1', '--title', 'T'],
    ['posts', 'preview', 'p'], ['posts', 'publish', 'p', '--expected-version', '1'],
    ['posts', 'schedule', 'p', '--version-number', '1', '--at', '2026-10-01T09:00:00Z'],
    ['posts', 'unschedule', 'p'], ['posts', 'rotate-preview', 'p'],
    ['posts', 'restore', 'p', '1', '--expected-version', '2'],
    ['posts', 'archive', 'p', '--expected-version', '2'], ['posts', 'unarchive', 'p'],
    ['assets', 'update', 'a', '--alt', 'Tree'], ['assets', 'upload', cli, '--alt', 'Tree'],
    ['assets', 'delete', 'a'],
  ]
  for (const args of cases) {
    const fixed = args[0] === 'assets' && args[1] === 'upload' ? ['assets', 'upload', join(dir, 'image.png'), '--alt', 'Tree'] : args
    if (fixed[1] === 'upload') writeFileSync(fixed[2], 'image')
    const result = run([...fixed, '--dry-run', '--json'], { NODE_OPTIONS: `--import=${fetchMock}`, VC_FETCH_LOG: log })
    assert.equal(result.status, 0, `${fixed.join(' ')}: ${result.stderr}`)
  }
  assert.equal(readFileSync(log, { encoding: 'utf8', flag: 'a+' }), '')
})

test('assets delete --dry-run never calls DELETE', () => {
  const log = join(mkdtempSync(join(tmpdir(), 'vibecms-delete-')), 'fetch.log')
  const result = run(['assets', 'delete', 'asset-1', '--dry-run', '--json'], { NODE_OPTIONS: `--import=${fetchMock}`, VC_FETCH_LOG: log })
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { dryRun: true, method: 'DELETE', url: 'https://example.com/api/v1/assets/asset-1', body: null })
  assert.equal(readFileSync(log, { encoding: 'utf8', flag: 'a+' }), '')
})

test('JSON errors are single structured stderr objects with stable exit codes', () => {
  const check = (args, code, errorCode, extraEnv = {}) => {
    const result = run([...args, '--json'], extraEnv)
    assert.equal(result.status, code, result.stderr)
    assert.equal(result.stdout, '')
    const lines = result.stderr.trim().split('\n')
    assert.equal(lines.length, 1)
    const parsed = JSON.parse(lines[0])
    assert.equal(parsed.error.code, errorCode)
    assert.equal(typeof parsed.error.message, 'string')
  }
  check(['posts', 'update', 'p'], 2, 'USAGE_ERROR')
  check(['sites', 'update', '--expected-updated-at', '1', '--data', '{'], 2, 'USAGE_ERROR')
  check(['site'], 5, 'CONFLICT', { NODE_OPTIONS: `--import=${fetchMock}`, VC_FETCH_STATUS: '409', VC_FETCH_BODY: '{"error":{"code":"CONFLICT","message":"Stale","details":{"id":"p"}}}' })
  check(['site'], 1, 'NETWORK', { NODE_OPTIONS: `--import=${fetchMock}`, VC_FETCH_THROW: '1' })
})

test('tags, search, revision flags, and unsupported flags', () => {
  const dry = (args) => run([...args, '--dry-run', '--json'])
  assert.deepEqual(JSON.parse(dry(['posts', 'update', 'p', '--expected-version', '1', '--tags', '']).stdout).body.tags, [])
  assert.equal('tags' in JSON.parse(dry(['posts', 'update', 'p', '--expected-version', '1']).stdout).body, false)
  assert.deepEqual(JSON.parse(dry(['posts', 'archive', 'p', '--expected-version', '3']).stdout).body, { expectedVersionNumber: 3 })
  assert.deepEqual(JSON.parse(dry(['posts', 'schedule', 'p', '--version-number', '3', '--at', '2026-10-01T09:00:00Z']).stdout).body,
    { versionNumber: 3, publishAt: '2026-10-01T09:00:00Z' })
  const bad = run(['posts', 'get', 'p', '--tags', 'a', '--json'])
  assert.equal(bad.status, 2)
  assert.match(JSON.parse(bad.stderr).error.message, /--tags/)
  const log = join(mkdtempSync(join(tmpdir(), 'vibecms-search-')), 'fetch.log')
  const search = run(['posts', 'search', 'hello', '--offset', '7'], { NODE_OPTIONS: `--import=${fetchMock}`, VC_FETCH_LOG: log })
  assert.equal(search.status, 0, search.stderr)
  assert.equal(new URL(readFileSync(log, 'utf8').trim().split(' ')[1]).searchParams.get('offset'), '7')
})

test('schema uses remote spec, exposes request and response, and reports unavailable schemas', () => {
  const spec = JSON.stringify({ paths: { '/api/v1/example': { post: { operationId: 'doExample', requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } } }, responses: { '200': { content: { 'application/json': { schema: { type: 'string' } } } } } } } } })
  const result = run(['schema', 'doExample', '--json'], { NODE_OPTIONS: `--import=${fetchMock}`, VC_FETCH_BODY: spec })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).requestBody.content['application/json'].schema.properties.name.type, 'string')
  assert.equal(JSON.parse(result.stdout).responses['200'].content['application/json'].schema.type, 'string')
  const unavailable = run(['schema', '--json'], { NODE_OPTIONS: `--import=${fetchMock}`, VC_FETCH_THROW: '1' })
  assert.equal(unavailable.status, 1)
  assert.match(JSON.parse(unavailable.stderr).error.message, /API schema unavailable/)
})

test('signup form getter and per-command help expose fields and revision sources', () => {
  const site = { updatedAt: 42, signupForm: { enabled: true, heading: 'Join' } }
  const get = run(['sites', 'signup-form', 'get', '--json'], { NODE_OPTIONS: `--import=${fetchMock}`, VC_FETCH_BODY: JSON.stringify(site) })
  assert.equal(get.status, 0, get.stderr)
  assert.deepEqual(JSON.parse(get.stdout), site)
  const help = run(['sites', 'signup-form', 'update', '--help'])
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /heading \(string\)/)
  assert.match(help.stdout, /updatedAt from/)
  assert.doesNotMatch(help.stdout, /posts create/)
  assert.equal(run(['help', 'sites', 'signup-form', 'update']).stdout, help.stdout)
  const voice = run(['sites', 'voice', 'update', '--help'])
  assert.match(voice.stdout, /voiceProfile.revision/)
  const top = run(['--help'])
  assert.match(top.stdout, /publish, schedule, archive, and sites \* changes affect the live site/)
})

test('maintained --data help fields match the OpenAPI request schemas', () => {
  const spec = JSON.parse(readFileSync(fileURLToPath(new URL('../../../apps/api/openapi.json', import.meta.url)), 'utf8'))
  const cases = [
    ['sites update', '/api/v1/site', 'patch'],
    ['sites theme update', '/api/v1/site/theme', 'patch'],
    ['sites voice update', '/api/v1/site/voice', 'put'],
    ['sites signup-form update', '/api/v1/site/signup-form', 'patch'],
  ]
  for (const [command, path, method] of cases) {
    const help = run([...command.split(' '), '--help']).stdout
    const properties = spec.paths[path][method].requestBody.content['application/json'].schema.properties
    for (const [name, schema] of Object.entries(properties)) {
      if (name === 'expectedUpdatedAt') continue
      const type = Array.isArray(schema.type) ? schema.type.join('|') : schema.type
      assert.ok(help.includes(`${name} (${type})`), `${command}: missing ${name} (${type})`)
    }
  }
})

test('per-command value hints match the API enums', () => {
  const spec = JSON.parse(readFileSync(fileURLToPath(new URL('../../../apps/api/openapi.json', import.meta.url)), 'utf8'))
  const theme = spec.paths['/api/v1/site/theme'].patch.requestBody.content['application/json'].schema.properties
  const help = spawnSync(tsx, [cli, 'sites', 'theme', 'update', '--help'], { encoding: 'utf8' }).stdout
  for (const key of ['template', 'accent', 'font', 'radius', 'width', 'mode']) {
    const line = help.split('\n').find((l) => l.trim().startsWith(`${key}:`))
    assert.ok(line, `help lists ${key}`)
    for (const value of line.split(':')[1].split('|').map((v) => v.trim().split(' ')[0])) {
      assert.ok(theme[key].enum.includes(value), `${key}: ${value}`)
    }
  }
  const status = spec.paths['/api/v1/posts'].get.parameters.find((p) => p.name === 'status').schema.enum
  const listHelp = spawnSync(tsx, [cli, 'posts', 'list', '--help'], { encoding: 'utf8' }).stdout
  const statusLine = listHelp.split('\n').find((l) => l.trim().startsWith('status:'))
  assert.deepEqual(statusLine.split(':')[1].split('|').map((v) => v.trim()).sort(), [...status].sort())
})

test('output adds a readable ISO time next to each Unix timestamp', () => {
  const body = JSON.stringify([{ id: 'p1', updatedAt: 1790263442, publishedAt: null, scheduledPublish: { publishAt: 1790586000 }, versionNumber: 3 }])
  const result = run(['posts', 'list', '--json'], { NODE_OPTIONS: `--import=${fetchMock}`, VC_FETCH_BODY: body })
  assert.equal(result.status, 0, result.stderr)
  const [post] = JSON.parse(result.stdout)
  assert.equal(post.updatedAt, 1790263442)
  assert.equal(post.updatedAtIso, '2026-09-24T15:24:02.000Z')
  assert.equal(post.scheduledPublish.publishAtIso, '2026-09-28T09:00:00.000Z')
  assert.equal('publishedAtIso' in post, false)
  assert.equal('versionNumberIso' in post, false)
})
