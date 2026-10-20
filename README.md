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
| **planner** | Vercel AI Gateway | `choices[0].message.provider_metadata.gateway.routing` | `providerOptions.gateway.only / order / sort` |
| **direct** | OpenRouter | 顶层 `provider`（显示名）+ 真实 `model` | 顶层 `provider.only / order / sort` |

顶层的 `provider.only` 对 planner 管道会被 Cline 丢弃，所以「换上游不生效」。本插件在 Harness 进程内拦截发往网关的 `chat/completions`，按模型所属管道注入正确的字段，再回读响应里的 `finalProvider`。

---

## 安装（从 GitHub 安装）

```powershell
dsh plugin --profile desktop add github:MARYCOMPLEX/dsh-cline
```

`dsh` 在 `F:\DeepSeek\resources\runtime\cli\bin\dsh.cmd`（桌面版自带）。装完**重启 DeepSeek Harness**，打开
**设置 → 模型**，页面底部会出现「Cline 上游」卡片。

也可以锁定版本或分支：

```powershell
dsh plugin --profile desktop add github:MARYCOMPLEX/dsh-cline#v1.1.0
```

更新到最新：

```powershell
dsh plugin --profile desktop update dsh-cline
```

卸载：

```powershell
dsh plugin --profile desktop remove dsh-cline
```

> 本地开发时也可以 `add C:\path\to\dsh-cline` 以目录链接方式安装；发布使用上面的 GitHub 形式。

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
7. **测试钉住**：按当前配置真实跑一次，显示目标 vs 实际以及尝试序列。

聊天时插件自动记录：管道、实际渠道、规范模型、耗时、尝试序列（最近 50 条）。面板每 4 秒刷新一次，页面隐藏时暂停。

---

## 配置

`cordis.patch.yml` 里的行配置：

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关；关闭后请求完全透传 |
| `gatewayBase` | `https://api.cline.bot/api/v1` | 网关地址 |
| `apiKeyEnv` | `CLINE_API_KEY` | 探测/校验用的凭据引用；优先走 `ctx.credentials`，其次用拦截到的 `Authorization`（仅内存），最后读环境变量 |
| `modelPrefix` | `cline-pass/` | 只处理这个前缀的模型 |
| `llmProvider` | `cline` | 拉取模型清单用的 provider 路由名 |
| `attemptTimeoutMs` | `120000` | 单次尝试超时 |
| `probeTimeoutMs` | `180000` | 探测超时 |
| `maxHistory` | `50` | 每模型保留的请求历史条数 |
| `allowRemote` | `false` | 是否允许非回环地址调用插件路由 |
| `debug` | `false` | 打印拦截器日志 |

每模型的钉住配置和观测结果存在 `$DSH_HOME/storages/dsh-cline.json`。**不存密钥、不存消息正文。**

---

## 面板 HTTP 接口

同源或本机来源、支持 CORS 预检、1 MB 请求体上限：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/dsh-cline/state` | 配置 + 渠道 + 最近实际 + 模型清单 |
| GET | `/dsh-cline/diag` | 拦截器状态、网关请求计数、状态文件路径 |
| GET | `/dsh-cline/history` | 最近 100 条请求记录 |
| POST | `/dsh-cline/config` | `{model, upstreams, exclude, pinMode, sort}` |
| POST | `/dsh-cline/probe` | `{model}` → 管道 + 渠道清单 |
| POST | `/dsh-cline/validate` | `{model}` → 全渠道可用性 |
| POST | `/dsh-cline/test` | `{model}` → 目标 vs 实际 + 尝试序列 |
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
node --test dsh-cline/test          # 30 个纯函数 / 拦截器单测
node dsh-cline/tools/live-probe.mjs # 实网：判管道、枚举、钉住、流式、direct 管道
node dsh-cline/tools/live-interceptor.mjs [model] [a,b]  # 实网：走真实拦截链路
```

实网结果（2026-10，`cline-pass/deepseek-v4.1-flash-1017`）：

- 管道 `planner`，假上游枚举出 16 条渠道；
- 钉 `alibaba` → 实际 `alibaba`；钉 `baseten`（当时限流）→ 明确 429；
- `order=[baseten, alibaba]` → 实际落到 `alibaba`（网关侧回退）；
- 流式请求同样能回读 `finalProvider`；
- direct 管道样例 `cline-pass/glm-5.3-flash` 枚举出 30 条渠道。

---

## 已知边界

- 依赖 Harness 进程内的 `globalThis.fetch`。若未来版本给 pi-ai 传了自定义 `fetch`，拦截器会失效（`/diag` 会显示未拦截，聊天不受影响）。
- 渠道清单来自网关报错文本，属于未文档化行为，网关改文案会失败；此时面板会显示「还没有渠道清单」。
- 共享池限流是瞬时的：`⏳限流` 过一会儿重新「校验」即可。
- 探测/校验/测试会产生极小真实请求（每次约 $0.0002 量级）；**枚举渠道本身零 token**。
- 管道归属由 Cline 侧决定，可能随时间变化，重新「探测渠道」即可刷新。

## License

MIT