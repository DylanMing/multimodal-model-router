import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const home = await mkdtemp(join(tmpdir(), 'mmr-test-'))
process.env.DSH_HOME = home
process.env.DSH_PROFILE_DIR = ''
await writeFile(
  join(home, 'multimodal-model-router.json'),
  JSON.stringify({ version: 1, provider: 'vision', model: 'v-model' }),
  'utf8',
)

const { apply } = await import('../index.js')

/** Minimal Host context: record listeners and the bridge routes. */
function fakeCtx() {
  const listeners = new Map()
  const routes = new Map()
  const llm = {
    listProviders: () => [
      { id: 'vision', displayName: 'Vision' },
      { id: 'alt', displayName: 'Alt' },
    ],
    listModels: async (provider) => [
      { id: provider === 'alt' ? 'alt-model' : 'v-model', name: 'm', input: ['text', 'image'] },
    ],
  }
  const sctx = {
    effect(fn) {
      fn()
      return () => {}
    },
    webServer: {
      register({ path, handler }) {
        routes.set(path, handler)
        return () => routes.delete(path)
      },
    },
  }
  return {
    listeners,
    routes,
    ctx: {
      logger: { info() {}, warn() {}, error() {} },
      inject(names, callback) {
        if (names.includes('webServer')) callback(sctx)
      },
      effect(fn) {
        fn()
        return () => {}
      },
      get(name) {
        return name === 'llm' ? llm : undefined
      },
      on(name, handler) {
        listeners.set(name, handler)
        return () => listeners.delete(name)
      },
    },
  }
}

function fakeReq(method, url, body) {
  const events = new Map()
  const req = {
    method,
    url,
    on(name, handler) {
      events.set(name, handler)
      return req
    },
    destroy() {},
  }
  if (body !== undefined) {
    queueMicrotask(() => {
      events.get('data')?.(Buffer.from(JSON.stringify(body)))
      events.get('end')?.()
    })
  }
  return req
}

function fakeRes() {
  return {
    statusCode: 200,
    payload: undefined,
    setHeader() {},
    end(text) {
      this.payload = text === undefined ? undefined : JSON.parse(text)
    },
  }
}

async function call(routes, path, { method = 'GET', body, query = '' } = {}) {
  const handler = routes.get(path)
  assert.ok(handler, `route ${path} is not registered`)
  const res = fakeRes()
  await handler(fakeReq(method, `${path}${query}`, body), res)
  return { status: res.statusCode, body: res.payload }
}

const primary = () => ({ provider: 'primary', model: 'p-model' })
const agent = { id: 'session-1' }

test('routes image batches and falls back within the failed turn', async () => {
  const { listeners, ctx } = fakeCtx()
  apply(ctx, {})
  const preStep = listeners.get('agent/pre-step')
  const request = listeners.get('agent/request')
  const requestError = listeners.get('agent/request-error')

  await preStep({ agent, messages: [{ content: [{ type: 'text', text: 'hi' }] }] }, () => Promise.resolve({}))

  assert.deepEqual(await request({ agent, turn: 1, step: 1 }, () => Promise.resolve(primary())), {
    provider: 'primary',
    model: 'p-model',
  })

  await preStep({ agent, messages: [{ content: [{ type: 'image' }] }] }, () => Promise.resolve({}))
  assert.deepEqual(await request({ agent, turn: 1, step: 1 }, () => Promise.resolve(primary())), {
    provider: 'vision',
    model: 'v-model',
  })

  const action = await requestError(
    { agent, turn: 1, step: 1, provider: 'vision', failure: { code: 'upstream' }, signal: { aborted: false } },
    () => Promise.resolve(undefined),
  )
  assert.deepEqual(action, { kind: 'retry' })

  assert.deepEqual(await request({ agent, turn: 1, step: 1 }, () => Promise.resolve(primary())), {
    provider: 'primary',
    model: 'p-model',
  })

  assert.deepEqual(await request({ agent, turn: 2, step: 1 }, () => Promise.resolve(primary())), {
    provider: 'vision',
    model: 'v-model',
  })
})

