# dsh-multimodal-model-router

> 给 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（DSH）加一条多模态分流：主模型继续负责日常对话，遇到图片或文件内容时自动切到你在输入框旁边选定的多模态模型。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![version](https://img.shields.io/github/package-json/v/DylanMing/multimodal-model-router?label=version)](package.json)
[![platform](https://img.shields.io/badge/platform-DSH%20Web-2ea44f)](#兼容性)
[![last commit](https://img.shields.io/github/last-commit/DylanMing/multimodal-model-router)](https://github.com/DylanMing/multimodal-model-router/commits/main)

中文 | [English](README.en.md)

> **非官方项目。** 这是社区插件，不是 DeepSeek 官方组件，与 DeepSeek 无隶属关系；DSH 的版本演进可能改变本插件依赖的扩展点。

## 目录

- [为什么需要它](#为什么需要它)
- [特性](#特性)
- [安装](#安装)
- [使用](#使用)
- [前置条件：模型必须声明图片输入](#前置条件模型必须声明图片输入)
- [工作原理](#工作原理)
- [提示与失败回退](#提示与失败回退)
- [配置与持久化](#配置与持久化)
- [兼容性](#兼容性)
- [已知限制](#已知限制)
- [开发](#开发)
- [安全](#安全)
- [贡献](#贡献)
- [许可证](#许可证)

## 为什么需要它

DSH 里“看图”有两个硬约束：

1. 图片块只会发给**声明了图片输入**的路由；
2. `read_image` 工具在当前路由没有声明图片输入时会直接拒绝执行（避免纯文本路由的会话历史里出现图片块）。

于是纯文本主模型（比如 DeepSeek V4）遇到“帮我看看这张图”就卡住了——要么整场会话换成视觉模型，要么手动切来切去。这个插件把两件事拆开：**日常请求照旧走主模型，带图片/文件的请求自动转给多模态模型**，并且替你完成 `read_image` 的那一步。

## 特性

- **输入框旁一键选择**：模型下拉框出现在发送按钮左侧，按供应商分组，声明支持图片的模型排在前面。
- **插件页面可视化配置**：侧边栏 **插件 → 已安装 → 多模态模型路由**，详情页里有同一个选择器，不用改配置文件。
- **按内容自动路由**：请求里出现未 offload 的图片块或文件块时，这一步的 `provider/model` 换成多模态模型；其余请求不动。
- **看得见的切换**：输入框下方常驻一行「图片/文件 → 模型名」，真正切换过会在后面标「刚刚已切换」，不会让人以为回答风格突变。
- **失败自动回退**：多模态路由报错（配额、鉴权、模型下线）时自动改回主模型重试该步，并在提示行里标出「视觉路由失败，已回退主模型」。
- **`read_image` 救援**：主模型路由被拒绝读图时，插件自己读图并按 `read_image` 的输出契约交回结果，图片进入历史，下一步请求自然落到多模态模型。
- **全局记忆**：选择对所有会话生效，写入 `$DSH_HOME/multimodal-model-router.json`，重启后保留。
- **中英文案**：跟随界面语言，`locale/{zh,en}.json` 提供插件元数据。
- **无遥测、不联网**：只调用 DSH 提供的服务与自身回环桥接。

## 安装

### 从 GitHub 安装

在 DSH Web UI 侧边栏打开 **插件**，点安装，填：

```
git+https://github.com/DylanMing/multimodal-model-router.git
```

装好后「已安装」里会出现 **多模态模型路由**，默认启用。安装过程由 DSH 的插件管理器完成（`pnpm add` + 校验 bundle 补丁），Host 半即时生效，浏览器端刷新一次页面即可看到控件。

> 没有 `dsh` CLI 的桌面发行版也可以装：插件页面和 Agent 的 `plugin_manager` 工具走的是同一个 `installBundle`，都接受上面这个 spec。

### 从本地目录安装（开发用）

把仓库克隆到任意目录，然后用插件页面的安装入口填**绝对路径**（或 Agent 的 `plugin_manager` 安装），例如：

```
C:\dev\multimodal-model-router
```

本地链接方式安装后，改动 `index.js` 需要让插件重新 apply（插件页把本插件关掉再打开，或重启应用）；改动 `client.js` 需要刷新浏览器页面。

## 使用

**方式一：会话输入框（日常最快）**

发送按钮左侧、主模型选择器旁边有一个眼睛图标的下拉框：

1. 选一个支持图片的模型；
2. 之后凡是带图片或文件的请求都会走它，普通对话仍走主模型；
3. 选 `关闭（使用主模型）` 即恢复全走主模型。

**作用域**：下拉框右边的按钮显示当前写入的目标。

- **全局**（默认）：改动写入默认设置，所有会话一起变。
- **本会话**：改动只影响当前会话，全局默认不变。

点这个按钮即可切换：从 `全局` 切到 `本会话` 时，它会把当前生效的模型复制成本会话的覆盖项（界面不会突变）；从 `本会话` 切回 `全局` 时，覆盖被清除，重新跟随全局默认。覆盖只存在于当前进程，应用重启或会话重开就回到全局设置。

**方式二：插件页面**

侧边栏 **插件 → 已安装 → 多模态模型路由**，详情页描述下方是配置块：说明、模型下拉框、状态提示。这里改的是**全局默认**；两处读写同一份数据，改一处另一处刷新即同步（切回窗口时自动刷新）。

当选中的模型没有声明图片输入时，眼睛图标会变成警示色，悬停提示会告诉你原因。

## 前置条件：模型必须声明图片输入

模型“能不能看图”由 provider 配置里该模型的 `input` 决定，而不是它上游的真实能力。pi-ai 系列 provider 默认按纯文本处理——未声明时适配器会把图片替换成占位文字（模型只会回答“图片被省略”）。给你的视觉模型补一行即可：

```yaml
- id: llm-pi-ai
  config:
    providers:
      volce:
        models:
          - id: doubao-seed-2.1-pro
            name: Doubao Seed 2.1 Pro
            input: [text, image]   # 关键：声明接受图片输入
```

改完保存，DSH 会热加载 provider 配置，插件下拉框里该模型会移动到“支持图片”分组。

## 工作原理

```text
用户消息 ──► agent/pre-step ──► agent/request ──► 模型调用
              │                  │
              │                  └─ 命中图片/文件 → 返回 { provider, model } = 多模态模型
              └─ 记录本批消息是否含图片/文件（此时消息还没提交进会话日志）

模型调用 read_image ──► tools/execute ──► 原生拒绝（主模型不支持图片）
                                     └─ 插件接管：ctx.fs 读文件 + ctx.attachments 存图
                                        → 按 read_image 自己的输出 schema 返回真实结果
                                        → 下一步请求的历史里有图片块 → 自动路由到多模态模型
```

几个关键设计：

- **为什么在 `agent/pre-step` 记录**：用户新消息里的图片在首个请求发出前还没写入会话日志，`session.deriveMessages()` 看不到它们；已提交的内容（工具读图、历史图片）仍然由 `deriveMessages()` 检测。
- **为什么只替换 provider/model**：主模型显式设置的 reasoning effort、maxTokens 等对新路由未必成立，切换时丢弃，让新路由解析自己的默认值。
- **为什么救援必须由插件做**：`read_image` 的拒绝发生在工具执行时，此时本步已经在主模型上跑完，只有工具结果能改变下一步的历史。
- **已 offload 的图片**：`dsh-compaction-image-offload` 会把超预算的图片换成文本占位符，这类块不再触发切换。

## 提示与失败回退

**提示**：选中多模态模型后，输入框卡片下方常驻一行说明，例如「图片/文件 → Doubao Seed 2.1 Pro」。

- 该步真的改用了多模态模型时，行尾追加「刚刚已切换」（保留约两分钟）。
- 回退时整行变成警示色：「视觉路由失败，已回退主模型」。
- 只影响当前会话的提示：宿主只把最近一次路由结果广播给对应会话，别的会话不受打扰。

**回退**：多模态路由在这一步失败时（上游 5xx、401、模型不存在、网络中断等），插件会在 `agent/request-error` 里把本回合标记为「已回退」并返回 `{ kind: 'retry' }`。DSH 每次重试都会重新走 `agent/request`，因此下一次尝试解析到主模型，本步得以继续；同一回合的后续步骤不再尝试多模态模型，下一个回合重新给多模态模型一次机会。失败本身仍会记入会话日志（一次 `assistant/attempt`），并在提示行里体现。

> 只有 `finish.kind === 'error'` 这类「模型调用失败」会走这条路径；如果路由在 `prepareCall` 阶段就抛错（例如 `NO_ADAPTER`），DSH 会直接结束这一回合，插件无法拦截。

## 配置与持久化

- **全局默认**存于 `$DSH_HOME/multimodal-model-router.json`；未设置 `DSH_HOME` 时落在 `~/.dsh/multimodal-model-router.json`。
- 文件内容：`{ "version": 1, "provider": "...", "model": "...", "updatedAt": "..." }`，`provider`/`model` 为 `null` 表示关闭。
- **本会话覆盖**只存在 Host 进程内存里，按会话 id 索引，`agent/disposed` 时清除；不写文件，重启即失效。这一层回答的是「这个对话现在想怎样」，不值得跨重启记着。
- 插件没有 Config schema（插件页里是自定义面板，不是通用表单），因此不需要改 profile 的 `cordis.patch.yml` 来配置它。

解析顺序：**本会话覆盖 → 全局默认 → 关闭**。没有覆盖的会话动态跟随全局默认，所以改全局会立刻影响它们。

## 兼容性

- 在 **DSH 0.2.1-rc.2**（桌面版，Web UI）上验证。
- 依赖的扩展点：`agent/pre-step`、`agent/request`、`agent/disposed`、`tools/execute`、`ctx.llm`、`ctx.fs`、`ctx.attachments`、`ctx.workingDirectory`、`ctx.sessions`，以及 Web 槽位 `conversation.input.right`、`plugins.bundle.config`。
- 仅支持 Web 形态的 DSH（`dsh.client.platform = web`）；CLI/TUI 没有输入框控件，但 Host 半的路由本身与界面无关。

## 已知限制

- 本会话覆盖是**进程内**的：重启应用、或在别处重开同一会话，覆盖都会丢失并回落到全局默认。
- 覆盖不随会话导出/分叉：分叉出的新会话没有覆盖。
- 图片能力完全取自 provider 配置，插件不探测、不伪造。
- 浏览器与 Host 之间的桥接是同源 HTTP（`/api/multimodal-model-router/*`），没有独立鉴权，依赖 Host 只监听回环地址。
- 只救援 `read_image`；其它会产生图片块的扩展需要各自适配。

## 开发

```text
.
├── index.js           # Host 半：路由、救援、回退、状态持久化、/api 桥接
├── client.js          # Web 半：输入框控件 + 提示行 + 插件页配置面板
├── cordis.patch.yml   # bundle 补丁：插入 multimodal-model-router 行
├── locale/            # 插件显示元数据（zh / en）
├── test/              # Host 半路由与回退的单元测试
├── icon.svg           # 插件图标
└── package.json       # dsh.bundle / dsh.client 声明
```

本地检查与测试：

```bash
node --check index.js
node --check client.js
node --test test/
```

测试用假的 Host 上下文直接驱动 `agent/pre-step`、`agent/request`、`agent/request-error` 三个监听器，覆盖「纯文本不切换」「图片/文件触发切换」「失败后本回合回退、下一回合重试」和「其它路由或已取消的失败不干预」。CI 跑同一套命令。

调试要点：

- 桥接接口 `GET /api/multimodal-model-router/state[?sessionId=…]` 可以看到全局默认、当前会话覆盖与模型目录；`GET /api/multimodal-model-router/activity` 只返回选择与最近一次路由结果（提示行轮询它）。两者都无需登录，仅回环。
- 想确认某次请求真的换了模型，看会话日志里的 `request/header` 事件：`reason=change` 且 `config.model` 是多模态模型即命中；工具结果则是 `blocks=['text','image']`。

## 安全

- 插件不上传任何数据，不读凭据，不发起外部网络请求。
- 图片经 `ctx.attachments` 持久化在本地，路径由 DSH 的附件存储决定。
- 桥接接口只返回模型目录和当前选择，写入接口只接受已存在于目录中的 `provider/model` 组合。

## 贡献

欢迎 issue 和 PR。提交前请确保两个入口都能跑通（`node --check`、插件页关闭再开启后控件仍可用），并在 PR 描述里说明验证方式。

## 许可证

[MIT](LICENSE) © 2026 DylanMing
