/**
 * Multimodal model router.
 *
 * The primary model keeps serving ordinary requests. When a request is about to
 * carry image or file content, this Host half swaps the frozen call
 * configuration of that step to the multimodal model the user selected in the
 * composer, so nothing else changes for the session.
 *
 * The selection is profile-wide and survives restarts: it is stored next to the
 * profile's configuration, and the Client half reads and writes it through the
 * small same-origin bridge registered below (the same pattern shipped plugins
 * use for hand-written UI plugins, whose browser half has no generated Remote
 * namespace of its own).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'

const BRIDGE_PREFIX = '/api/multimodal-model-router'
const MAX_BODY_BYTES = 32 * 1024
const CATALOG_TTL_MS = 30_000

/** apply() may run again on the same context during a boot re-entry. */
const appliedContexts = new WeakSet()

const IMAGE_BLOCK = 'image'
const FILE_BLOCK = 'file'

const IMAGE_EXTENSIONS = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]

function matchesBytes(data, offset, expected) {
  if (data.byteLength < offset + expected.length) return false
  for (let index = 0; index < expected.length; index += 1) {
    if (data[offset + index] !== expected[index]) return false
  }
  return true
}

function matchesAscii(data, offset, value) {
  if (data.byteLength < offset + value.length) return false
  for (let index = 0; index < value.length; index += 1) {
    if (data[offset + index] !== value.charCodeAt(index)) return false
  }
  return true
}

/** Identify a supported image format from its leading bytes. */
function sniffImageMediaType(data) {
  if (matchesBytes(data, 0, PNG_SIGNATURE)) return 'image/png'
  if (matchesBytes(data, 0, JPEG_SIGNATURE)) return 'image/jpeg'
  if (matchesAscii(data, 0, 'GIF87a') || matchesAscii(data, 0, 'GIF89a')) return 'image/gif'
  if (matchesAscii(data, 0, 'RIFF') && matchesAscii(data, 8, 'WEBP')) return 'image/webp'
  return undefined
}

function stateFilePath() {
  const profileDir = process.env.DSH_PROFILE_DIR
  if (profileDir) return join(profileDir, '.multimodal-model-router.json')
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'multimodal-model-router.json')
}

/**
 * Whether a message batch carries content a text-only route cannot read.
 * Offloaded images arrive as placeholder text, so they no longer need vision.
 */
function messagesHaveVisual(messages) {
  if (!Array.isArray(messages)) return false
  for (const message of messages) {
    const content = Array.isArray(message?.content)
      ? message.content
      : Array.isArray(message?.message?.content)
        ? message.message.content
        : null
    if (content === null) continue
    for (const block of content) {
      if (block === null || typeof block !== 'object') continue
      if (block.type === IMAGE_BLOCK && block.offloaded !== true) return true
      if (block.type === FILE_BLOCK) return true
    }
  }
  return false
}

function inputModalitiesOf(info) {
  const candidates = [
    info?.inputModalities,
    info?.modalities?.input,
    info?.input,
    info?.capabilities?.input,
  ]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }
  return null
}

function sendJson(res, status, value) {
  let body
  try {
    body = JSON.stringify(value)
  } catch {
    body = JSON.stringify({ ok: false, error: 'unserializable response' })
  }
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.end(body)
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let settled = false
    let size = 0
    const chunks = []
    const finish = (value) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        finish(undefined)
        req.destroy?.()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        finish(text === '' ? null : JSON.parse(text))
      } catch {
        finish(undefined)
      }
    })
    req.on('error', () => finish(undefined))
  })
}

/** Session identity carried by the composer's query string, if any. */
function sessionIdOf(req) {
  try {
    const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('sessionId')
    return id !== null && id !== '' ? id : null
  } catch {
    return null
  }
}

function normalizeSelection(value) {
  if (value === null || typeof value !== 'object') return { provider: null, model: null }
  const provider = typeof value.provider === 'string' && value.provider !== '' ? value.provider : null
  const model = typeof value.model === 'string' && value.model !== '' ? value.model : null
  if (provider === null || model === null) return { provider: null, model: null }
  return { provider, model }
}

