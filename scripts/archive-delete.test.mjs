import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  deleteArchivedTeam,
  deleteArchivedTeamForSession,
  listArchivedTeamIds,
} from '../lib/state.js'
import { createArchiveDeleteHandler } from '../lib/index.js'
import { authenticatedWebRoutes } from '../lib/web-routes.js'

// R2 archive deletion: an archived team is removed permanently through
// `POST /plugins/dsh-agent-teams/archive-delete`, authorized by the
// captainSessionId recorded in the archived team.json (never by a live captain
// session), after the requested id is matched exactly against the archive
// listing. No backup copy survives, so the matching rule and the 500 path both
// have to be proven here.

const STATE_DIR = '.agent-teams-state'
const ARCHIVE_ROUTE = '/plugins/dsh-agent-teams/archive-delete'
const SESSION_A = 'captain-session-a'
const SESSION_B = 'captain-session-b'

const teamJson = (id, captainSessionId) => JSON.stringify({
  id,
  name: `Team ${id}`,
  captainSessionId,
  createdAt: 1_700_000_000_000,
  members: [],
  tasks: [],
  taskSeq: 0,
})

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

/** A workspace whose archive holds team-a/team-ab (one captain) and team-b (another). */
async function workspaceWithArchives() {
  const root = await mkdtemp(join(tmpdir(), 'archive-delete-test-'))
  const stateRoot = join(root, STATE_DIR)
  const archived = (id, captain) => join(stateRoot, 'archive', id)
  await mkdir(join(archived('team-a', SESSION_A), 'inbox'), { recursive: true })
  await writeFile(join(archived('team-a', SESSION_A), 'team.json'), teamJson('team-a', SESSION_A))
  await writeFile(join(archived('team-a', SESSION_A), 'inbox', 'member.jsonl'), '{"type":"message"}\n')
  await mkdir(archived('team-ab', SESSION_A), { recursive: true })
  await writeFile(join(archived('team-ab', SESSION_A), 'team.json'), teamJson('team-ab', SESSION_A))
  await mkdir(archived('team-b', SESSION_B), { recursive: true })
  await writeFile(join(archived('team-b', SESSION_B), 'team.json'), teamJson('team-b', SESSION_B))
  return { root, stateRoot, archived }
}

/** Serve one route behind the authenticated wrapper, with a controllable gate. */
async function serveRoute(t, handler, gate) {
  const routes = new Map()
  const rawServer = {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }
  const webServer = authenticatedWebRoutes(rawServer, () => gate)
  webServer.register({ kind: 'exact', path: ARCHIVE_ROUTE, handler })
  const server = createServer((req, res) => {
    const route = routes.get((req.url ?? '/').split('?')[0])
    if (route === undefined) {
      res.writeHead(404)
      res.end()
      return
    }
    Promise.resolve(route.handler(req, res)).catch((error) => {
      res.writeHead(500)
      res.end(String(error))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections()
    server.close(resolve)
  }))
  return `http://127.0.0.1:${server.address().port}${ARCHIVE_ROUTE}`
}

const allowAll = { requestRejection: () => undefined }

function call(url, { method = 'POST', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined
      ? undefined
      : typeof body === 'string' ? body : JSON.stringify(body)
    const req = request(url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(payload === undefined ? {} : { 'content-length': Buffer.byteLength(payload) }),
        ...headers,
      },
    }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => { text += chunk })
      res.on('end', () => {
        let parsed
        try {
          parsed = text === '' ? undefined : JSON.parse(text)
        } catch {
          parsed = text
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed })
      })
    })
    req.setTimeout(5_000, () => req.destroy(new Error('no response from archive-delete route')))
    req.on('error', reject)
    req.end(payload)
  })
}

