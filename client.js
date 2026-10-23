window.__ModuleLoader__.load({
  id: 'dsh-multimodal-model-router',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Namespace for the locale dictionaries this bundle registers. */
    const NS = 'multimodal-model-router'
    const PREFIX = '/api/multimodal-model-router'
    const BUNDLE_NAME = 'dsh-multimodal-model-router'
    /** Compact control beside the composer submit action. */
    const COMPOSER_SLOT = 'conversation.input.right'
    /** Field on this bundle's own page in the Plugins surface. */
    const BUNDLE_SLOT = 'plugins.bundle.config'
    /** Ambient hint below the composer card. */
    const DOCK_SLOT = 'conversation.composer.dock'
    /** How long a routing outcome stays worth mentioning. */
    const ACTIVITY_TTL_MS = 120_000
    const SLOT_ID = 'multimodal-model-router'
    const SEP = '\u0001'

    const DICT = {
      en: {
        title: 'Multimodal model',
        hint: 'Requests that carry images or files use this model; every other request stays on the primary model. Applies to all sessions unless this one overrides it.',
        panelHint:
          'Pick the model that should receive image and file content. Everything else — ordinary chat, tools, subagents — keeps the primary model selected in the composer.',
        panelField: 'Model for image and file requests',
        appliesAll: 'Applies to every session that has no override of its own. A single session can override this from the composer toolbar.',
        warnNotVision:
          'This model does not declare image input, so image content is dropped instead of sent. Enable image input for it under Settings → Models.',
        summaryOff: 'Off — every request uses the primary model',
        summaryOn: 'Image and file requests use {model}',
        dockTo: 'Images/files → {model}',
        dockRouted: 'just switched',
        dockFallback: 'vision route failed — fell back to the primary model',
        scopeGlobal: 'All',
        scopeSession: 'This session',
        scopeToSession: 'Give this session its own model; the global default stays unchanged',
        scopeToGlobal: 'Follow the global setting again',
        off: 'Off (primary model)',
        visionGroup: 'image-capable',
        otherGroup: 'other models',
        loading: 'Loading…',
        none: 'No models available',
        unavailable: 'Multimodal model setting unavailable',
        failure: 'Could not save the multimodal model',
      },
      zh: {
        title: '多模态模型',
        hint: '带图片或文件内容的请求使用该模型，其余请求仍使用主模型；默认对所有会话生效，可切换为仅本会话。',
        panelHint:
          '选择用来接收图片与文件内容的模型。普通对话、工具调用、子代理等其余请求，仍然使用输入框里选的主模型。',
        panelField: '处理图片与文件请求的模型',
        appliesAll: '对没有单独覆盖的会话生效；单个会话可以在输入框工具栏里临时覆盖。',
        warnNotVision:
          '该模型未声明支持图片输入，图片内容会被丢弃而不是发送；请在“设置 → 模型”里为它启用图片输入。',
        summaryOff: '关闭 —— 所有请求使用主模型',
        summaryOn: '图片与文件请求使用 {model}',
        dockTo: '图片/文件 → {model}',
        dockRouted: '刚刚已切换',
        dockFallback: '视觉路由失败，已回退主模型',
        scopeGlobal: '全局',
        scopeSession: '本会话',
        scopeToSession: '让本会话单独使用一个模型，全局默认不变',
        scopeToGlobal: '恢复跟随全局设置',
        off: '关闭（使用主模型）',
        visionGroup: '支持图片',
        otherGroup: '其他模型',
        loading: '加载中…',
        none: '暂无可选模型',
        unavailable: '多模态模型设置不可用',
        failure: '多模态模型保存失败',
      },
    }

    const CSS = [
      /* composer control */
      '.mmr-root{display:inline-flex;align-items:center;gap:3px;min-width:0;max-width:262px;color:var(--dsw-alias-label-secondary)}',
      '.mmr-icon{flex:none;width:14px;height:14px;opacity:.7;pointer-events:none}',
      '.mmr-root[data-warn="true"] .mmr-icon{color:var(--dsw-alias-state-warn-primary);opacity:1}',
      '.mmr-scope{flex:none;height:20px;padding:0 5px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:transparent;color:inherit;font:inherit;font-size:10.5px;line-height:1;white-space:nowrap;cursor:pointer}',
      '.mmr-scope:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
      '.mmr-scope:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.mmr-scope[data-active="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.mmr-scope:disabled{opacity:.5;cursor:default}',
      '.mmr-select{appearance:auto;min-width:64px;max-width:176px;height:26px;padding:0 2px;border:1px solid transparent;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:1.2;text-overflow:ellipsis;cursor:pointer}',
      '.mmr-select:hover:not(:disabled){border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}',
      '.mmr-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.mmr-select:disabled{opacity:.55;cursor:default}',
      '.mmr-select option{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}',
      '.mmr-select[data-failed="true"]{border-color:var(--dsw-alias-state-error-primary)}',
      /* bundle settings page */
      '.mmr-panel{display:flex;flex-direction:column;gap:12px;max-width:560px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}',
      '.mmr-panel-head{display:flex;align-items:flex-start;gap:8px}',
      '.mmr-panel-head .mmr-icon{width:16px;height:16px;margin-top:2px;opacity:.85}',
      '.mmr-panel-title{font-size:13px;font-weight:600;line-height:1.4}',
      '.mmr-panel-desc{margin-top:4px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.mmr-field{display:flex;flex-direction:column;gap:6px}',
      '.mmr-field-label{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.mmr-panel-select{width:100%;max-width:340px;height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:inherit;font:inherit;font-size:12.5px;cursor:pointer}',
      '.mmr-panel-select:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}',
      '.mmr-panel-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.mmr-panel-select:disabled{opacity:.6;cursor:default}',
      '.mmr-panel-select option{background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}',
      '.mmr-note{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.mmr-note[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary)}',
      '.mmr-note[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}',
      '.mmr-summary{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      /* ambient hint under the composer */
      '.mmr-dock{display:flex;align-items:center;gap:5px;padding:3px 2px 0;font:inherit;font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.mmr-dock .mmr-icon{width:12px;height:12px;opacity:.6}',
      '.mmr-dock[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary)}',
      '.mmr-dock[data-tone="warn"] .mmr-icon{opacity:1}',
      '.mmr-dock-model{color:var(--dsw-alias-label-primary)}',
      '.mmr-dock-tail{opacity:.75}',
    ].join('')

    function keyOf(entry) {
      return `${entry.provider}${SEP}${entry.model}`
    }

    function decode(value) {
      const index = value.indexOf(SEP)
      if (index < 0) return null
      const provider = value.slice(0, index)
      const model = value.slice(index + SEP.length)
      if (provider === '' || model === '') return null
      return { provider, model }
    }

    function eyeIcon(className) {
      return h(
        'svg',
        {
          className,
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          fill: 'none',
          'aria-hidden': true,
        },
        h('path', {
          d: 'M1.6 8s2.2-3.7 6.4-3.7S14.4 8 14.4 8s-2.2 3.7-6.4 3.7S1.6 8 1.6 8Z',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinejoin: 'round',
        }),
        h('circle', { cx: 8, cy: 8, r: 1.8, stroke: 'currentColor', strokeWidth: 1.3 }),
      )
    }

    const inject = ['slots', 'locale']

    function apply(ctx) {
      const translate = (key, vars) => {
        const active = String(ctx.locale?.getSnapshot?.().active ?? 'en')
        const dict = /^zh/i.test(active) ? DICT.zh : DICT.en
        let text = dict[key] ?? DICT.en[key] ?? key
        if (vars !== undefined) {
          for (const [name, value] of Object.entries(vars)) text = text.split(`{${name}}`).join(String(value))
        }
        return text
      }

      ctx.effect(() => {
        const disposers = []
        for (const [locale, dict] of Object.entries(DICT)) {
          try {
            disposers.push(ctx.locale.register(NS, locale, dict))
          } catch {}
        }
        return () => {
          for (const dispose of disposers) {
            try {
              dispose()
            } catch {}
          }
        }
      }, 'multimodal-model-router: locale')

      /** Re-render on locale switches without touching the fetched state. */
      function useLocaleRevision() {
        const [, bump] = React.useState(0)
        React.useEffect(() => ctx.locale.subscribe(() => bump((value) => value + 1)), [])
      }

      /**
       * Shared selection state. With a `sessionId` the state is resolved for
       * that session (override or global default); without one it is the global
       * default the bundle page manages.
       */
      function useRouter(sessionId) {
        const [phase, setPhase] = React.useState('loading')
        const [data, setData] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [failure, setFailure] = React.useState(null)
        const alive = React.useRef(true)
        const scopeRef = React.useRef(sessionId ?? null)
        scopeRef.current = sessionId ?? null

        React.useEffect(() => {
          alive.current = true
          return () => {
            alive.current = false
          }
        }, [])

        const stateUrl = React.useCallback(() => {
          const id = scopeRef.current
          return id === null ? `${PREFIX}/state` : `${PREFIX}/state?sessionId=${encodeURIComponent(id)}`
        }, [])

        const merge = React.useCallback((value) => {
          if (value === null || value === undefined) return
          setData((current) => (current === null ? { ...value } : { ...current, ...value }))
        }, [])

        const refresh = React.useCallback(async () => {
          try {
            const response = await fetch(stateUrl(), {
              credentials: 'same-origin',
              cache: 'no-store',
              headers: { accept: 'application/json' },
            })
            const body = await response.json().catch(() => null)
            if (!response.ok || !body || body.ok !== true) {
              throw new Error(body?.error ?? `HTTP ${response.status}`)
            }
            if (!alive.current) return
            merge(body.value)
            setPhase('ready')
            setFailure(null)
          } catch (error) {
            if (!alive.current) return
            setFailure(String(error?.message ?? error))
            setPhase((current) => (current === 'ready' ? current : 'error'))
          }
        }, [stateUrl, merge])

        React.useEffect(() => {
          refresh()
          const onFocus = () => refresh()
          window.addEventListener('focus', onFocus)
          return () => window.removeEventListener('focus', onFocus)
        }, [refresh])

        const effective = data?.effective ?? null
        const models = Array.isArray(data?.models) ? data.models : []
        const value = effective === null ? '' : keyOf(effective)
        const selectedEntry = effective === null ? undefined : models.find((entry) => keyOf(entry) === value)
        const sessionActive = data?.sessionActive === true

        const post = React.useCallback(async (payload) => {
          const response = await fetch(`${PREFIX}/select`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(payload),
          })
          const body = await response.json().catch(() => null)
          if (!response.ok || !body || body.ok !== true) {
            throw new Error(body?.error ?? `HTTP ${response.status}`)
          }
          return body.value
        }, [])

        const choose = React.useCallback(
          async (next, scope) => {
            const target = scope ?? (sessionActive ? 'session' : 'global')
            const id = scopeRef.current
            setBusy(true)
            setFailure(null)
            try {
              const payload = {
                scope: target === 'session' ? 'session' : 'global',
                provider: next?.provider ?? null,
                model: next?.model ?? null,
              }
              if (payload.scope === 'session') {
                if (id === null) throw new Error(translate('unavailable'))
                payload.sessionId = id
              }
              const value = await post(payload)
              if (!alive.current) return
              merge(value)
            } catch (error) {
              if (!alive.current) return
              setFailure(String(error?.message ?? error))
            } finally {
              if (alive.current) setBusy(false)
            }
          },
          [post, merge, sessionActive],
        )

        const toggleScope = React.useCallback(async () => {
          const id = scopeRef.current
          if (id === null) return
          setBusy(true)
          setFailure(null)
          try {
            const payload = sessionActive
              ? { scope: 'session', sessionId: id, clear: true }
              : {
                  scope: 'session',
                  sessionId: id,
                  provider: effective?.provider ?? null,
                  model: effective?.model ?? null,
                }
            const value = await post(payload)
            if (!alive.current) return
            merge(value)
          } catch (error) {
            if (!alive.current) return
            setFailure(String(error?.message ?? error))
          } finally {
            if (alive.current) setBusy(false)
          }
        }, [post, merge, sessionActive, effective])

        return {
          phase,
          models,
          selected: effective,
          globalSelected: data?.selected ?? null,
          sessionActive,
          canScope: sessionId !== undefined && sessionId !== null,
          selectedEntry,
          value,
          busy,
          failure,
          choose,
          toggleScope,
          selectedLacksVision: selectedEntry !== undefined && selectedEntry.vision === false,
        }
      }

      /** Compact poll of the routing outcome; the catalog never travels here. */
      function useActivity(sessionId) {
        const [value, setValue] = React.useState(null)
        const alive = React.useRef(true)
        const scopeRef = React.useRef(sessionId ?? null)
        scopeRef.current = sessionId ?? null

        React.useEffect(() => {
          alive.current = true
          let timer = null
          const refresh = async () => {
            try {
              const id = scopeRef.current
              const url = id === null ? `${PREFIX}/activity` : `${PREFIX}/activity?sessionId=${encodeURIComponent(id)}`
              const response = await fetch(url, {
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { accept: 'application/json' },
              })
              const body = await response.json().catch(() => null)
              if (!alive.current || !response.ok || !body || body.ok !== true) return
              setValue(body.value ?? null)
            } catch {}
          }
          refresh()
          timer = window.setInterval(() => {
            if (document.visibilityState === 'hidden') return
            refresh()
          }, 5000)
          const onFocus = () => refresh()
          window.addEventListener('focus', onFocus)
          return () => {
            alive.current = false
            if (timer !== null) window.clearInterval(timer)
            window.removeEventListener('focus', onFocus)
          }
        }, [])

        return value
      }

      function modelOptions(router) {
        const options = [h('option', { key: '__off', value: '' }, translate('off'))]
        const { phase, models, selected, value } = router

        if (phase === 'loading') {
          options.push(h('option', { key: '__loading', value: '', disabled: true }, translate('loading')))
          return options
        }
        if (phase === 'error' && models.length === 0) {
          options.push(h('option', { key: '__unavailable', value: '', disabled: true }, translate('unavailable')))
          return options
        }
        if (models.length === 0) {
          options.push(h('option', { key: '__none', value: '', disabled: true }, translate('none')))
          return options
        }

        if (selected !== null && !models.some((entry) => keyOf(entry) === value)) {
          options.push(h('option', { key: '__stale', value }, `${selected.provider} / ${selected.model}`))
        }

        const groups = new Map()
        for (const entry of models) {
          if (!groups.has(entry.provider)) {
            groups.set(entry.provider, {
              id: entry.provider,
              name: entry.providerName ?? entry.provider,
              vision: [],
              other: [],
            })
          }
          const group = groups.get(entry.provider)
          if (entry.vision === true) group.vision.push(entry)
          else group.other.push(entry)
        }

        const byName = (left, right) => String(left.name).localeCompare(String(right.name))
        const anyVision = [...groups.values()].some((group) => group.vision.length > 0)

        for (const group of groups.values()) {
          if (group.vision.length > 0) {
            const label = anyVision ? `${group.name} · ${translate('visionGroup')}` : group.name
            options.push(
              h(
                'optgroup',
                { key: `${group.id}:vision`, label },
                group.vision.sort(byName).map((entry) =>
                  h('option', { key: keyOf(entry), value: keyOf(entry) }, entry.name),
                ),
              ),
            )
          }
          if (group.other.length > 0) {
            const label = anyVision ? `${group.name} · ${translate('otherGroup')}` : group.name
            options.push(
              h(
                'optgroup',
                { key: `${group.id}:other`, label },
                group.other.sort(byName).map((entry) =>
                  h('option', { key: keyOf(entry), value: keyOf(entry) }, entry.name),
                ),
              ),
            )
          }
        }
        return options
      }

      function ComposerControl(props) {
        const sessionId = typeof props?.sessionId === 'string' ? props.sessionId : undefined
        const router = useRouter(sessionId)
        useLocaleRevision()

        const title =
          router.failure !== null
            ? `${translate('failure')}: ${router.failure}`
            : router.selectedLacksVision
              ? `${translate('title')} — ${translate('warnNotVision')}`
              : `${translate('title')} — ${translate('hint')}`

        const scopeTitle = router.sessionActive ? translate('scopeToGlobal') : translate('scopeToSession')

        return h(
          'span',
          {
            className: 'mmr-root',
            title,
            'data-warn': router.failure !== null || router.selectedLacksVision ? 'true' : 'false',
          },
          h('style', { key: 'style' }, CSS),
          eyeIcon('mmr-icon'),
          h(
            'select',
            {
              className: 'mmr-select',
              value: router.value,
              disabled: router.busy || router.phase === 'loading',
              'aria-label': translate('title'),
              'data-failed': router.failure === null ? 'false' : 'true',
              onChange: (event) => router.choose(decode(event.currentTarget.value)),
            },
            modelOptions(router),
          ),
          router.canScope
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'mmr-scope',
                  title: scopeTitle,
                  'aria-label': scopeTitle,
                  'aria-pressed': router.sessionActive ? 'true' : 'false',
                  'data-active': router.sessionActive ? 'true' : 'false',
                  disabled: router.busy || router.phase === 'loading',
                  onClick: () => router.toggleScope(),
                },
                router.sessionActive ? translate('scopeSession') : translate('scopeGlobal'),
              )
            : null,
        )
      }

      function BundleConfigPanel(props) {
        const router = useRouter()
        useLocaleRevision()
        const view = props?.view ?? 'page'
        const modelName =
          router.selectedEntry?.name ??
          (router.selected === null ? null : `${router.selected.provider} / ${router.selected.model}`)

        if (view === 'summary') {
          return h(
            'span',
            { className: 'mmr-summary' },
            modelName === null
              ? translate('summaryOff')
              : translate('summaryOn', { model: modelName }),
          )
        }

        let note = h('div', { className: 'mmr-note' }, translate('appliesAll'))
        if (router.failure !== null) {
          note = h(
            'div',
            { className: 'mmr-note', 'data-tone': 'error' },
            `${translate('failure')}: ${router.failure}`,
          )
        } else if (router.selectedLacksVision) {
          note = h('div', { className: 'mmr-note', 'data-tone': 'warn' }, translate('warnNotVision'))
        }

        return h(
          'div',
          { className: 'mmr-panel' },
          h('style', { key: 'style' }, CSS),
          h(
            'div',
            { className: 'mmr-panel-head' },
            eyeIcon('mmr-icon'),
            h(
              'div',
              null,
              h('div', { className: 'mmr-panel-title' }, translate('title')),
              h('div', { className: 'mmr-panel-desc' }, translate('panelHint')),
            ),
          ),
          h(
            'label',
            { className: 'mmr-field' },
            h('span', { className: 'mmr-field-label' }, translate('panelField')),
            h(
              'select',
              {
                className: 'mmr-panel-select',
                value: router.value,
                disabled: router.busy || router.phase === 'loading',
                onChange: (event) => router.choose(decode(event.currentTarget.value), 'global'),
              },
              modelOptions(router),
            ),
          ),
          note,
        )
      }

      function RouterDock(props) {
        const sessionId = props?.sessionId === undefined ? null : String(props.sessionId)
        const state = useActivity(sessionId ?? undefined)
        useLocaleRevision()
        const selected = state?.selected ?? null
        if (selected === null) return null

        const modelLabel = state?.name ?? selected.model
        const activity = state?.activity
        const fresh =
          activity !== null &&
          activity !== undefined &&
          typeof activity.at === 'number' &&
          Date.now() - activity.at < ACTIVITY_TTL_MS &&
          (activity.sessionId === null || sessionId === null || activity.sessionId === sessionId)

        if (fresh && activity.kind === 'fallback') {
          return h(
            'div',
            { className: 'mmr-dock', 'data-tone': 'warn' },
            h('style', { key: 'style' }, CSS),
            eyeIcon('mmr-icon'),
            h('span', { className: 'mmr-dock-tail' }, translate('dockFallback')),
          )
        }

        return h(
          'div',
          { className: 'mmr-dock', 'data-tone': 'info' },
          h('style', { key: 'style' }, CSS),
          eyeIcon('mmr-icon'),
          h(
            'span',
            null,
            translate('dockTo', { model: modelLabel }),
            fresh && activity.kind === 'routed'
              ? h('span', { className: 'mmr-dock-tail' }, ` · ${translate('dockRouted')}`)
              : null,
          ),
        )
      }

      ctx.slots.inject(COMPOSER_SLOT, () =>
        ctx.slots.register({ name: COMPOSER_SLOT, id: SLOT_ID, order: 0 }, ComposerControl),
      )

      ctx.slots.inject(BUNDLE_SLOT, () =>
        ctx.slots.register({ name: BUNDLE_SLOT, key: BUNDLE_NAME }, BundleConfigPanel),
      )

      ctx.slots.inject(DOCK_SLOT, () =>
        ctx.slots.register({ name: DOCK_SLOT, id: SLOT_ID, order: 10 }, RouterDock),
      )
    }

    return { inject, apply }
  },
})
