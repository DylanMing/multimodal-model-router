# dsh-multimodal-model-router

> A multimodal split for [DeepSeek Harness](https://github.com/deepseek-ai/dsh) (DSH): keep the primary model for everyday work, and automatically hand image- and file-bearing requests to the multimodal model you pick next to the composer.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![version](https://img.shields.io/github/package-json/v/DylanMing/multimodal-model-router?label=version)](package.json)
[![platform](https://img.shields.io/badge/platform-DSH%20Web-2ea44f)](#compatibility)

[中文](README.md) | English

> **Unofficial.** This is a community plugin, not a DeepSeek component, and is not affiliated with DeepSeek. Harness releases may change the extension points it relies on.

## Why

DSH only sends image blocks to a route that **declares image input**, and `read_image` refuses to execute on a route that does not — by design, so a text route's durable history never holds images. With a text-only primary model, "take a look at this screenshot" therefore deadlocks unless you switch the whole session to a vision model. This plugin splits the two concerns: ordinary requests stay on the primary model, image/file requests switch to a multimodal model, and the plugin performs the `read_image` step that the text route cannot.

## Features

- **One control beside the composer** — a provider-grouped model picker with image-capable models first, and a clear "off" entry.
- **Configurable on the plugin page** — sidebar **Plugins → Installed → Multimodal Model Router** renders the same picker, no config files involved.
- **Content-driven routing** — a step whose request carries a non-offloaded image block or a file block is rerouted; everything else stays put.
- **Visible routing** — a line under the composer names the target model, marked "just switched" for a couple of minutes after a real switch.
- **Automatic fallback** — if the multimodal route fails (quota, auth, retired model), the step retries on the primary model and the hint line says so.
- **`read_image` rescue** — when the primary route is refused, the plugin reads the image itself and returns a result that satisfies the tool's own output contract, so the image enters history and the next request lands on the multimodal model.
- **Profile-wide and persistent** — stored in `$DSH_HOME/multimodal-model-router.json`, survives restarts.
- **Localized** — zh/en UI copy and plugin metadata.
- **No telemetry, no outbound network calls.**

## Install

In the DSH Web UI, open **Plugins** in the sidebar, choose install, and enter:

```
git+https://github.com/DylanMing/multimodal-model-router.git
```

The bundle appears under **Installed** and is enabled. The Host half applies immediately; refresh the browser once to load the updated browser half.

For local development, install the package directory by absolute path instead (`plugin_manager` and the Plugins page share the same `installBundle` path). Editing `index.js` requires the plugin to apply again (toggle it off/on, or restart); editing `client.js` requires a page refresh.

## Usage

- **Composer**: pick a model in the eye-icon dropdown left of the send button. Requests with images or files use it; everything else uses the primary model. Choose `Off (primary model)` to disable.
- **Plugin page**: the same picker lives on this bundle's own page, with a status note. It always writes the global default.

**Scope.** The button beside the dropdown shows where the next change lands:

- `All` — writes the global default, shared by every session.
- `This session` — writes an override for the current session only.

Clicking the button switches scope: going from `All` to `This session` copies the currently effective model into a session override (nothing visible changes), and going back clears the override so the session follows the global default again. Overrides live in the Host process and disappear on restart.

A selected model that does not declare image input turns the eye icon into a warning color, and the tooltip explains why.

## Prerequisite: declare image input

Whether a model can see images comes from the provider configuration, not from the upstream model. pi-ai providers default to text, and the adapter replaces image blocks with placeholder text unless `input` includes `image`:

```yaml
- id: llm-pi-ai
  config:
    providers:
      volce:
        models:
          - id: doubao-seed-2.1-pro
            name: Doubao Seed 2.1 Pro
            input: [text, image]
```

## How it works

```text
user batch ─► agent/pre-step ─► agent/request ─► model call
                 │                │
                 │                └─ image/file present → { provider, model } = multimodal
                 └─ remember whether this batch carries visuals (the batch is not in history yet)

model calls read_image ─► tools/execute ─► native refusal (primary route has no image input)
                                       └─ plugin: ctx.fs read + ctx.attachments save
                                          → returns a valid read_image value
                                          → next request contains an image block → routed to the multimodal model
```

Design notes:

- `agent/pre-step` is the only hook that sees user images before they are committed; committed content is detected through `session.deriveMessages()`.
- Only `provider`/`model` are replaced; explicit reasoning effort, maxTokens, and similar controls are dropped so the new route resolves its own defaults.
- Images already offloaded by `dsh-compaction-image-offload` no longer trigger a switch.

## Feedback and fallback

Once a multimodal model is selected, a line under the composer reads `Images/files → <model>`. After a step actually reroutes, it appends `just switched` for about two minutes; if the route failed and the step fell back, the line turns into a warning instead.

The fallback uses `agent/request-error`: when the multimodal route fails, the plugin marks the turn, returns `{ kind: 'retry' }`, and the retry re-enters `agent/request`, which now resolves the primary model. The rest of that turn stays on the primary model; the next turn tries the multimodal route again. Only `finish.kind === 'error'` failures take this path — a `prepareCall` failure such as `NO_ADAPTER` ends the turn before the plugin can intervene.

## Storage and configuration

- **Global default**: `$DSH_HOME/multimodal-model-router.json` (falls back to `~/.dsh/`).
- Shape: `{ "version": 1, "provider": string|null, "model": string|null, "updatedAt": string }`, where `null` means off.
- **Session overrides** stay in Host memory, keyed by session id and dropped on `agent/disposed`; they are not written to disk.
- Resolution order: session override → global default → off. Sessions without an override follow the global default as it changes.
- The bundle declares no Config schema; the plugin page renders a custom panel, so nothing in `cordis.patch.yml` needs editing.

## Compatibility

- Verified on **DSH 0.2.1-rc.2** (desktop, Web UI).
- Extension points used: `agent/pre-step`, `agent/request`, `agent/disposed`, `tools/execute`, `ctx.llm`, `ctx.fs`, `ctx.attachments`, `ctx.workingDirectory`, `ctx.sessions`, plus the `conversation.input.right` and `plugins.bundle.config` slots.
- Web only (`dsh.client.platform = web`); the Host routing itself is interface-independent.

## Limits

- Session overrides are process-local: a restart, or reopening the session elsewhere, falls back to the global default.
- A fork does not inherit an override.
- Image capability is read from provider configuration and never faked.
- The browser bridge is same-origin HTTP (`/api/multimodal-model-router/*`) with no separate auth; it relies on the Host listening on loopback only.
- Only `read_image` is rescued.

## Development

```text
index.js           Host half: routing, rescue, fallback, persistence, /api bridge
client.js          Web half: composer control, hint line, bundle settings panel
cordis.patch.yml   bundle patch inserting the plugin row
locale/            display metadata (zh, en)
test/              unit tests for the Host routing and fallback decisions
icon.svg           bundle icon
package.json       dsh.bundle / dsh.client declarations
```

```bash
node --check index.js
node --check client.js
node --test test/
```

`GET /api/multimodal-model-router/state` shows the current selection and model catalog. In a session log, a routed step appears as a `request/header` event with `reason=change`, and a rescued read as a tool result with `blocks=['text','image']`.

## Security

- No telemetry, no credentials, no outbound requests.
- Images are stored by DSH's attachment service.
- The bridge only returns the catalog and the selection; the write route accepts only combinations already present in the catalog.

## License

[MIT](LICENSE) © 2026 DylanMing