test('deleteArchivedTeam removes one archive, keeps siblings, is idempotent', async (t) => {
  const { stateRoot, archived } = await workspaceWithArchives()
  t.after(() => rm(stateRoot, { recursive: true, force: true }))

  assert.equal(await deleteArchivedTeam(stateRoot, 'team-a'), true)
  assert.equal(await exists(archived('team-a', SESSION_A)), false)
  // Siblings are untouched, including the one that shares a name prefix.
  assert.deepEqual((await listArchivedTeamIds(stateRoot)).sort(), ['team-ab', 'team-b'])
  assert.equal(await exists(join(archived('team-ab', SESSION_A), 'team.json')), true)

  // Idempotent: the second delete reports "nothing removed", not an error.
  assert.equal(await deleteArchivedTeam(stateRoot, 'team-a'), false)
  assert.deepEqual((await listArchivedTeamIds(stateRoot)).sort(), ['team-ab', 'team-b'])
})

test('deleteArchivedTeam matches ids exactly: prefixes and traversal never reach the disk', async (t) => {
  const { root, stateRoot, archived } = await workspaceWithArchives()
  t.after(() => rm(root, { recursive: true, force: true }))
  // A live team outside archive/ must survive every crafted id below.
  await mkdir(join(stateRoot, 'team-a'), { recursive: true })
  await writeFile(join(stateRoot, 'team-a', 'team.json'), teamJson('team-a', SESSION_A))

  for (const crafted of ['team', 'team-', '..', '../team-b', 'team-a/../team-b', join('..', 'team-a'), '']) {
    assert.equal(await deleteArchivedTeam(stateRoot, crafted), false, `crafted id ${JSON.stringify(crafted)} must not delete`)
  }
  assert.deepEqual((await listArchivedTeamIds(stateRoot)).sort(), ['team-a', 'team-ab', 'team-b'])
  assert.equal(await exists(join(stateRoot, 'team-a', 'team.json')), true)
  assert.equal(await exists(join(archived('team-b', SESSION_B), 'team.json')), true)
})

test('deleteArchivedTeamForSession deletes only for the archived captain', async (t) => {
  const { stateRoot, archived } = await workspaceWithArchives()
  t.after(() => rm(stateRoot, { recursive: true, force: true }))

  // A different session cannot delete it, and the archive stays intact.
  assert.equal(await deleteArchivedTeamForSession(stateRoot, 'team-a', SESSION_B), false)
  assert.equal(await exists(join(archived('team-a', SESSION_A), 'team.json')), true)

  // An unreadable archive cannot prove ownership, so it is kept.
  await mkdir(archived('team-corrupt', SESSION_A), { recursive: true })
  await writeFile(join(archived('team-corrupt', SESSION_A), 'team.json'), '{"id": "team-corrupt", "members": [')
  assert.equal(await deleteArchivedTeamForSession(stateRoot, 'team-corrupt', SESSION_A), false)
  assert.equal(await exists(join(archived('team-corrupt', SESSION_A), 'team.json')), true)

  assert.equal(await deleteArchivedTeamForSession(stateRoot, 'team-a', SESSION_A), true)
  assert.equal(await exists(archived('team-a', SESSION_A)), false)
  assert.equal(await deleteArchivedTeamForSession(stateRoot, 'team-a', SESSION_A), false)
})

test('route: 401 from the authentication fence leaves every archive on disk', async (t) => {
  const { stateRoot, archived } = await workspaceWithArchives()
  const roots = [stateRoot]
  const t2 = t
  const handler = createArchiveDeleteHandler(() => roots)
  const url = await serveRoute(t2, handler, { requestRejection: () => 401 })

  const response = await call(url, { body: { sessionId: SESSION_A, teamId: 'team-a' } })
  assert.equal(response.status, 401)
  assert.equal(await exists(join(archived('team-a', SESSION_A), 'team.json')), true)
  await rm(stateRoot, { recursive: true, force: true })
})