test('ignores failures from other routes and aborted requests', async () => {
  const { listeners, ctx } = fakeCtx()
  apply(ctx, {})
  const requestError = listeners.get('agent/request-error')
  const agent2 = { id: 'session-2' }

  assert.equal(
    await requestError(
      { agent: agent2, turn: 1, provider: 'primary', failure: { code: 'x' }, signal: { aborted: false } },
      () => Promise.resolve(undefined),
    ),
    undefined,
  )
  assert.equal(
    await requestError(
      { agent: agent2, turn: 1, provider: 'vision', failure: { code: 'x' }, signal: { aborted: true } },
      () => Promise.resolve('aborted'),
    ),
    'aborted',
  )
})

test('file batches also switch the route', async () => {
  const { listeners, ctx } = fakeCtx()
  apply(ctx, {})
  const preStep = listeners.get('agent/pre-step')
  const request = listeners.get('agent/request')
  const agent3 = { id: 'session-3' }

  await preStep(
    { agent: agent3, messages: [{ content: [{ type: 'file', attachment: { name: 'a.txt' } }] }] },
    () => Promise.resolve({}),
  )
  assert.deepEqual(await request({ agent: agent3, turn: 1, step: 1 }, () => Promise.resolve(primary())), {
    provider: 'vision',
    model: 'v-model',
  })
})

test('a session override wins over the global default and resets on disposal', async () => {
  const { listeners, routes, ctx } = fakeCtx()
  apply(ctx, {})
  const preStep = listeners.get('agent/pre-step')
  const request = listeners.get('agent/request')
  const overridden = { id: 'session-override' }
  const plain = { id: 'session-plain' }

  const picked = await call(routes, '/api/multimodal-model-router/select', {
    method: 'POST',
    body: { scope: 'session', sessionId: overridden.id, provider: 'alt', model: 'alt-model' },
  })
  assert.equal(picked.status, 200)
  assert.equal(picked.body.value.sessionActive, true)
  assert.deepEqual(picked.body.value.effective, { provider: 'alt', model: 'alt-model' })

  const scoped = await call(routes, '/api/multimodal-model-router/state', { query: `?sessionId=${overridden.id}` })
  assert.deepEqual(scoped.body.value.effective, { provider: 'alt', model: 'alt-model' })

  const global = await call(routes, '/api/multimodal-model-router/state')
  assert.deepEqual(global.body.value.effective, { provider: 'vision', model: 'v-model' })

  await preStep({ agent: overridden, messages: [{ content: [{ type: 'image' }] }] }, () => Promise.resolve({}))
  await preStep({ agent: plain, messages: [{ content: [{ type: 'image' }] }] }, () => Promise.resolve({}))
  assert.deepEqual(await request({ agent: overridden, turn: 1, step: 1 }, () => Promise.resolve(primary())), {
    provider: 'alt',
    model: 'alt-model',
  })
  assert.deepEqual(await request({ agent: plain, turn: 1, step: 1 }, () => Promise.resolve(primary())), {
    provider: 'vision',
    model: 'v-model',
  })

  // Explicitly off for this session only.
  await call(routes, '/api/multimodal-model-router/select', {
    method: 'POST',
    body: { scope: 'session', sessionId: overridden.id, provider: null, model: null },
  })
  assert.deepEqual(await request({ agent: overridden, turn: 2, step: 1 }, () => Promise.resolve(primary())), {
    provider: 'primary',
    model: 'p-model',
  })

  // Disposal forgets the override instead of leaking it.
  listeners.get('agent/disposed')({ agent: overridden })
  const after = await call(routes, '/api/multimodal-model-router/state', { query: `?sessionId=${overridden.id}` })
  assert.equal(after.body.value.sessionActive, false)
  assert.deepEqual(after.body.value.effective, { provider: 'vision', model: 'v-model' })
})

test('the bridge rejects an unknown route and a scoped write without a session', async () => {
  const { routes, ctx } = fakeCtx()
  apply(ctx, {})

  const unknown = await call(routes, '/api/multimodal-model-router/select', {
    method: 'POST',
    body: { provider: 'nope', model: 'nope' },
  })
  assert.equal(unknown.status, 400)

  const noSession = await call(routes, '/api/multimodal-model-router/select', {
    method: 'POST',
    body: { scope: 'session', provider: 'vision', model: 'v-model' },
  })
  assert.equal(noSession.status, 400)
})

test.after(async () => {
  await rm(home, { recursive: true, force: true })
})
