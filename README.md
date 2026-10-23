# 多模态模型路由（multimodal-model-router）

> 仓库：<https://github.com/DylanMing/multimodal-model-router>

在主模型之外再选一个**多模态模型**。请求里出现图片或文件内容时，这一步改用多模态模型；其余请求继续用主模型。

## 使用

1. 打开任意会话，在输入框工具栏（发送按钮左侧、主模型选择器旁边）会出现一个带眼睛图标的模型下拉框。
2. 选择支持图片的模型（下拉框按供应商分组，支持图片的模型排在前面）。
3. 选 `关闭（使用主模型）` 即恢复为全部请求走主模型。

同样的选择器也在插件自己的页面里：侧边栏 **插件 → 已安装 → 多模态模型路由**，详情页描述下方就是配置块（一个下拉框 + 说明/警告）。两处读写同一个设置，改一处另一处刷新即同步（切回窗口时会自动刷新）。

设置在启动时读取 `$DSH_HOME/multimodal-model-router.json`（未设置 `$DSH_HOME` 时落在 `~/.dsh/`），对所有会话生效，重启后保留。

### 模型必须声明支持图片输入

模型是否“支持图片”由 provider 配置里该模型的 `input` 决定。pi-ai 系列的 provider 默认当作纯文本，即使上游模型本身能看图，适配器也会把图片替换成占位文字（模型只会说“图片被省略”）。要让多模态模型真正收得到图片，在 profile 的 provider 配置里给它声明：

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

没有声明时，下拉框里选中该模型后眼睛图标会变成警示色，悬停提示会说明原因。

## 行为

- 检测到 **图片** 内容块（已被 offload 的图片按文本占位符处理，不再触发）或 **文件** 内容块时，这一步的请求配置切换为该多模态模型。
- 用户新消息里的图片在首个请求发出前尚未写入会话日志，因此插件在 `agent/pre-step` 记录该批消息是否含多媒体内容；已提交的内容（工具读图等）由 `session.deriveMessages()` 检测。
- 切换只替换 provider / model，丢弃主模型显式设置的 reasoning effort、maxTokens 等，让新路由自行解析默认值。
- 主模型本身也是该多模态模型时不做切换。
- **`read_image` 救援**：`read_image` 只在当前路由声明了图片输入时才执行，否则会直接拒绝（以免纯文本路由的历史里出现图片块）。选中多模态模型后，插件在 `tools/execute` 里接管这次拒绝：用自己的 `ctx.fs` + `ctx.attachments` 读到同一张图，按该工具自己的输出 schema 交回真实结果，于是图片进入历史，下一步请求自然路由到多模态模型。没有选中模型时保持原生拒绝行为。

## 组成

- `index.js`：Host 半。`agent/pre-step` + `agent/request` 路由、`tools/execute` 读图救援；`/api/multimodal-model-router/{state,select}` 供浏览器读写选择；模型目录来自 `ctx.llm`。
- `client.js`：Web 半。在 `conversation.input.right`（输入框工具栏）和 `plugins.bundle.config`（插件详情页，键为本包名）各注册一个选择器，共用同一套读写逻辑。
- `cordis.patch.yml`：插入 `multimodal-model-router` 行。

## 限制

- 选择是全局偏好，不是按会话保存的。
- 浏览器桥接走同源 HTTP（与项目内其他手写 UI 插件一致），无独立鉴权；服务端默认只监听回环地址。
- 图片能力的判定来自 provider 配置；未声明 `image` 的模型即使上游支持也不会收到图片。
- 只有在“已选中多模态模型”时才会救援 `read_image`；关闭后行为与原生一致。
