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

/** Minimal Host context: record listeners, satisfy the two services used. */
function fakeCtx() {
  const listeners = new Map()
  return {
    listeners,
    ctx: {
      logger: { info() {}, warn() {}, error() {} },
      inject() {},
      effect(fn) {
        fn()
        return () => {}
      },
      get() {
        return undefined
      },
      on(name, handler) {
        listeners.set(name, handler)
        return () => listeners.delete(name)
      },
    },
  }
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

  // Plain text stays on the primary route.
  assert.deepEqual(await request({ agent, turn: 1, step: 1 }, () => Promise.resolve(primary())), {
    provider: 'primary',
    model: 'p-model',
  })

  // An image batch switches the step to the selected route.
  await preStep({ agent, messages: [{ content: [{ type: 'image' }] }] }, () => Promise.resolve({}))
  assert.deepEqual(await request({ agent, turn: 1, step: 1 }, () => Promise.resolve(primary())), {
    provider: 'vision',
    model: 'v-model',
  })

  // A failure on that route asks the loop to retry.
  const action = await requestError(
    { agent, turn: 1, step: 1, provider: 'vision', failure: { code: 'upstream' }, signal: { aborted: false } },
    () => Promise.resolve(undefined),
  )
  assert.deepEqual(action, { kind: 'retry' })

  // The retry of the same turn resolves the primary route instead.
  assert.deepEqual(await request({ agent, turn: 1, step: 1 }, () => Promise.resolve(primary())), {
    provider: 'primary',
    model: 'p-model',
  })

  // The next turn gets a fresh chance at the multimodal route.
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

test.after(async () => {
  await rm(home, { recursive: true, force: true })
})