test('route: 405 for non-POST, 400 for a missing field or a bad body', async (t) => {
  const { root, stateRoot, archived } = await workspaceWithArchives()
  t.after(() => rm(root, { recursive: true, force: true }))
  const url = await serveRoute(t, createArchiveDeleteHandler(() => [stateRoot]), allowAll)

  const get = await call(url, { method: 'GET' })
  assert.equal(get.status, 405)
  assert.equal(String(get.headers.allow ?? '').toUpperCase(), 'POST')

  assert.equal((await call(url, { body: { sessionId: SESSION_A } })).status, 400)
  assert.equal((await call(url, { body: { teamId: 'team-a' } })).status, 400)
  assert.equal((await call(url, { body: { sessionId: '   ', teamId: 'team-a' } })).status, 400)
  assert.equal((await call(url, { body: 'not json' })).status, 400)
  assert.equal((await call(url, { body: '[1,2]' })).status, 400)
  assert.equal(await exists(join(archived('team-a', SESSION_A), 'team.json')), true)
})

test('route: 404 for a foreign session or an unknown id, 200 only for the owner', async (t) => {
  const { root, stateRoot, archived } = await workspaceWithArchives()
  t.after(() => rm(root, { recursive: true, force: true }))
  // An empty workspace comes first so the handler must keep looking.
  const emptyRoot = await mkdtemp(join(tmpdir(), 'archive-delete-empty-'))
  t.after(() => rm(emptyRoot, { recursive: true, force: true }))
  const url = await serveRoute(t, createArchiveDeleteHandler(() => [emptyRoot, stateRoot]), allowAll)

  const foreign = await call(url, { body: { sessionId: SESSION_B, teamId: 'team-a' } })
  assert.equal(foreign.status, 404)
  assert.deepEqual(foreign.body, { error: 'archived team not found for this session' })
  assert.equal(await exists(join(archived('team-a', SESSION_A), 'team.json')), true)

  // A prefix is not a match, and traversal never addresses a sibling archive.
  for (const teamId of ['team', '../team-b', 'team-a/../team-b']) {
    const crafted = await call(url, { body: { sessionId: SESSION_A, teamId } })
    assert.equal(crafted.status, 404, `teamId ${JSON.stringify(teamId)} must not match`)
  }
  assert.equal(await exists(join(archived('team-b', SESSION_B), 'team.json')), true)

  const deleted = await call(url, { body: { sessionId: SESSION_A, teamId: 'team-a' } })
  assert.equal(deleted.status, 200)
  assert.deepEqual(deleted.body, { ok: true, teamId: 'team-a' })
  assert.equal(await exists(archived('team-a', SESSION_A)), false)
  // Only the requested archive is gone; the prefix sibling and the other
  // captain's team survive.
  assert.deepEqual((await listArchivedTeamIds(stateRoot)).sort(), ['team-ab', 'team-b'])

  // Deleting again is a 404, not a second success.
  const again = await call(url, { body: { sessionId: SESSION_A, teamId: 'team-a' } })
  assert.equal(again.status, 404)
})

test('route: a failed lookup answers 500 and preserves the archive', async (t) => {
  const { root, stateRoot, archived } = await workspaceWithArchives()
  t.after(() => rm(root, { recursive: true, force: true }))
  // A root whose archive path is a regular file makes the listing throw
  // (ENOTDIR) before the good root is reachable.
  const brokenRoot = await mkdtemp(join(tmpdir(), 'archive-delete-broken-'))
  t.after(() => rm(brokenRoot, { recursive: true, force: true }))
  await writeFile(join(brokenRoot, 'archive'), 'not a directory')

  const failures = []
  const url = await serveRoute(t, createArchiveDeleteHandler(() => [brokenRoot, stateRoot], (error) => failures.push(error)), allowAll)

  const response = await call(url, { body: { sessionId: SESSION_A, teamId: 'team-a' } })
  assert.equal(response.status, 500)
  assert.deepEqual(response.body, { error: 'failed to delete the archived team' })
  assert.equal(failures.length, 1)
  assert.equal(await exists(join(archived('team-a', SESSION_A), 'team.json')), true)
  assert.deepEqual((await listArchivedTeamIds(stateRoot)).sort(), ['team-a', 'team-ab', 'team-b'])
})