export function apply(ctx, config) {
  if (appliedContexts.has(ctx)) {
    try {
      ctx.logger?.warn?.('multimodal-model-router: apply() already ran on this context, skipping')
    } catch {}
    return
  }
  appliedContexts.add(ctx)

  const log = (level, ...args) => {
    try {
      const sink = ctx.logger?.[level] ?? console[level]
      sink?.call(ctx.logger ?? console, '[multimodal-model-router]', ...args)
    } catch {}
  }

  /** Selection and its durable form. A missing file means "off". */
  let selected = normalizeSelection(config)
  let loaded = null
  let writes = Promise.resolve()

  const loadState = async () => {
    try {
      const raw = await readFile(stateFilePath(), 'utf8')
      const parsed = JSON.parse(raw)
      selected = normalizeSelection(parsed)
    } catch (error) {
      if (error?.code !== 'ENOENT') log('warn', 'could not read the saved selection:', error?.message ?? error)
    }
  }

  const saveState = (next) => {
    selected = next
    const snapshot = {
      version: 1,
      provider: next.provider,
      model: next.model,
      updatedAt: new Date().toISOString(),
    }
    const write = async () => {
      const file = stateFilePath()
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    }
    writes = writes.then(write, write)
    return writes
  }

  loaded = loadState()

  /** Model directory for the selector; cached briefly so the composer is cheap. */
  let catalogCache = null
  let catalogPending = null

  const buildCatalog = async (llm) => {
    const providers = []
    const models = []
    let routes = []
    try {
      routes = llm.listProviders()
    } catch (error) {
      log('warn', 'listProviders failed:', error?.message ?? error)
    }
    for (const entry of Array.isArray(routes) ? routes : []) {
      const id = String(entry?.id ?? entry?.provider ?? entry?.name ?? '')
      if (id === '') continue
      const name = String(entry?.displayName ?? entry?.name ?? id)
      providers.push({ id, name })
      let found = []
      try {
        found = await llm.listModels(id)
      } catch (error) {
        log('warn', `listModels("${id}") failed:`, error?.message ?? error)
      }
      for (const model of Array.isArray(found) ? found : []) {
        const modelId = String(model?.id ?? model?.model ?? '')
        if (modelId === '') continue
        const modalities = inputModalitiesOf(model)
        models.push({
          provider: id,
          providerName: name,
          model: modelId,
          name: String(model?.name ?? model?.displayName ?? modelId),
          vision: modalities === null ? null : modalities.includes(IMAGE_BLOCK),
        })
      }
    }
    return { providers, models }
  }

  const catalog = async (llm) => {
    if (catalogCache !== null && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.value
    if (catalogPending === null) {
      catalogPending = buildCatalog(llm)
        .then((value) => {
          catalogCache = { at: Date.now(), value }
          return value
        })
        .catch((error) => {
          log('warn', 'model catalog unavailable:', error?.message ?? error)
          return { providers: [], models: [] }
        })
        .finally(() => {
          catalogPending = null
        })
    }
    return catalogPending
  }

  const selectionView = () => (selected.provider !== null && selected.model !== null ? { ...selected } : null)

  /**
   * Per-session overrides live in this process only: they answer "this
   * conversation, right now" and reset when the session reopens elsewhere.
   * A stored `{ provider: null, model: null }` means "explicitly off here".
   */
  const overrides = new Map()

  const overrideOf = (agentId) => {
    if (agentId === null || agentId === undefined) return { active: false, selected: null }
    if (!overrides.has(agentId)) return { active: false, selected: null }
    const entry = overrides.get(agentId)
    const off = entry.provider === null || entry.model === null
    return { active: true, selected: off ? null : { ...entry } }
  }

  /** The route a request from this agent should use. */
  const effectiveSelection = (agentId) => overrideOf(agentId).active ? overrideOf(agentId).selected : selectionView()

  /**
   * Latest routing outcome, so the ambient hint under the composer can say what
   * actually happened instead of only what is configured.
   */
  let activity = null
  const recordActivity = (kind, agentId, route, reason) => {
    activity = {
      kind,
      sessionId: agentId === undefined ? null : String(agentId),
      provider: route?.provider ?? null,
      model: route?.model ?? null,
      at: Date.now(),
      ...(reason === undefined ? {} : { reason }),
    }
  }

  // --- Composer bridge -----------------------------------------------------

  ctx.inject(['webServer'], (sctx) => {
    sctx.effect(() => {
      const disposers = []
      try {
        disposers.push(
          sctx.webServer.register({
            kind: 'exact',
            path: `${BRIDGE_PREFIX}/state`,
            handler: async (req, res) => {
              if (req.method !== 'GET') {
                sendJson(res, 405, { ok: false, error: 'method not allowed' })
                return
              }
              try {
                await loaded
                const llm = ctx.get('llm')
                const directory = llm === undefined ? { providers: [], models: [] } : await catalog(llm)
                const agentId = sessionIdOf(req)
                const override = overrideOf(agentId)
                sendJson(res, 200, {
                  ok: true,
                  value: {
                    selected: selectionView(),
                    sessionActive: override.active,
                    session: override.selected,
                    effective: effectiveSelection(agentId),
                    providers: directory.providers,
                    models: directory.models,
                    activity,
                  },
                })
              } catch (error) {
                sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
              }
            },
          }),
        )
        disposers.push(
          sctx.webServer.register({
            kind: 'exact',
            path: `${BRIDGE_PREFIX}/select`,
            handler: async (req, res) => {
              if (req.method !== 'POST') {
                sendJson(res, 405, { ok: false, error: 'method not allowed' })
                return
              }
              const body = await readJsonBody(req)
              if (body === undefined) {
                sendJson(res, 400, { ok: false, error: 'malformed JSON body' })
                return
              }
              const next = normalizeSelection(body)
              const scope = body?.scope === 'session' ? 'session' : 'global'
              const agentId = typeof body?.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : null
              if (scope === 'session' && agentId === null) {
                sendJson(res, 400, { ok: false, error: 'session scope needs a sessionId' })
                return
              }
              try {
                await loaded
                if (scope === 'session' && body?.clear === true) {
                  overrides.delete(agentId)
                  sendJson(res, 200, {
                    ok: true,
                    value: {
                      selected: selectionView(),
                      sessionActive: false,
                      session: null,
                      effective: selectionView(),
                    },
                  })
                  return
                }
                if (next.provider !== null) {
                  const llm = ctx.get('llm')
                  if (llm !== undefined) {
                    const directory = await catalog(llm)
                    const known = directory.models.some(
                      (entry) => entry.provider === next.provider && entry.model === next.model,
                    )
                    if (directory.models.length > 0 && !known) {
                      sendJson(res, 400, {
                        ok: false,
                        error: `unknown model route: ${next.provider}/${next.model}`,
                      })
                      return
                    }
                  }
                }
                if (scope === 'session') {
                  overrides.set(agentId, { provider: next.provider, model: next.model })
                  const override = overrideOf(agentId)
                  sendJson(res, 200, {
                    ok: true,
                    value: {
                      selected: selectionView(),
                      sessionActive: override.active,
                      session: override.selected,
                      effective: effectiveSelection(agentId),
                    },
                  })
                  return
                }
                await saveState(next)
                sendJson(res, 200, {
                  ok: true,
                  value: {
                    selected: selectionView(),
                    sessionActive: agentId === null ? false : overrideOf(agentId).active,
                    session: agentId === null ? null : overrideOf(agentId).selected,
                    effective: effectiveSelection(agentId),
                  },
                })
              } catch (error) {
                log('warn', 'could not save the selection:', error?.message ?? error)
                sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
              }
            },
          }),
        )
        // Cheap poll target for the ambient hint: no catalog, just the facts.
        disposers.push(
          sctx.webServer.register({
            kind: 'exact',
            path: `${BRIDGE_PREFIX}/activity`,
            handler: async (req, res) => {
              if (req.method !== 'GET') {
                sendJson(res, 405, { ok: false, error: 'method not allowed' })
                return
              }
              try {
                await loaded
                const agentId = sessionIdOf(req)
                const override = overrideOf(agentId)
                const effective = effectiveSelection(agentId)
                let name = null
                if (effective !== null) {
                  const llm = ctx.get('llm')
                  if (llm !== undefined) {
                    try {
                      const directory = await catalog(llm)
                      name =
                        directory.models.find(
                          (entry) => entry.provider === effective.provider && entry.model === effective.model,
                        )?.name ?? null
                    } catch {}
                  }
                }
                sendJson(res, 200, {
                  ok: true,
                  value: { selected: effective, sessionActive: override.active, name, activity },
                })
              } catch (error) {
                sendJson(res, 500, { ok: false, error: String(error?.message ?? error) })
              }
            },
          }),
        )
      } catch (error) {
        log('warn', 'bridge routes unavailable:', error?.message ?? error)
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {}
        }
        return () => {}
      }
      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {}
        }
      }
    }, 'multimodal-model-router: composer bridge')
  })

  // --- Request routing -----------------------------------------------------

  /**
   * The accepted user batch is committed only after `agent/request`, so the
   * pre-step decision is the only place that can see an uploaded image on the
   * first attempt of a turn. Tool-result images are already in the durable
   * surface by the time the next request is assembled.
   */
  const pendingVisual = new Map()
  /**
   * Turn in which the multimodal route already failed for this agent. The rest
   * of that turn stays on the primary model instead of paying a failure per
   * step; the next turn tries the multimodal route again.
   */
  const fallbackTurn = new Map()

  ctx.on('agent/pre-step', (payload, next) => {
    try {
      pendingVisual.set(String(payload.agent.id), messagesHaveVisual(payload.messages))
    } catch {}
    return next()
  })

  ctx.on('agent/disposed', (payload) => {
    try {
      const id = String(payload.agent.id)
      pendingVisual.delete(id)
      fallbackTurn.delete(id)
      overrides.delete(id)
    } catch {}
  })

  ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    try {
      await loaded
      const agentId = String(payload.agent.id)
      const effective = effectiveSelection(agentId)
      if (effective === null) return config

      const fellBack = fallbackTurn.get(agentId)
      if (fellBack !== undefined && fellBack !== payload.turn) fallbackTurn.delete(agentId)
      if (fallbackTurn.get(agentId) === payload.turn) return config
      if (config.provider === effective.provider && config.model === effective.model) return config

      let visual = pendingVisual.get(agentId) === true
      if (!visual) {
        const store = ctx.get('sessions')
        const session = store?.get?.(payload.agent.id)
        if (session !== undefined && typeof session.deriveMessages === 'function') {
          visual = messagesHaveVisual(session.deriveMessages())
        }
      }
      if (!visual) return config

      // Drop explicit controls the new route may not accept; the adapter
      // resolves its own effort and token defaults under this route.
      recordActivity('routed', agentId, effective)
      return { provider: effective.provider, model: effective.model }
    } catch (error) {
      log('warn', 'routing decision failed, keeping the primary route:', error?.message ?? error)
      return config
    }
  })

  /**
   * A failed multimodal attempt falls back to the primary model. Every retry
   * re-enters `agent/request`, so marking the turn here makes the next attempt
   * resolve the primary route while `{ kind: 'retry' }` asks the loop to try
   * again instead of closing the step.
   */
  ctx.on('agent/request-error', async (payload, next) => {
    try {
      await loaded
      const agentId = String(payload.agent?.id ?? '')
      if (agentId === '') return next()
      const effective = effectiveSelection(agentId)
      if (effective === null) return next()
      if (payload.provider !== effective.provider) return next()
      if (payload.signal?.aborted === true) return next()
      if (fallbackTurn.get(agentId) === payload.turn) return next()

      fallbackTurn.set(agentId, payload.turn)
      const code = typeof payload.failure?.code === 'string' ? payload.failure.code : 'ERROR'
      recordActivity('fallback', agentId, effective, code)
      log('warn', `multimodal route ${effective.provider}/${effective.model} failed (${code}); retrying on the primary model`)
      return { kind: 'retry' }
    } catch (error) {
      log('warn', 'fallback decision failed, leaving the failure terminal:', error?.message ?? error)
      return next()
    }
  })

  /**
   * `read_image` refuses to run on a route whose exact model does not declare
   * image input, so that a text route's durable history stays free of image
   * blocks. With a multimodal model selected that refusal is precisely what
   * this plugin exists to lift: read the same file here, hand the tool's own
   * OpenAI-shaped value back (the registry renders it through the tool's output
   * contract), and the next request carries the image — which the routing above
   * sends to the multimodal model.
   */
  const ROUTE_REFUSAL = /does not declare image input/u

  const readImageValue = async (exec) => {
    const filePath = typeof exec.arguments?.file_path === 'string' ? exec.arguments.file_path : ''
    if (filePath.trim() === '') return undefined
    const fs = ctx.get('fs')
    const attachments = ctx.get('attachments')
    if (fs === undefined || attachments === undefined) return undefined
    const directory = ctx.get('workingDirectory')
    let cwd
    if (directory !== undefined && exec.agent !== undefined) {
      cwd = await directory.ensure(exec.agent, exec.signal)
    }
    const target = await fs.resolve(filePath, {
      ...(cwd === undefined ? {} : { cwd }),
      signal: exec.signal,
    })
    const info = await fs.stat(target, exec.signal)
    if (info === undefined || info.type !== 'file') return undefined
    const limits = attachments.imageLimits
    const cap = Math.min(limits.maxImageBytes, limits.maxMessageImageBytes)
    const data = await fs.readBytes(target, exec.signal, cap)
    const declared = IMAGE_EXTENSIONS[extname(filePath).toLowerCase()]
    const mediaType = declared ?? sniffImageMediaType(data)
    if (mediaType === undefined || !limits.mediaTypes.includes(mediaType)) return undefined
    const ref = await attachments.saveImage({ data, mediaType, name: basename(target.displayPath) })
    return { path: fs.processPath(target), image: { ...ref } }
  }

  ctx.on('tools/execute', async (exec, next) => {
    const result = await next()
    if (exec.name !== 'read_image' || result === undefined || result.isError !== true) return result
    if (!ROUTE_REFUSAL.test(String(result.error?.message ?? ''))) return result
    try {
      await loaded
      const effective = effectiveSelection(String(exec.agent?.id ?? ''))
      if (effective === null) return result
      const value = await readImageValue(exec)
      if (value === undefined) return result
      return { isError: false, value, content: [] }
    } catch (error) {
      log('warn', 'could not read the image for the multimodal selection:', error?.message ?? error)
      return result
    }
  })

  log('info', 'multimodal model routing ready')
}
