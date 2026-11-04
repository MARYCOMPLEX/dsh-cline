# dsh-cline — Cline Pass 上游控制台（DeepSeek Harness 插件）

一个 DeepSeek Harness 插件：枚举 Cline Pass 订阅模型背后的每一条上游渠道，钉住一个或按优先级回退，实测渠道可用性，并回读每次请求**实际命中**的渠道。

功能与实现思路来自 [cline-pass-switcher](https://github.com/munmunjaklin458-afk/cline-pass-switcher)，但以 Harness 原生插件形态重写：**不另起端口、不改 baseURL、不改 provider**，装在现有 profile 里即可用。

```text
┌ Cline 上游 ──────────────────────────────────────────────────────────────┐
│ 枚举订阅模型背后的渠道，钉住一个或按优先级回退…          [●启用] [刷新]  │
│ 网关: https://api.cline.bot/api/v1                                       │
│  1 模型    16 渠道    1 已钉    21 请求                                  │
│                                                                          │
│ 模型 [cline-pass/deepseek-v4.1-flash-1017 ▾]  planner·Vercel  [探测渠道] │
│                                                                          │
│ 钉住顺序  (1 alibaba ↑↓×)         模式[自动|严格|优先+回退]  排序[最低成本]│
│  · 点「钉住」选择一个渠道；点「排除」让它永不被使用                       │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │ [✓ 1] alibaba        ● 可用    812 ms   ctx 128k        [排除]    │   │
│  │ [钉住] baseten       ● 限流    901 ms   ctx 128k        [排除]    │   │
│  │ [钉住] fireworks     ● 不可钉  —                        [排除]    │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│  最近实际 alibaba · 812 ms · 尝试: alibaba          [测试钉住]           │
│  ▸ 请求历史 (8)                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

界面完全使用 Harness 的 `--dsw-alias-*` 主题 token，深浅色、对比度、字体与设置页其他控件一致，不写死颜色。

---

## 它解决什么问题

Cline Pass 的订阅模型（`cline-pass/*`）在 Cline 网关之后分成两条管道：

| 管道 | 实际后端 | 响应特征 | 钉住字段 |
|---|---|---|---|
| **planner** | Vercel AI Gateway | `choices[0].message.provider_metadata.gateway.routing` | `providerOptions.gateway.only / order / sort / has / inferenceRegion` |
| **direct** | OpenRouter | 顶层 `provider`（显示名）+ 真实 `model` | 顶层 `provider.only / order / sort` |

顶层的 `provider.only` 对 planner 管道会被 Cline 丢弃，所以「换上游不生效」。本插件在 Harness 进程内拦截发往网关的 `chat/completions`，按模型所属管道注入正确的字段，再回读响应里的 `finalProvider`。

**2026-11 起网关又多了一条规矩**：planner 管道在不带 `inferenceRegion` 时会把模型解析到 contributor 私有通道（`private/deepseek-v4p1-flash-1017-contributor`），在那里 `only` / `order` / `has` 全部被忽略——看起来就像「钉住失效」。带上

```json
"providerOptions": {
  "gateway": {
    "only": ["deepseek"],
    "inferenceRegion": { "scope": "zone", "geoRegion": "us", "providers": { "deepseek": null } }
  }
}
```

之后，模型改走公开渠道池，`only` 才真正生效。插件现在会按钉住/过滤名单自动补上这一段（`providers` 就是本请求允许使用的渠道集合），面板里可以关掉，也可以改 `geoRegion`。

---

## 安装

### 在 DSH 界面里输入包名（npm 安装）

插件发布到 npm 后，别人不需要克隆仓库，也不需要记 Git 地址：

1. 打开 **设置 → 插件 → 安装第三方插件**；
2. 在输入框里填入 `dsh-cline`（或发布时用的 scope 名），点安装；
3. 重启 DeepSeek Harness。

命令行等价形式：

```powershell
dsh plugin --profile desktop add dsh-cline
```

> 安装源选「npm 官方源」最快；npmmirror 等镜像同步新包有延迟。
> 这一步的前提是包已经 `npm publish`（见文末「发布」）。

### 从 GitHub 安装

```powershell
dsh plugin --profile desktop add github:MARYCOMPLEX/dsh-cline
```

`dsh` 在 `F:\DeepSeek\resources\runtime\cli\bin\dsh.cmd`（桌面版自带）。装完**重启 DeepSeek Harness**，打开
**设置 → 模型**，页面底部会出现「Cline 上游」卡片。

也可以锁定版本或分支：

```powershell
dsh plugin --profile desktop add github:MARYCOMPLEX/dsh-cline#v1.7.0
```

更新到最新：

```powershell
dsh plugin --profile desktop update dsh-cline
```

卸载：

```powershell
dsh plugin --profile desktop remove dsh-cline
```

> 本地开发时也可以 `add C:\path\to\dsh-cline` 以目录链接方式安装。

### 发布到 npm（维护者）

```powershell
# npm 配置里若是 npmmirror，必须先切到官方源；镜像是只读的
npm login --registry=https://registry.npmjs.org/
npm publish --registry=https://registry.npmjs.org/
```

包内已配置 `files` 白名单，发布产物只包含 `index.js / core.js / client.js /
cordis.patch.yml / locale / icon.svg / README / LICENSE`，不含 `test` 与 `tools`。
若 `dsh-cline` 名称不可用，可改成 `@<scope>/dsh-cline` 发布，安装时输入完整 scope 名。

---

## 使用

1. **探测渠道**：发一条极小的真实请求判定管道，再发一条 `only: ["__probe__"]` 的假上游请求（**零 token**）拿到完整渠道清单；direct 管道还会补 OpenRouter 的 endpoint 明细（上下文长度、在线率）。
2. **校验全部**：把每个渠道各钉一次 `max_tokens: 16`，标出 ✔可用 / ⏳限流 / ✘不可钉 / 鉴权失败。
3. **钉住**：在渠道行点「钉住」。严格模式下再点另一个即改为只钉新的；优先模式下按点击顺序累积。
4. **模式**：
   - **自动**：不注入（若设置了排除，则只放行白名单）。
   - **严格钉住**：`only: [当前渠道]`，逐个尝试，失败即报错。
   - **优先 + 回退**：`order: [当前, 其余]`，第一个不可用时网关顺切。
5. **排序**：最低成本 / 最快首字 / 最高吞吐（direct 自动翻译成 `price / latency / throughput`）。
6. **排除**：被排除的渠道永不被使用，插件把「已知渠道 − 排除项」换算成 `only` 白名单（网关会静默忽略 `exclude` 字段）。
7. **能力过滤（has）**：先勾「has 能力过滤」总开关，下面才出现参数复选框（视觉 / 推理 / 工具调用 / 结构化输出 /
   隐式缓存 / 免费）；手写量化条件（`quantization:fp8`、`!quantization:bf16`）点「添加」后也变成一个可勾选项。
   改完会实时预览这条请求**将要携带**的路由字段（Host 用拦截器同一段代码算出，不会出现"预览与实发不一致"），
   点「保存」才写入，「取消」丢弃草稿。
   注入的是 `providerOptions.gateway.has`，与 `only` / `order` **取交集**：钉住 deepseek 再要求"免费"，
   网关直接返回 400 `None of the providers considered ... satisfy the required has conditions`，
   插件对这种错误**不重试下一个钉住项**（结果必然相同），直接把错误返回。
8. **推理区域（inferenceRegion）**：默认「固定 zone / `us`」。只要这次请求会注入任何路由字段（钉住、排除白名单、
   能力过滤、排序），就会同时注入 `inferenceRegion`，把模型解析到公开渠道池，`only` 才会被执行；
   `providers` 按本次允许的渠道自动生成（例如钉 deepseek 就是 `{"deepseek": null}`）。
   选「关闭」则回到旧行为：只发 `only`，网关可能仍把它路由到 contributor 私有通道。
   自动模式且没有其它路由字段时不注入任何东西，聊天请求保持原样。
9. **手动编辑参数**：预览框右上角点「手动编辑参数」，可以把任意字段写进
   `providerOptions.gateway`（direct 管道写进顶层 `provider`），保存后**深合并**到自动生成的字段之上，
   同名键以手写为准。以后网关再加新参数，直接在这里写，不用改插件、不用等发版。
   编辑期间上方预览实时跟随；JSON 写错会标红且不允许保存。
10. **测试钉住**：按当前配置真实跑一次，显示目标 vs 实际以及尝试序列。

聊天时插件自动记录：管道、实际渠道、规范模型、耗时、尝试序列（最近 50 条）。面板每 4 秒刷新一次，页面隐藏时暂停。

### 匹配范围（哪些请求会被改写）

一次请求只有同时满足下面三条才会被**改写**：

1. `POST` 且 JSON body 里有 `model`；
2. URL 的 origin 等于 `gatewayBase` 的 origin（默认 `https://api.cline.bot`）；
3. `model` 以 `modelPrefix` 开头（默认 `cline-pass/`）；
4. 路径命中 `injectPaths`（默认 `/chat/completions`、`/responses`、`/completions`）。

第 4 条是**注入**的范围，不是「观察」的范围：其他路径（比如 `anthropic-messages` 的 `/messages`、模型发现 `/models`）会原样透传，
但插件仍会尝试回读响应里的路由元数据，用于「最近实际渠道」。原因是 `provider` / `providerOptions.gateway` 是
OpenAI 兼容网关的字段，往未知协议里塞字段可能被网关判为 400。

`injectPaths` 可以按需扩大或收窄，例如只钉 Chat Completions：

```yaml
config:
  injectPaths:
    - /chat/completions
```

如果网关把推理端点放在别的前缀下（比如 `/api/v1/responses`），`endsWith` 匹配同样成立。

---

## 配置

`cordis.patch.yml` 里的行配置：

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关；关闭后请求完全透传 |
| `gatewayBase` | `https://api.cline.bot/api/v1` | 网关地址 |
| `injectPaths` | `['/chat/completions','/responses','/completions']` | 允许注入路由字段的路径后缀 |
| `apiKeyEnv` | `CLINE_API_KEY` | 探测/校验用的凭据引用；优先走 `ctx.credentials`，其次用拦截到的 `Authorization`（仅内存），最后读环境变量 |
| `modelPrefix` | `cline-pass/` | 只处理这个前缀的模型 |
| `llmProvider` | `cline` | 拉取模型清单用的 provider 路由名 |
| `attemptTimeoutMs` | `120000` | 单次尝试超时 |
| `probeTimeoutMs` | `180000` | 探测超时 |
| `maxHistory` | `50` | 每模型保留的请求历史条数 |
| `allowRemote` | `false` | 是否允许非回环地址调用插件路由 |
| `debug` | `false` | 打印拦截器日志 |

每模型的钉住配置和观测结果存在 `$DSH_HOME/storages/dsh-cline.json`。**不存密钥、不存消息正文。**

每模型配置（面板写入、也可直接改状态文件后刷新页面）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `pinMode` | `auto` | `auto` / `strict` / `preferred` |
| `upstreams` | `[]` | 钉住的渠道，按顺序尝试 |
| `exclude` | `[]` | 永不使用的渠道；换算成 `only` 白名单 |
| `has` | `[]` | 能力过滤，写在 `gateway.has` |
| `sort` | `null` | `cost` / `ttft` / `tps` |
| `region` | `{scope:'zone', geoRegion:'us'}` | `scope: 'zone' \| 'off'`；`off` 时退回旧行为（只发 only/order） |
| `extras` | `{}` | 手动参数，`{gateway?: {...}, provider?: {...}}`，深合并到最后、同名覆盖 |

---

## 网关请求日志

插件在同一个 fetch 包装器上顺带记录**所有**模型调用，不只 Cline：

- 命中 `POST` + JSON body 带 `model` + 推理路径（`/chat/completions`、`/responses`、`/completions`、`/messages`）的请求；
- 其他提供商（DeepSeek 官方、OpenAI、Anthropic…）**只记录、不改写**；
- Cline 请求额外写入 `target`（钉住目标）、`attempts`（逐次尝试）和 `upstream`（实际渠道）；
- 每条记录含：时间、提供商、模型、端点、HTTP 状态、耗时、是否流式、usage（prompt/completion/total/cached）、请求 ID、错误摘要；
- 内存环形缓冲 200 条，不落盘、不存正文和密钥。

界面位置：

- **设置 → 模型 → Cline 上游 → 网关请求日志**：可筛选「全部 / 仅 Cline / 仅失败」，支持清空；
- **输入框下方的状态条**：新增一个 `上游 <渠道>` 小胶囊，5 秒刷新。图标复用 Harness 内置的
  `IconBranchOutlineRegular`（与「轮次 / tok」「缓存命中」胶囊同一套 outline 图标、同样 14 px 与 6 px 间距），
  图标随状态着色：常规为三级文字色，黄色=实际与目标不同，红色=失败。点开设置页可看完整日志。

胶囊的取值规则（1.4.2 起）：

| 情况 | 显示 |
|---|---|
| 最近一次请求有 `upstream` | `上游 alibaba` |
| 最近一次请求走的是别的提供商 | `经 cpa.gojia.cloud`，不再冒用上一条 Cline 的渠道 |
| Cline 请求但响应没有路由字段（失败/空流） | `上游 未解析` |
| 当前对话还没有发过请求 | 不显示 |

**为什么切换对话会清空**：胶囊是 `conversation.composer.dock` 的 session 作用域插槽，切换会话时组件状态与 `sessionId` 一起重置；
只有「本对话切过来之后到达」的请求才会被采纳（Host 能识别 `x-session-affinity` 等会话头时会精确匹配，识别不到
时退回时间窗判断）。因此不会再把上一个对话的渠道显示到新对话里。

> 日志是观测层：即使不钉任何渠道、甚至换成别家 provider，也会出现在日志里；只有 Cline 的行会带「实际上游」。

---

## 面板 HTTP 接口

同源或本机来源、支持 CORS 预检、1 MB 请求体上限：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/dsh-cline/state` | 配置 + 渠道 + 最近实际 + 模型清单 + 日志条数 |
| GET | `/dsh-cline/status` | 最近一条请求（给输入框状态条用） |
| GET | `/dsh-cline/logs` | 请求日志，支持 `limit/provider/model/upstream/onlyCline/onlyErrors` |
| POST | `/dsh-cline/logs/clear` | 清空日志 |
| GET | `/dsh-cline/diag` | 拦截器状态、网关请求计数、状态文件路径 |
| GET | `/dsh-cline/history` | 最近 100 条 Cline 请求记录 |
| POST | `/dsh-cline/config` | `{model, upstreams, exclude, has, pinMode, sort, region, extras}` |
| POST | `/dsh-cline/probe` | `{model}` → 管道 + 渠道清单（按该模型的 region 设置枚举公开/私有池） |
| POST | `/dsh-cline/validate` | `{model}` → 全渠道可用性（带上 region，和实发一致） |
| POST | `/dsh-cline/test` | `{model}` → 目标 vs 实际 + 尝试序列 |
| POST | `/dsh-cline/preview` | `{model, has?, upstreams?, pinMode?, sort?, region?, extras?}` → 预览将注入的 `providerOptions` / `provider` |
| POST | `/dsh-cline/enabled` | `{enabled}` |

桌面版页面以 `file://` 加载，插件按 `globalThis.__DSH_TRANSPORT__.streamBaseUrl` 解析 Host 源；
Host 侧接受 `Origin: null`、`file://` 与回环来源，远程站点来源一律拒绝。

---

## 实现要点

```
pi-ai adapter → OpenAI SDK → globalThis.fetch
                                  │
                    dsh-cline 的包装器（只认 POST <gateway>/chat/completions）
                                  ├─ 读 per-model 配置 → injectPrefs()
                                  ├─ 失败 / 超时 / SSE 首包是错误 → 下一个渠道
                                  ├─ 200 SSE → 首包探测后重建流并原样透传
                                  └─ clone 一条流回读 finalProvider → 落盘
```

- 只改写 JSON 请求体里的 `provider` / `providerOptions`，其余字段（tools、reasoning、图片、`stream_options`）原样保留。
- 任何内部异常都会退回原始 `fetch`，不会让正常聊天失败。
- 插件卸载时恢复原来的 `globalThis.fetch`（确认仍是自己的包装器才恢复）。
- 探测请求带 `x-dsh-cline-internal: 1`，不会再次被拦截。

---
 
## 验证

```powershell
node --test --experimental-test-isolation=none dsh-cline/test   # 58 个纯函数 / 拦截器单测
node dsh-cline/tools/live-probe.mjs      # 实网：判管道、枚举、钉住、流式、direct 管道
node dsh-cline/tools/live-interceptor.mjs [model] [a,b]  # 实网：走真实拦截链路
node dsh-cline/tools/live-verify-region.mjs  # 实网：钉住 + 推理区域，回读 finalProvider
```

> 在沙箱里跑 `node --test` 需要 `--experimental-test-isolation=none`（测试运行器默认会 spawn 子进程，被文件沙箱拒绝）。

实网结果（2026-11，`cline-pass/deepseek-v4.1-flash-1017`）：

- 管道 `planner`，假上游枚举出 18 条渠道（私有池）/ 23 条（公开池）；
- 只发 `only=["deepseek"]` → 实际 `openai-compatible-private`（钉住被忽略，问题复现）；
- `only=["deepseek"] + inferenceRegion(zone/us, providers.deepseek)` → 实际 `deepseek`，`canonicalSlug=deepseek/deepseek-v4.1-flash-1017`；
- 钉 `alibaba` / `wafer` 同样命中；`has` 与 region 同时存在时仍然生效；
- `scope:"global"` 或 `scope:"off"` 会退回私有通道，这就是开关保留的意义；
- 流式请求同样能回读 `finalProvider`；direct 管道（OpenRouter）不受 region 影响。

---

## 已知边界

- 依赖 Harness 进程内的 `globalThis.fetch`。若未来版本给 pi-ai 传了自定义 `fetch`，拦截器会失效（`/diag` 会显示未拦截，聊天不受影响）。
- 渠道清单来自网关报错文本，属于未文档化行为，网关改文案会失败；此时面板会显示「还没有渠道清单」。
- `inferenceRegion` 属于网关未文档化字段：`providers` 必须列出本次允许的渠道，否则网关报
  `None of the providers considered ... support the requested inference region`；插件对这类错误不重试（必然同样失败）。
- 公开池和私有池的渠道名单不同（公开池多出 `digitalocean`、`nebius`、`streamlake` 等）。开启 region 后请重新「探测渠道」，
  否则钉住的可能是只存在于私有池的 slug，会直接 400。
- `geoRegion` 写错（比如 `zz`）网关不报错、只是忽略，插件无法替你校验。
- 共享池限流是瞬时的：`⏳限流` 过一会儿重新「校验」即可。
- 探测/校验/测试会产生极小真实请求（每次约 $0.0002 量级）；**枚举渠道本身零 token**。
- 管道归属由 Cline 侧决定，可能随时间变化，重新「探测渠道」即可刷新。

## 常见问题

**钉住了但「最近实际」还是 openai-compatible-private？**
1.6.1 及更早版本只发 `only`；2026-11 起网关需要 `inferenceRegion` 才执行它。升级到 1.7.0 后确认「推理区域」为「固定 zone」，
   点一次「探测渠道」让渠道清单变成公开池，再「测试钉住」看目标/实际是否一致。
   `GET /dsh-cline/diag` 里的 `lastInjected` 会显示**上一条真实请求**携带的 `providerOptions.gateway`，可直接核对。

**面板显示「请求失败」或一直「加载中」？**
桌面版的页面是 `file://`，插件按 `globalThis.__DSH_TRANSPORT__.streamBaseUrl` 解析 Host 源，Host 侧对
`Origin: null` / `file://` / 回环来源放行并返回 CORS 头。如果仍失败，用浏览器或 PowerShell 打开
`GET /dsh-cline/diag` 看 `interceptor` 与 `lastInterceptError`。

**装了新版本但界面没变？**
客户端 bundle 是随页面加载的：改完要刷新页面（Ctrl+R）；Host 侧代码改动需要完全退出并重启 Harness。

**点了「严格钉住」但标签又跳回「自动」？**
1.2.0 起模式是独立字段：`pinMode: auto | strict | preferred`，不再用「是否已选渠道」推断。
严格/优先模式可以在还没选渠道时保持选中，并提示去点渠道上的「钉住」。旧版 Host 会把 `auto` 归一成 `strict`，
所以升级后需要重启一次 Harness 让 Host 侧代码生效。

**能钉住但面板没有渠道？**
先点「探测渠道」。渠道清单来自网关的假上游报错（零 token），若网关改了文案会解析失败，`/diag` 里能看到网关请求计数。

## License

MIT