// Browser half of dsh-cline — the Cline upstream console.
//
// Rendered in the Settings -> Models footer slot. Styling uses the harness
// alias tokens (--dsw-alias-*), so light and dark themes, contrast, and the
// DeepSeek visual language come from the host instead of hard-coded colors.
window.__ModuleLoader__.load({
  id: 'dsh-cline',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // The same shared outline icon set the built-in composer pills use. It is a
    // platform seed module, so no extra dependency declaration is involved; the
    // fallback keeps the panel alive if that seed ever disappears.
    const primitives = (() => {
      try {
        return require('@deepseek-ai/dsh-client-ui-primitives')
      } catch {
        return null
      }
    })()
    const FallbackRouteIcon = () => h('svg', {
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
    },
    h('path', { d: 'M4 2.5v11' }),
    h('path', { d: 'M4 7h4.2a3 3 0 0 0 3-3V2.5' }),
    h('path', { d: 'M4 7h4.2a3 3 0 0 1 3 3v1.5' }))
    const RouteIcon = (primitives && primitives.IconBranchOutlineRegular) || FallbackRouteIcon

    // A broken seed icon must not take the whole pill (and its slot row) down;
    // the boundary swaps in the local outline instead.
    class IconBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }

      static getDerivedStateFromError() {
        return { failed: true }
      }

      componentDidCatch() {
        // The fallback icon is the recovery path; nothing to report.
      }

      render() {
        return this.state.failed ? h(FallbackRouteIcon, null) : this.props.children
      }
    }

    // Match the built-in StatsPills geometry (14px icon, 6px gap, 1px/8px
    // padding, 12px type) so the added pill sits in the same optical rhythm.
    const PILL_CSS = [
      '.dc-upstream-pill{display:inline-flex;align-items:center;gap:6px;min-width:0;padding:1px 8px;',
      'border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);',
      'font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);',
      'line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap}',
      '.dc-upstream-pill svg{flex:none;width:14px;height:14px}',
      '.dc-upstream-icon{display:inline-flex;flex:none;color:inherit}',
      '.dc-upstream-label{overflow:hidden;text-overflow:ellipsis}',
      '.dc-upstream-pill[data-tone="warn"] .dc-upstream-icon{color:var(--dsw-alias-state-warn-primary)}',
      '.dc-upstream-pill[data-tone="bad"] .dc-upstream-icon{color:var(--dsw-alias-state-error-primary)}',
    ].join('')
    if (typeof document !== 'undefined' && document.querySelector('style[data-dsh-cline-pill]') === null) {
      const style = document.createElement('style')
      style.dataset.dshClinePill = ''
      style.textContent = PILL_CSS
      document.head.appendChild(style)
    }
    const API = '/dsh-cline'

    // The Desktop renderer may load the page from file:// and talk to the Host
    // over an absolute origin, so a relative path would resolve against the
    // document and reach nothing. Prefer the advertised transport origin.
    const TRANSPORT_ORIGIN = (() => {
      try {
        const transport = globalThis.__DSH_TRANSPORT__
        if (transport && typeof transport.streamBaseUrl === 'string' && transport.streamBaseUrl) {
          return new URL(transport.streamBaseUrl).origin
        }
      } catch {
        // fall through
      }
      return ''
    })()

    const PAGE_IS_HTTP = (() => {
      try {
        return /^https?:$/.test(location.protocol)
      } catch {
        return false
      }
    })()

    function apiURL(path) {
      return (PAGE_IS_HTTP ? '' : TRANSPORT_ORIGIN) + API + path
    }

    const TEXT = {
      zh: {
        title: 'Cline 上游',
        subtitle: '枚举订阅模型背后的渠道，钉住一个或按优先级回退，并回读每条请求实际命中的上游。',
        gateway: '网关',
        enabled: '已启用',
        disabled: '已停用',
        enable: '启用',
        disable: '停用',
        refresh: '刷新',
        model: '模型',
        chooseModel: '选择模型',
        pipeline: '管道',
        canonical: '规范模型',
        channels: '渠道',
        channelsTitle: '上游渠道',
        channelsHint: '点「钉住」选择一个渠道；点「排除」让它永不被使用。',
        models: '模型',
        pinnedCount: '已钉',
        requests: '请求',
        errors: '错误',
        mode: '模式',
        modeAuto: '自动',
        modeStrict: '严格钉住',
        modePreferred: '优先 + 回退',
        modeAutoHint: '网关自行选择渠道；若设置了排除，只有白名单内的渠道可用。',
        modeStrictHint: '只允许当前钉住的渠道；失败就直接报错。',
        modePreferredHint: '按钉住顺序尝试；网关在第一个不可用时自动顺切。',
        sort: '排序',
        sortSmart: '网关智能选',
        sortCost: '最低成本',
        sortTtft: '最快首字',
        sortTps: '最高吞吐',
        pinnedOrder: '钉住顺序',
        noPinned: '当前为自动模式，未钉住任何渠道。',
        noChannelPinned: '已选择该模式，但还没有钉住渠道；点下方渠道行的「钉住」。',
        pin: '钉住',
        pinned: '已钉住',
        unpin: '取消钉住',
        exclude: '排除',
        excluded: '已排除',
        include: '恢复',
        up: '上移',
        down: '下移',
        remove: '移除',
        clear: '清空',
        auto: '改为自动',
        probe: '探测渠道',
        probing: '探测中…',
        validate: '校验全部',
        validating: '校验中…',
        test: '测试钉住',
        testing: '测试中…',
        probeDone: '探测完成',
        validateDone: '校验完成',
        noChannels: '还没有渠道清单。点「探测渠道」枚举该模型的上游。',
        noModels: '还没有观测到模型。先发一条消息，或点「刷新」。',
        keyMissing: '未检测到上游凭据，探测/校验/测试不可用；正常聊天仍会透传。',
        keyRef: '凭据引用',
        interceptorWarn: '请求拦截器未处于激活状态',
        diagHint: '诊断接口',
        disabledHint: '插件已停用：所有请求按原生方式透传，不会注入任何字段。',
        probeCost: '「探测」会产生一条极小的真实请求；枚举渠道本身零 token。',
        scopeHint: '仅拦截',
        statusOk: '可用',
        statusLimited: '限流',
        statusBad: '不可钉',
        statusAuth: '鉴权失败',
        statusUnknown: '未校验',
        lastActual: '最近实际',
        notProbed: '未探测',
        target: '目标',
        actual: '实际',
        attempts: '尝试',
        hit: '命中',
        miss: '未命中目标',
        testPassed: '钉住生效',
        testFailed: '钉住未生效',
        resultNote: '请求已到达模型，但推理耗尽输出预算，内容为空；该渠道可用。',
        history: '请求历史',
        noHistory: '暂无请求记录。',
        gatewayLog: '网关请求日志',
        logAll: '全部提供商',
        logCline: '仅 Cline',
        logErrors: '仅失败',
        logEmpty: '还没有请求记录。',
        clearLog: '清空日志',
        tokens: 'tokens',
        upstreamCol: '实际上游',
        providerCol: '提供商',
        statusCol: '状态',
        timeCol: '时间',
        latencyCol: '耗时',
        loading: '加载中…',
        requestFailed: '请求失败',
        saved: '已保存',
        saveFailed: '保存失败',
        probeFailed: '探测失败',
        validateFailed: '校验失败',
        testFailedReq: '测试失败',
        unknown: '未知',
        autoTag: '自动',
        seconds: '秒',
        ms: 'ms',
        ctx: '上下文',
        uptime: '在线率',
        note: '备注',
      },
      en: {
        title: 'Cline Upstreams',
        subtitle: 'Discover the channels behind a subscription model, pin one or an ordered fallback list, and read back which upstream actually served each request.',
        gateway: 'Gateway',
        enabled: 'Enabled',
        disabled: 'Disabled',
        enable: 'Enable',
        disable: 'Disable',
        refresh: 'Refresh',
        model: 'Model',
        chooseModel: 'Choose a model',
        pipeline: 'Pipeline',
        canonical: 'Canonical model',
        channels: 'Channels',
        channelsTitle: 'Upstream channels',
        channelsHint: 'Press Pin to select a channel; press Exclude to keep one out of every request.',
        models: 'models',
        pinnedCount: 'pinned',
        requests: 'requests',
        errors: 'errors',
        mode: 'Mode',
        modeAuto: 'Auto',
        modeStrict: 'Strict pin',
        modePreferred: 'Preferred + fallback',
        modeAutoHint: 'The gateway picks a channel; when exclusions are set, only the remaining whitelist is allowed.',
        modeStrictHint: 'Only the pinned channel is allowed; a failure is reported as-is.',
        modePreferredHint: 'Channels are tried in pinned order; the gateway falls through when one is unavailable.',
        sort: 'Sort',
        sortSmart: 'Gateway default',
        sortCost: 'Lowest cost',
        sortTtft: 'Fastest first token',
        sortTps: 'Highest throughput',
        pinnedOrder: 'Pinned order',
        noPinned: 'Automatic mode: no channel is pinned.',
        noChannelPinned: 'The mode is selected but no channel is pinned yet; press Pin on a channel below.',
        pin: 'Pin',
        pinned: 'Pinned',
        unpin: 'Unpin',
        exclude: 'Exclude',
        excluded: 'Excluded',
        include: 'Restore',
        up: 'Move up',
        down: 'Move down',
        remove: 'Remove',
        clear: 'Clear',
        auto: 'Switch to auto',
        probe: 'Probe channels',
        probing: 'Probing…',
        validate: 'Validate all',
        validating: 'Validating…',
        test: 'Test pin',
        testing: 'Testing…',
        probeDone: 'Probe complete',
        validateDone: 'Validation complete',
        noChannels: 'No channel list yet. Press Probe channels to enumerate this model\'s upstreams.',
        noModels: 'No model observed yet. Send a message, or press Refresh.',
        keyMissing: 'No upstream credential detected. Probe / validate / test are unavailable; ordinary chat still passes through.',
        keyRef: 'Credential reference',
        interceptorWarn: 'The request interceptor is not active',
        diagHint: 'Diagnostics endpoint',
        disabledHint: 'Plugin disabled: every request passes through unchanged.',
        probeCost: 'Probing sends one tiny real completion; enumerating channels itself costs zero tokens.',
        scopeHint: 'intercepts only',
        statusOk: 'available',
        statusLimited: 'rate-limited',
        statusBad: 'not pinnable',
        statusAuth: 'auth failed',
        statusUnknown: 'unverified',
        lastActual: 'Last actual',
        notProbed: 'Not probed',
        target: 'target',
        actual: 'actual',
        attempts: 'attempts',
        hit: 'hit',
        miss: 'did not match the target',
        testPassed: 'Pin is in effect',
        testFailed: 'Pin did not take effect',
        resultNote: 'The request reached the model but reasoning consumed the output budget, so the content is empty; the channel is usable.',
        history: 'Request history',
        noHistory: 'No requests recorded yet.',
        gatewayLog: 'Gateway request log',
        logAll: 'All providers',
        logCline: 'Cline only',
        logErrors: 'Failures only',
        logEmpty: 'No requests recorded yet.',
        clearLog: 'Clear log',
        tokens: 'tokens',
        upstreamCol: 'Upstream',
        providerCol: 'Provider',
        statusCol: 'Status',
        timeCol: 'Time',
        latencyCol: 'Latency',
        loading: 'Loading…',
        requestFailed: 'Request failed',
        saved: 'Saved',
        saveFailed: 'Save failed',
        probeFailed: 'Probe failed',
        validateFailed: 'Validation failed',
        testFailedReq: 'Test failed',
        unknown: 'unknown',
        autoTag: 'auto',
        seconds: 's',
        ms: 'ms',
        ctx: 'ctx',
        uptime: 'uptime',
        note: 'note',
      },
    }

    const CSS = `
.dc-root{--dc-bg:var(--dsw-alias-bg-layer-1,light-dark(#fff,#232324));--dc-surface:var(--dsw-alias-bg-layer-2,light-dark(#f9fafb,#2c2c2e));--dc-surface-3:var(--dsw-alias-bg-layer-3,light-dark(#f5f6f7,#353638));--dc-border:var(--dsw-alias-border-l2,light-dark(rgba(0,0,0,.10),rgba(255,255,255,.12)));--dc-border-strong:var(--dsw-alias-border-l3,light-dark(rgba(0,0,0,.16),rgba(255,255,255,.18)));--dc-text:var(--dsw-alias-label-primary,light-dark(#0f1115,#f9fafb));--dc-text-2:var(--dsw-alias-label-secondary,light-dark(#61666b,#cfd3d6));--dc-text-3:var(--dsw-alias-label-tertiary,light-dark(#81858c,#adb2b8));--dc-fill:var(--dsw-alias-button-primary-fill,light-dark(#0f1115,#f9fafb));--dc-fill-hover:var(--dsw-alias-button-primary-hover,light-dark(#353638,#ebeef2));--dc-on-fill:var(--dsw-alias-label-primary-foreground,light-dark(#fff,#0f1115));--dc-hover:var(--dsw-alias-interactive-bg-hover,light-dark(rgba(0,0,0,.05),rgba(255,255,255,.08)));--dc-active:var(--dsw-alias-interactive-bg-active,light-dark(rgba(0,0,0,.09),rgba(255,255,255,.14)));--dc-link:var(--dsw-alias-link,light-dark(#4176e6,#7aaaff));--dc-error:var(--dsw-alias-state-error-primary,light-dark(#d92d20,#ff8a8a));--dc-success:var(--dsw-alias-state-success-primary,light-dark(#0f8a4f,#4ade80));--dc-warn:var(--dsw-alias-state-warn-primary,light-dark(#b54708,#fbbf24));color-scheme:light dark;margin-top:24px;padding:20px;border:1px solid var(--dc-border);border-radius:14px;background:var(--dc-bg);color:var(--dc-text);font:13px/1.55 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;box-sizing:border-box}
.dc-root *{box-sizing:border-box}
.dc-head{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap}
.dc-head-main{flex:1 1 380px;min-width:240px}
.dc-title{font-size:16px;font-weight:600;letter-spacing:.01em}
.dc-sub{margin-top:4px;color:var(--dc-text-2);font-size:13px;max-width:760px}
.dc-gateway{margin-top:6px;color:var(--dc-text-3);font-size:11.5px;font-family:Consolas,"Cascadia Mono",monospace}
.dc-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dc-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--dc-border);border-radius:8px;background:transparent;color:var(--dc-text);font-size:13px;font-family:inherit;line-height:1;cursor:pointer;white-space:nowrap;transition:background .12s ease,border-color .12s ease,color .12s ease}
.dc-btn:hover:not(:disabled){background:var(--dc-hover)}
.dc-btn:focus-visible{outline:2px solid var(--dc-link);outline-offset:2px}
.dc-btn:disabled{opacity:.45;cursor:not-allowed}
.dc-btn-primary{background:var(--dc-fill);border-color:var(--dc-fill);color:var(--dc-on-fill);font-weight:600}
.dc-btn-primary:hover:not(:disabled){background:var(--dc-fill-hover);border-color:var(--dc-fill-hover)}
.dc-btn-ghost{border-color:transparent}
.dc-btn-ghost:hover:not(:disabled){background:var(--dc-hover)}
.dc-btn-danger{border-color:transparent;color:color-mix(in srgb,var(--dc-error) 80%,var(--dc-text))}
.dc-btn-danger:hover:not(:disabled){background:color-mix(in srgb,var(--dc-error) 12%,transparent)}
.dc-btn-sm{height:28px;padding:0 10px;font-size:12px;border-radius:7px}
.dc-btn-xs{height:24px;width:24px;padding:0;font-size:12px;border-radius:6px;border-color:transparent;color:var(--dc-text-2)}
.dc-btn-xs:hover:not(:disabled){background:var(--dc-hover);color:var(--dc-text)}
.dc-switch{position:relative;width:38px;height:22px;padding:0;border:1px solid var(--dc-border-strong);border-radius:999px;background:var(--dc-surface-3);cursor:pointer;flex:none}
.dc-switch:focus-visible{outline:2px solid var(--dc-link);outline-offset:2px}
.dc-switch span{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dc-text-2);transition:transform .15s ease,background .15s ease}
.dc-switch[aria-checked="true"]{background:var(--dc-fill);border-color:var(--dc-fill)}
.dc-switch[aria-checked="true"] span{transform:translateX(16px);background:var(--dc-on-fill)}
.dc-stats{display:flex;gap:22px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1px solid var(--dc-border)}
.dc-stat{display:flex;flex-direction:column;gap:1px;min-width:56px}
.dc-stat-v{font-size:16px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.dc-stat-l{font-size:11px;color:var(--dc-text-3)}
.dc-picker{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:18px;padding-top:16px;border-top:1px solid var(--dc-border)}
.dc-select{height:34px;min-width:300px;max-width:100%;padding:0 10px;border:1px solid var(--dc-border);border-radius:8px;background:var(--dc-surface);color:var(--dc-text);font:inherit;font-size:13px;cursor:pointer}
.dc-select:focus-visible{outline:2px solid var(--dc-link);outline-offset:1px}
.dc-pipe{display:inline-flex;align-items:center;height:24px;padding:0 9px;border:1px solid var(--dc-border);border-radius:999px;font-size:11.5px;color:var(--dc-text-2);white-space:nowrap}
.dc-pipe-planner{color:var(--dc-link);border-color:var(--dc-link)}
.dc-pipe-direct{color:var(--dc-success);border-color:var(--dc-success)}
.dc-section{margin-top:18px;padding-top:16px;border-top:1px solid var(--dc-border)}
.dc-section-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.dc-section-title{font-size:14px;font-weight:600}
.dc-hint{color:var(--dc-text-3);font-size:12px}
.dc-spacer{flex:1 1 auto}
.dc-seg{display:inline-flex;gap:2px;padding:2px;border:1px solid var(--dc-border);border-radius:9px;background:var(--dc-surface)}
.dc-seg button{height:26px;padding:0 11px;border:0;border-radius:7px;background:transparent;color:var(--dc-text-2);font:inherit;font-size:12px;cursor:pointer}
.dc-seg button:hover{color:var(--dc-text);background:var(--dc-hover)}
.dc-seg button[aria-pressed="true"]{background:var(--dc-active);color:var(--dc-text);font-weight:600}
.dc-seg button:focus-visible{outline:2px solid var(--dc-link);outline-offset:1px}
.dc-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dc-label{color:var(--dc-text-3);font-size:12px}
.dc-pinned{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;margin-bottom:10px;border:1px solid var(--dc-border);border-radius:10px;background:var(--dc-surface)}
.dc-chip{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 4px 0 10px;border:1px solid var(--dc-border-strong);border-radius:999px;background:var(--dc-bg);font-size:12px;max-width:100%}
.dc-chip-name{font-family:Consolas,"Cascadia Mono",monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px}
.dc-chip-pos{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:var(--dc-active);color:var(--dc-text-2);font-size:10.5px;font-variant-numeric:tabular-nums}
.dc-list{border:1px solid var(--dc-border);border-radius:10px;overflow:hidden;background:var(--dc-bg)}
.dc-channel{display:grid;grid-template-columns:92px minmax(150px,1.4fr) 120px minmax(120px,auto) 78px;gap:12px;align-items:center;padding:10px 12px;border-top:1px solid var(--dc-border)}
.dc-channel:first-child{border-top:0}
.dc-channel:hover{background:var(--dc-hover)}
.dc-channel-selected{background:color-mix(in srgb,var(--dc-link) 7%,transparent)}
.dc-channel-selected:hover{background:color-mix(in srgb,var(--dc-link) 10%,transparent)}
.dc-slug{font-family:Consolas,"Cascadia Mono",monospace;font-size:13px;font-weight:600;overflow-wrap:anywhere}
.dc-ch-sub{color:var(--dc-text-3);font-size:11.5px;margin-top:1px}
.dc-status{display:inline-flex;align-items:center;gap:6px;color:var(--dc-text-2);font-size:12px;white-space:nowrap}
.dc-dot{width:8px;height:8px;border-radius:50%;flex:none}
.dc-meta{color:var(--dc-text-3);font-size:11.5px;font-variant-numeric:tabular-nums}
.dc-meta-line{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.dc-notice{margin-top:14px;padding:10px 12px;border:1px solid var(--dc-border);border-left:3px solid var(--dc-text-3);border-radius:8px;background:var(--dc-surface);color:var(--dc-text-2);font-size:12.5px;line-height:1.6}
.dc-notice-ok{border-left-color:var(--dc-success)}
.dc-notice-warn{border-left-color:var(--dc-warn)}
.dc-notice-bad{border-left-color:var(--dc-error);color:color-mix(in srgb,var(--dc-error) 80%,var(--dc-text))}
.dc-result{margin-top:14px;padding:12px 14px;border:1px solid var(--dc-border);border-radius:10px;background:var(--dc-surface);display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.dc-result-ok{border-color:color-mix(in srgb,var(--dc-success) 50%,var(--dc-border))}
.dc-result-bad{border-color:color-mix(in srgb,var(--dc-error) 50%,var(--dc-border))}
.dc-result-main{font-size:13px;font-weight:600}
.dc-result-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.dc-code{font-family:Consolas,"Cascadia Mono",monospace;font-size:12px;overflow-wrap:anywhere}
.dc-empty{padding:20px 4px;color:var(--dc-text-3);font-size:12.5px;text-align:center}
.dc-history{margin-top:16px}
.dc-history summary{cursor:pointer;color:var(--dc-text-2);font-size:12.5px;user-select:none}
.dc-log-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0 8px}
.dc-logs{border:1px solid var(--dc-border);border-radius:10px;overflow:hidden;background:var(--dc-bg)}
.dc-log-row{display:grid;grid-template-columns:64px 78px minmax(120px,1.2fr) minmax(90px,.8fr) 56px 58px 84px;gap:8px;align-items:center;padding:6px 10px;border-top:1px solid var(--dc-border);font-size:11.5px;color:var(--dc-text-2)}
.dc-log-row:first-child{border-top:0}
.dc-log-head{background:var(--dc-surface);color:var(--dc-text-3);font-size:11px}
.dc-log-row .dc-code{font-size:11.5px}
.dc-log-provider{display:inline-flex;align-items:center;gap:5px}
.dc-history summary:focus-visible{outline:2px solid var(--dc-link);outline-offset:2px}
.dc-history-row{display:grid;grid-template-columns:110px minmax(120px,1fr) 64px 70px;gap:10px;padding:6px 0;border-top:1px solid var(--dc-border);font-size:12px;align-items:center}
.dc-history-row:first-of-type{margin-top:8px}
.dc-truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dc-footer{margin-top:14px;color:var(--dc-text-3);font-size:11.5px}
@media (max-width:820px){.dc-channel{grid-template-columns:1fr 1fr}.dc-channel .dc-ch-name{grid-column:1/-1}.dc-channel .dc-ch-actions{grid-column:2;justify-self:end}.dc-channel .dc-ch-status{grid-column:1;grid-row:2}.dc-channel .dc-ch-meta{grid-column:1/-1}.dc-select{min-width:0;width:100%}.dc-seg button{padding:0 8px}}
@media (prefers-reduced-motion:reduce){.dc-root *{transition:none!important}}
`

    function langFromStorage() {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const saved = window.localStorage.getItem('dsh-cline.lang')
          if (saved === 'zh' || saved === 'en') return saved
        }
      } catch {
        // ignore
      }
      const language = typeof navigator !== 'undefined' ? String(navigator.language || '') : ''
      return language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
    }

    async function request(path, init) {
      const target = apiURL(path)
      let response
      try {
        response = await fetch(target, init)
      } catch (failure) {
        // A file:// page with no advertised origin, or a stale origin: retry
        // against the transport origin once before reporting a network error.
        if (!PAGE_IS_HTTP && TRANSPORT_ORIGIN) throw failure
        throw new Error(`${failure && failure.message ? failure.message : failure} (${target})`)
      }
      return response
    }

    async function api(path, body) {
      const response = await request(path, body === undefined
        ? { headers: { accept: 'application/json' } }
        : {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
        })
      const json = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
      if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`)
      if (json && json.ok === false) throw new Error(json.error || 'request failed')
      return json
    }

    async function apiRaw(path, body) {
      const response = await request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
      return { status: response.status, json }
    }

    function emptyModel(id) {
      return {
        id,
        pipeline: null,
        canonicalSlug: null,
        upstreams: [],
        cfg: { upstreams: [], exclude: [], pinMode: 'auto', sort: null },
        last: null,
        history: [],
        requests: 0,
        errors: 0,
        probedAt: null,
        validatedAt: null,
        tier0: [],
      }
    }

    function normalizeCfg(input) {
      const cfg = input && typeof input === 'object' ? input : {}
      return {
        upstreams: Array.isArray(cfg.upstreams) ? cfg.upstreams : [],
        exclude: Array.isArray(cfg.exclude) ? cfg.exclude : [],
        pinMode: cfg.pinMode === 'preferred' ? 'preferred' : cfg.pinMode === 'auto' ? 'auto' : 'strict',
        sort: ['cost', 'ttft', 'tps'].includes(cfg.sort) ? cfg.sort : null,
      }
    }

    function fmtTime(value) {
      if (!value) return '—'
      try {
        const date = new Date(value)
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      } catch {
        return '—'
      }
    }

    function fmtContext(value) {
      const number = Number(value)
      if (!Number.isFinite(number) || number <= 0) return null
      if (number >= 1000000) return `${Math.round(number / 100000) / 10}M`
      if (number >= 1000) return `${Math.round(number / 1000)}k`
      return String(number)
    }

    function statusMeta(status) {
      switch (status) {
        case 'ok':
          return { color: 'var(--dc-success)', key: 'statusOk' }
        case 'limited':
          return { color: 'var(--dc-warn)', key: 'statusLimited' }
        case 'bad':
          return { color: 'var(--dc-error)', key: 'statusBad' }
        case 'auth':
          return { color: 'var(--dc-error)', key: 'statusAuth' }
        default:
          return { color: 'var(--dc-text-3)', key: 'statusUnknown' }
      }
    }

    function StatusPill(props) {
      const meta = statusMeta(props.status)
      return h('span', { className: 'dc-status', title: props.note || '' },
        h('span', { className: 'dc-dot', style: { background: meta.color } }),
        h('span', null, props.t[meta.key]),
      )
    }

    function PipelineBadge(props) {
      const pipeline = props.pipeline
      if (pipeline === 'planner') return h('span', { className: 'dc-pipe dc-pipe-planner' }, 'planner · Vercel')
      if (pipeline === 'direct') return h('span', { className: 'dc-pipe dc-pipe-direct' }, 'direct · OpenRouter')
      return h('span', { className: 'dc-pipe' }, props.t.notProbed)
    }

    function ChannelRow(props) {
      const { channel, position, excluded, t, busy, onPin, onExclude, busyKey } = props
      const selected = position >= 0
      const meta = statusMeta(channel.status)
      const context = fmtContext(channel.context)
      return h('div', { className: `dc-channel${selected ? ' dc-channel-selected' : ''}` },
        h('button', {
          type: 'button',
          className: `dc-btn dc-btn-sm${selected ? ' dc-btn-primary' : ''}`,
          disabled: busy,
          'aria-pressed': selected,
          onClick: () => onPin(channel.slug),
          title: selected ? t.unpin : t.pin,
        }, busyKey === `pin:${channel.slug}` ? '…' : selected ? `✓ ${position + 1}` : t.pin),
        h('div', { className: 'dc-ch-name' },
          h('div', { className: 'dc-slug' }, channel.slug),
          h('div', { className: 'dc-ch-sub' },
            channel.name && channel.name !== channel.slug ? channel.name : t[meta.key],
            channel.note ? ` · ${String(channel.note).slice(0, 90)}` : '',
          ),
        ),
        h('div', { className: 'dc-ch-status' }, h(StatusPill, { status: channel.status, note: channel.note, t })),
        h('div', { className: 'dc-ch-meta dc-meta-line' },
          channel.ms ? h('span', { className: 'dc-meta' }, `${channel.ms} ${t.ms}`) : null,
          context ? h('span', { className: 'dc-meta' }, `${t.ctx} ${context}`) : null,
          channel.uptime ? h('span', { className: 'dc-meta' }, `${t.uptime} ${channel.uptime}%`) : null,
        ),
        h('div', { className: 'dc-ch-actions' },
          h('button', {
            type: 'button',
            className: `dc-btn dc-btn-sm dc-btn-ghost${excluded ? ' dc-btn-danger' : ''}`,
            disabled: busy,
            'aria-pressed': excluded,
            onClick: () => onExclude(channel.slug),
            title: excluded ? t.include : t.exclude,
          }, excluded ? t.excluded : t.exclude),
        ),
      )
    }

    function PinChip(props) {
      const { slug, index, total, t, busy, onMove, onRemove } = props
      return h('span', { className: 'dc-chip' },
        h('span', { className: 'dc-chip-pos' }, String(index + 1)),
        h('span', { className: 'dc-chip-name', title: slug }, slug),
        h('button', {
          type: 'button', className: 'dc-btn dc-btn-xs', disabled: busy || index === 0,
          onClick: () => onMove(slug, -1), title: t.up, 'aria-label': `${t.up}: ${slug}`,
        }, '↑'),
        h('button', {
          type: 'button', className: 'dc-btn dc-btn-xs', disabled: busy || index === total - 1,
          onClick: () => onMove(slug, 1), title: t.down, 'aria-label': `${t.down}: ${slug}`,
        }, '↓'),
        h('button', {
          type: 'button', className: 'dc-btn dc-btn-xs', disabled: busy,
          onClick: () => onRemove(slug), title: t.remove, 'aria-label': `${t.remove}: ${slug}`,
        }, '×'),
      )
    }

    // Per-session memory: the pill is a session-scoped slot, so its reading must
    // never be inherited from the conversation the user just left. The same
    // reading is mirrored into localStorage because a reload remounts the slot
    // before any new request exists, and an empty bar reads as "broken".
    const upstreamMemory = new Map()
    const UPSTREAM_STORE = 'dsh-cline.upstream.'

    function readStored(sessionId) {
      if (!sessionId) return null
      const cached = upstreamMemory.get(sessionId)
      if (cached) return cached
      try {
        const raw = globalThis.localStorage?.getItem(UPSTREAM_STORE + sessionId)
        const parsed = raw ? JSON.parse(raw) : null
        if (parsed && typeof parsed === 'object' && parsed.id) {
          upstreamMemory.set(sessionId, parsed)
          return parsed
        }
      } catch {
        // Private mode or a stale value: fall through to a live reading.
      }
      return null
    }

    function storeReading(sessionId, reading) {
      if (!sessionId) return
      upstreamMemory.set(sessionId, reading)
      try {
        globalThis.localStorage?.setItem(UPSTREAM_STORE + sessionId, JSON.stringify(reading))
      } catch {
        // Quota or private mode: the in-memory copy still covers this page.
      }
    }

    function UpstreamPill(props) {
      const sessionId = props && typeof props.sessionId === 'string' ? props.sessionId : null
      const mountedAt = React.useRef(Date.now())
      const [entry, setEntry] = React.useState(() => readStored(sessionId))
      const [enabled, setEnabled] = React.useState(true)

      // A conversation switch must clear the reading immediately, before the
      // next poll can arrive; otherwise the previous channel lingers.
      React.useEffect(() => {
        mountedAt.current = Date.now()
        setEntry(readStored(sessionId))
      }, [sessionId])

      React.useEffect(() => {
        let alive = true
        let timer = null
        const tick = async () => {
          try {
            const query = sessionId ? `?session=${encodeURIComponent(sessionId)}` : ''
            const response = await fetch(apiURL(`/status${query}`), { headers: { accept: 'application/json' } })
            const json = await response.json()
            if (!alive) return
            setEnabled(json.enabled !== false)
            const candidate = json.last || null
            // A Host-attributed entry belongs to exactly one session; an
            // unattributed one is only adopted when it arrived while this
            // conversation was on screen.
            const owned = candidate
              && (candidate.session ? candidate.session === sessionId : candidate.at >= mountedAt.current)
            if (!owned) return
            storeReading(sessionId, candidate)
            setEntry(candidate)
          } catch {
            // The Host may be starting; retry on the next tick.
          }
          if (alive) timer = setTimeout(tick, 5000)
        }
        tick()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [sessionId])

      if (!enabled || !entry) return null
      const upstream = entry.upstream || null
      const mismatch = !!(entry.target && upstream && entry.target !== upstream)
      const tone = entry.error ? 'bad' : mismatch ? 'warn' : undefined
      const zh = langFromStorage() === 'zh'
      // Never present a provider name as if it were a resolved upstream: when
      // the response carried no routing attribution the field stays unknown.
      const label = upstream
        ? `${zh ? '上游' : 'upstream'} ${upstream}`
        : entry.provider && entry.provider !== 'cline'
          ? `${zh ? '经' : 'via'} ${entry.provider}`
          : `${zh ? '上游' : 'upstream'} ${zh ? '未解析' : 'n/a'}`
      const detail = [
        entry.model || entry.requestedModel || '',
        `provider: ${entry.provider || '—'}`,
        `upstream: ${upstream || '—'}`,
        entry.target ? `target: ${entry.target}` : '',
        entry.status ? `status: ${entry.status}` : 'status: ERR',
        entry.ms ? `${entry.ms} ms` : '',
        entry.error ? `error: ${entry.error}` : '',
      ].filter(Boolean).join('\n')
      return h('span', {
        className: 'dc-upstream-pill',
        'data-tone': tone,
        title: detail,
      },
      h('span', { className: 'dc-upstream-icon', 'aria-hidden': true },
        h(IconBoundary, null, h(RouteIcon, null))),
      h('span', { className: 'dc-upstream-label' }, label))
    }

    function Panel(props) {
      const [lang, setLang] = React.useState(langFromStorage)
      const [data, setData] = React.useState(props && props.initialData ? props.initialData : null)
      const [selectedId, setSelectedId] = React.useState(props && props.initialModel ? props.initialModel : null)
      const [busy, setBusy] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [result, setResult] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [logs, setLogs] = React.useState([])
      const [logTotal, setLogTotal] = React.useState(0)
      const [logOpen, setLogOpen] = React.useState(false)
      const [logFilter, setLogFilter] = React.useState('all')
      const busyRef = React.useRef(null)
      const t = TEXT[lang]

      React.useEffect(() => { busyRef.current = busy }, [busy])

      const reload = React.useCallback(async () => {
        try {
          const next = await api('/state')
          setData(next)
          setError(null)
          return next
        } catch (failure) {
          setError(String(failure && failure.message ? failure.message : failure))
          return null
        }
      }, [])

      React.useEffect(() => {
        if (!logOpen) return undefined
        let alive = true
        let timer = null
        const load = async () => {
          try {
            const query = logFilter === 'cline'
              ? '?onlyCline=1&limit=80'
              : logFilter === 'errors'
                ? '?onlyErrors=1&limit=80'
                : '?limit=80'
            const json = await api('/logs' + query)
            if (alive) {
              setLogs(json.entries || [])
              setLogTotal(json.total || 0)
            }
          } catch {
            // Keep the previous page; the next tick retries.
          }
          if (alive) timer = setTimeout(load, 4000)
        }
        load()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [logOpen, logFilter])

      React.useEffect(() => {
        let alive = true
        let timer = null
        const tick = async () => {
          if (!alive) return
          const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
          if (!busyRef.current && !hidden) await reload()
          if (alive) timer = setTimeout(tick, 4000)
        }
        tick()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [reload])

      const models = React.useMemo(() => {
        const map = new Map()
        for (const id of (data && data.modelIds) || []) {
          if (typeof id === 'string' && id) map.set(id, emptyModel(id))
        }
        for (const model of (data && data.models) || []) {
          if (!model || typeof model.id !== 'string') continue
          map.set(model.id, {
            ...emptyModel(model.id),
            ...model,
            cfg: normalizeCfg(model.cfg),
            upstreams: Array.isArray(model.upstreams) ? model.upstreams : [],
            history: Array.isArray(model.history) ? model.history : [],
          })
        }
        return [...map.values()].sort((left, right) => left.id.localeCompare(right.id))
      }, [data])

      const current = models.find((model) => model.id === selectedId) || models[0] || null

      React.useEffect(() => {
        if (current && current.id !== selectedId) setSelectedId(current.id)
      }, [current && current.id])

      const run = async (key, operation, describe) => {
        setBusy(key)
        setNotice(null)
        setResult(null)
        try {
          const value = await operation()
          if (describe) setNotice({ tone: 'ok', text: describe(value) })
          await reload()
        } catch (failure) {
          setNotice({ tone: 'bad', text: String(failure && failure.message ? failure.message : failure) })
        } finally {
          setBusy(null)
        }
      }

      const save = async (patch, successText) => {
        if (!current) return
        setBusy('save')
        setNotice(null)
        try {
          const cfg = current.cfg
          await api('/config', {
            model: current.id,
            upstreams: patch.upstreams !== undefined ? patch.upstreams : cfg.upstreams,
            exclude: patch.exclude !== undefined ? patch.exclude : cfg.exclude,
            pinMode: patch.pinMode !== undefined ? patch.pinMode : cfg.pinMode,
            sort: patch.sort !== undefined ? patch.sort : cfg.sort,
          })
          await reload()
          if (successText) setNotice({ tone: 'ok', text: successText })
        } catch (failure) {
          setNotice({ tone: 'bad', text: `${t.saveFailed}: ${String(failure && failure.message ? failure.message : failure)}` })
        } finally {
          setBusy(null)
        }
      }

      const probe = () => {
        if (!current) return
        return run('probe', () => api('/probe', { model: current.id }),
          (value) => `${t.probeDone}: ${value.pipeline || t.unknown} · ${(value.upstreams || []).length} ${t.channels} · ${value.ms} ${t.ms}`)
      }

      const validate = () => {
        if (!current) return
        return run('validate', () => api('/validate', { model: current.id }),
          (value) => `${t.validateDone}: ${value.summary.ok || 0} ${t.statusOk}, ${value.summary.limited || 0} ${t.statusLimited}, ${value.summary.bad || 0} ${t.statusBad}`)
      }

      const test = async () => {
        if (!current) return
        setBusy('test')
        setNotice(null)
        setResult(null)
        try {
          const raw = await apiRaw('/test', { model: current.id })
          setResult(raw.json)
          await reload()
        } catch (failure) {
          setNotice({ tone: 'bad', text: `${t.testFailedReq}: ${String(failure && failure.message ? failure.message : failure)}` })
        } finally {
          setBusy(null)
        }
      }

      const pin = (slug) => {
        if (!current) return
        const cfg = current.cfg
        const pinned = cfg.upstreams.includes(slug)
        const mode = cfg.pinMode === 'auto' ? 'strict' : cfg.pinMode
        let upstreams
        if (pinned) upstreams = cfg.upstreams.filter((value) => value !== slug)
        else if (mode === 'preferred') upstreams = [...cfg.upstreams, slug]
        else upstreams = [slug]
        const exclude = cfg.exclude.filter((value) => value !== slug)
        const modeName = mode === 'preferred' ? t.modePreferred : t.modeStrict
        save({ upstreams, exclude, pinMode: mode }, pinned ? `${t.unpin}: ${slug}` : `${t.pinned}: ${slug} · ${modeName}`)
      }

      const exclude = (slug) => {
        if (!current) return
        const cfg = current.cfg
        const excluded = cfg.exclude.includes(slug)
        const nextExclude = excluded ? cfg.exclude.filter((value) => value !== slug) : [...cfg.exclude, slug]
        const nextUpstreams = excluded ? cfg.upstreams : cfg.upstreams.filter((value) => value !== slug)
        save({ exclude: nextExclude, upstreams: nextUpstreams }, excluded ? `${t.include}: ${slug}` : `${t.excluded}: ${slug}`)
      }

      const move = (slug, delta) => {
        if (!current) return
        const cfg = current.cfg
        const index = cfg.upstreams.indexOf(slug)
        if (index < 0) return
        const next = [...cfg.upstreams]
        const target = index + delta
        if (target < 0 || target >= next.length) return
        ;[next[index], next[target]] = [next[target], next[index]]
        save({ upstreams: next })
      }

      const clear = () => {
        if (!current) return
        save({ upstreams: [], pinMode: 'auto' }, `${t.saved}: ${t.modeAuto}`)
      }

      const setMode = (mode) => {
        if (!current) return
        if (mode === 'auto') return save({ upstreams: [], pinMode: 'auto' }, `${t.saved}: ${t.modeAuto}`)
        return save({ pinMode: mode }, `${t.saved}: ${mode === 'strict' ? t.modeStrict : t.modePreferred}`)
      }

      const setSort = (value) => {
        if (!current) return
        save({ sort: value || null }, `${t.saved}: ${t.sort}`)
      }

      const clearLogs = async () => {
        try {
          await api('/logs/clear', {})
          setLogs([])
          setLogTotal(0)
          setNotice({ tone: 'ok', text: t.clearLog })
        } catch (failure) {
          setNotice({ tone: 'bad', text: `${t.requestFailed}: ${String(failure && failure.message ? failure.message : failure)}` })
        }
      }

      const toggleEnabled = () => run('enabled', () => api('/enabled', { enabled: !(data && data.enabled) }),
        (value) => value.enabled ? t.enabled : t.disabled)

      const summary = (data && data.summary) || {}
      const cfg = current ? current.cfg : normalizeCfg()
      const channels = current ? current.upstreams : []
      const channelMap = new Map(channels.map((channel) => [channel.slug, channel]))
      const excludedSet = new Set(cfg.exclude)
      const ordered = [...channels].sort((left, right) => {
        const leftPos = cfg.upstreams.indexOf(left.slug)
        const rightPos = cfg.upstreams.indexOf(right.slug)
        if (leftPos !== rightPos) {
          if (leftPos === -1) return 1
          if (rightPos === -1) return -1
          return leftPos - rightPos
        }
        const rank = { ok: 0, limited: 1, unknown: 2, bad: 3, auth: 4 }
        return (rank[left.status] ?? 2) - (rank[right.status] ?? 2) || left.slug.localeCompare(right.slug)
      })
      const last = current && current.last ? current.last : null
      const lastProvider = last && last.provider ? last.provider : null
      const modeHint = cfg.pinMode === 'auto'
        ? t.modeAutoHint
        : cfg.pinMode === 'preferred'
          ? t.modePreferredHint
          : t.modeStrictHint

      const resultOk = result && result.ok === true
      const resultTarget = result && Array.isArray(result.trace) && result.trace.length && result.trace[0].upstream
        ? result.trace[0].upstream
        : (cfg.upstreams[0] || null)
      const resultActual = result && result.actual ? result.actual : null
      const resultHit = result && result.ok ? (!resultTarget || resultActual === resultTarget) : false

      return h('section', { className: 'dc-root', 'aria-label': t.title, lang: lang === 'zh' ? 'zh-CN' : 'en' },
        h('style', { key: 'dc-style' }, CSS),

        h('div', { className: 'dc-head' },
          h('div', { className: 'dc-head-main' },
            h('div', { className: 'dc-title' }, t.title),
            h('div', { className: 'dc-sub' }, t.subtitle),
            h('div', { className: 'dc-gateway' }, `${t.gateway}: ${data && data.gateway ? data.gateway : 'https://api.cline.bot/api/v1'}`),
          ),
          h('div', { className: 'dc-toolbar' },
            h('button', {
              type: 'button',
              className: 'dc-switch',
              role: 'switch',
              'aria-checked': !!(data && data.enabled),
              'aria-label': data && data.enabled ? t.disable : t.enable,
              disabled: !!busy || !data,
              onClick: toggleEnabled,
              title: data && data.enabled ? t.disable : t.enable,
            }, h('span', null)),
            h('span', { className: 'dc-label' }, data && data.enabled ? t.enabled : t.disabled),
            h('button', { type: 'button', className: 'dc-btn dc-btn-ghost dc-btn-sm', disabled: !!busy, onClick: reload }, t.refresh),
            h('button', {
              type: 'button',
              className: 'dc-btn dc-btn-ghost dc-btn-sm',
              onClick: () => setLang(lang === 'zh' ? 'en' : 'zh'),
              title: lang === 'zh' ? 'English' : '中文',
            }, lang === 'zh' ? 'EN' : '中文'),
          ),
        ),

        h('div', { className: 'dc-stats' },
          h('div', { className: 'dc-stat' }, h('span', { className: 'dc-stat-v' }, String(summary.models || 0)), h('span', { className: 'dc-stat-l' }, t.models)),
          h('div', { className: 'dc-stat' }, h('span', { className: 'dc-stat-v' }, String(summary.channels || 0)), h('span', { className: 'dc-stat-l' }, t.channels)),
          h('div', { className: 'dc-stat' }, h('span', { className: 'dc-stat-v' }, String(summary.pinned || 0)), h('span', { className: 'dc-stat-l' }, t.pinnedCount)),
          h('div', { className: 'dc-stat' }, h('span', { className: 'dc-stat-v' }, String(summary.requests || 0)), h('span', { className: 'dc-stat-l' }, t.requests)),
          summary.errors ? h('div', { className: 'dc-stat' }, h('span', { className: 'dc-stat-v', style: { color: 'var(--dc-error)' } }, String(summary.errors)), h('span', { className: 'dc-stat-l' }, t.errors)) : null,
        ),

        data && data.enabled === false ? h('div', { className: 'dc-notice dc-notice-warn' }, t.disabledHint) : null,
        data && data.apiKeyConfigured === false
          ? h('div', { className: 'dc-notice dc-notice-warn' }, `${t.keyMissing} (${(data && data.apiKeyEnv) || 'CLINE_API_KEY'})`)
          : null,
        data && data.interceptor && data.interceptor !== 'installed'
          ? h('div', { className: 'dc-notice dc-notice-warn' }, `${t.interceptorWarn}: ${data.interceptor}`)
          : null,
        error
          ? h('div', { className: 'dc-notice dc-notice-bad' },
            `${t.requestFailed}: ${error}`,
            h('div', { className: 'dc-meta', style: { marginTop: 4 } },
              `${t.diagHint}: GET ${(PAGE_IS_HTTP ? '' : TRANSPORT_ORIGIN)}${API}/diag`))
          : null,
        notice ? h('div', { className: `dc-notice dc-notice-${notice.tone === 'ok' ? 'ok' : notice.tone === 'warn' ? 'warn' : 'bad'}` }, notice.text) : null,

        !data
          ? h('div', { className: 'dc-empty' }, t.loading)
          : models.length === 0
            ? h('div', { className: 'dc-empty' }, t.noModels)
            : h(React.Fragment, null,
              h('div', { className: 'dc-picker' },
                h('span', { className: 'dc-label' }, t.model),
                h('select', {
                  className: 'dc-select',
                  value: current ? current.id : '',
                  onChange: (event) => setSelectedId(event.target.value),
                  'aria-label': t.chooseModel,
                }, models.map((model) => h('option', { key: model.id, value: model.id }, model.id))),
                h(PipelineBadge, { pipeline: current && current.pipeline, t }),
                current && current.canonicalSlug ? h('span', { className: 'dc-meta' }, current.canonicalSlug) : null,
                h('span', { className: 'dc-spacer' }),
                h('div', { className: 'dc-row' },
                  h('button', { type: 'button', className: `dc-btn dc-btn-sm${channels.length ? '' : ' dc-btn-primary'}`, disabled: !!busy, onClick: probe }, busy === 'probe' ? t.probing : t.probe),
                  h('button', { type: 'button', className: 'dc-btn dc-btn-sm', disabled: !!busy || !channels.length, onClick: validate }, busy === 'validate' ? t.validating : t.validate),
                  h('button', { type: 'button', className: 'dc-btn dc-btn-sm', disabled: !!busy, onClick: test }, busy === 'test' ? t.testing : t.test),
                ),
              ),

              h('div', { className: 'dc-row', style: { marginTop: 10 } },
                h('span', { className: 'dc-label' }, t.lastActual),
                lastProvider ? h('span', { className: 'dc-code' }, lastProvider) : h('span', { className: 'dc-meta' }, t.notProbed),
                last ? h('span', { className: 'dc-meta' }, `${last.ms || 0} ${t.ms}`) : null,
                last && last.at ? h('span', { className: 'dc-meta' }, fmtTime(last.at)) : null,
                last && Array.isArray(last.attempts) && last.attempts.length > 1
                  ? h('span', { className: 'dc-meta' }, `${t.attempts}: ${last.attempts.join(' → ')}`)
                  : null,
                last && last.error ? h('span', { className: 'dc-meta', style: { color: 'var(--dc-error)' } }, String(last.error).slice(0, 140)) : null,
              ),

              h('div', { className: 'dc-section' },
                h('div', { className: 'dc-section-head' },
                  h('span', { className: 'dc-section-title' }, t.pinnedOrder),
                  h('span', { className: 'dc-spacer' }),
                  h('span', { className: 'dc-label' }, t.mode),
                  h('div', { className: 'dc-seg', role: 'group', 'aria-label': t.mode },
                    h('button', {
                      type: 'button', 'aria-pressed': cfg.pinMode === 'auto',
                      disabled: !!busy, onClick: () => setMode('auto'),
                    }, t.modeAuto),
                    h('button', {
                      type: 'button', 'aria-pressed': cfg.pinMode === 'strict',
                      disabled: !!busy, onClick: () => setMode('strict'),
                    }, t.modeStrict),
                    h('button', {
                      type: 'button', 'aria-pressed': cfg.pinMode === 'preferred',
                      disabled: !!busy, onClick: () => setMode('preferred'),
                    }, t.modePreferred),
                  ),
                  h('span', { className: 'dc-label' }, t.sort),
                  h('select', {
                    className: 'dc-select',
                    style: { height: 30, minWidth: 150, fontSize: 12 },
                    value: cfg.sort || '',
                    disabled: !!busy,
                    onChange: (event) => setSort(event.target.value),
                    'aria-label': t.sort,
                  },
                  h('option', { value: '' }, t.sortSmart),
                  h('option', { value: 'cost' }, t.sortCost),
                  h('option', { value: 'ttft' }, t.sortTtft),
                  h('option', { value: 'tps' }, t.sortTps)),
                ),
                h('div', { className: 'dc-pinned' },
                  cfg.upstreams.length === 0
                    ? h('span', { className: 'dc-hint' }, cfg.pinMode === 'auto' ? t.noPinned : t.noChannelPinned)
                    : cfg.upstreams.map((slug, index) => h(PinChip, {
                      key: slug, slug, index, total: cfg.upstreams.length, t, busy: !!busy,
                      onMove: move, onRemove: pin,
                    })),
                  h('span', { className: 'dc-spacer' }),
                  cfg.upstreams.length
                    ? h('button', { type: 'button', className: 'dc-btn dc-btn-sm dc-btn-ghost', disabled: !!busy, onClick: clear }, t.clear)
                    : null,
                ),
                h('div', { className: 'dc-hint', style: { marginBottom: 10 } }, modeHint),
                channels.length === 0
                  ? h('div', { className: 'dc-empty' }, t.noChannels)
                  : h('div', { className: 'dc-list' }, ordered.map((channel) => h(ChannelRow, {
                    key: channel.slug,
                    channel,
                    position: cfg.upstreams.indexOf(channel.slug),
                    excluded: excludedSet.has(channel.slug),
                    t,
                    busy: !!busy,
                    busyKey: busy,
                    onPin: pin,
                    onExclude: exclude,
                  }))),
              ),

              result ? h('div', { className: `dc-result ${resultOk ? 'dc-result-ok' : 'dc-result-bad'}` },
                h('div', { className: 'dc-result-body' },
                  h('div', { className: 'dc-result-main' },
                    resultOk
                      ? `${resultHit ? '✓' : '⚠'} ${t.actual}: ${resultActual || t.unknown}${resultTarget ? ` · ${t.target}: ${resultTarget}` : ''}`
                      : `✕ ${t.testFailedReq}: ${String(result.error || t.unknown).slice(0, 180)}`),
                  h('div', { className: 'dc-meta-line' },
                    result.ms ? h('span', { className: 'dc-meta' }, `${result.ms} ${t.ms}`) : null,
                    h('span', { className: 'dc-meta' }, `${t.attempts}: ${(result.trace || []).map((step) => `${step.upstream || 'auto'}(${step.status})`).join(' → ') || '—'}`),
                    result.note ? h('span', { className: 'dc-meta' }, result.note) : null,
                  ),
                ),
              ) : null,

              h('details', { className: 'dc-history' },
                h('summary', null, `${t.history} (${(current && current.history ? current.history.length : 0)})`),
                (current && current.history && current.history.length)
                  ? current.history.slice(0, 8).map((item, index) => h('div', { className: 'dc-history-row', key: `${item.at || index}-${index}` },
                    h('span', { className: 'dc-meta' }, fmtTime(item.at)),
                    h('span', { className: 'dc-code dc-truncate', title: item.provider || '' }, item.provider || t.unknown),
                    h('span', { className: 'dc-meta' }, `${item.ms || 0} ${t.ms}`),
                    h('span', { className: 'dc-meta dc-truncate', title: (item.attempts || []).join(' → ') }, (item.attempts || []).join(' → ') || '—'),
                  ))
                  : h('div', { className: 'dc-empty' }, t.noHistory),
              ),

              h('details', {
                className: 'dc-history',
                open: logOpen,
                onToggle: (event) => setLogOpen(event.currentTarget.open),
              },
              h('summary', null, `${t.gatewayLog} (${logOpen ? logTotal : ((data && data.logCount) || logTotal)})`),
              logOpen ? h(React.Fragment, null,
                h('div', { className: 'dc-log-tools' },
                  h('select', {
                    className: 'dc-select',
                    style: { height: 28, minWidth: 140, fontSize: 12 },
                    value: logFilter,
                    onChange: (event) => setLogFilter(event.target.value),
                    'aria-label': t.gatewayLog,
                  },
                  h('option', { value: 'all' }, t.logAll),
                  h('option', { value: 'cline' }, t.logCline),
                  h('option', { value: 'errors' }, t.logErrors)),
                  h('span', { className: 'dc-spacer' }),
                  h('button', { type: 'button', className: 'dc-btn dc-btn-sm dc-btn-ghost', onClick: clearLogs }, t.clearLog),
                ),
                logs.length
                  ? h('div', { className: 'dc-logs' },
                    h('div', { className: 'dc-log-row dc-log-head' },
                      h('span', null, t.timeCol),
                      h('span', null, t.providerCol),
                      h('span', null, t.model),
                      h('span', null, t.upstreamCol),
                      h('span', null, t.statusCol),
                      h('span', null, t.latencyCol),
                      h('span', null, t.tokens),
                    ),
                    logs.map((entry) => {
                      const bad = !!entry.error || !entry.status || Number(entry.status) >= 400
                      const mismatch = entry.target && entry.upstream && entry.target !== entry.upstream
                      return h('div', {
                        key: entry.id,
                        className: 'dc-log-row',
                        title: [
                          entry.endpoint ? `${entry.endpoint}` : '',
                          entry.error ? `${t.error}: ${entry.error}` : '',
                          entry.target ? `${t.target}: ${entry.target}` : '',
                          Array.isArray(entry.attempts) && entry.attempts.length ? `${t.attempts}: ${entry.attempts.join(' → ')}` : '',
                          entry.requestId ? `id: ${entry.requestId}` : '',
                        ].filter(Boolean).join('\n'),
                      },
                      h('span', { className: 'dc-meta' }, fmtTime(entry.at)),
                      h('span', { className: 'dc-log-provider' },
                        h('span', { className: 'dc-dot', style: { background: entry.provider === 'cline' ? 'var(--dc-link)' : 'var(--dc-text-3)' } }),
                        entry.provider || '—'),
                      h('span', { className: 'dc-code dc-truncate', title: entry.model || '' }, entry.model || entry.requestedModel || '—'),
                      h('span', {
                        className: 'dc-code dc-truncate',
                        style: mismatch ? { color: 'var(--dc-warn)' } : undefined,
                        title: entry.upstream || '',
                      }, entry.upstream || '—'),
                      h('span', { className: 'dc-meta', style: bad ? { color: 'var(--dc-error)' } : undefined }, entry.status ? String(entry.status) : 'ERR'),
                      h('span', { className: 'dc-meta' }, entry.ms ? `${entry.ms} ${t.ms}` : '—'),
                      h('span', { className: 'dc-meta' }, entry.usage
                        ? `${entry.usage.prompt || 0}/${entry.usage.completion || 0}`
                        : '—'),
                      )
                    }),
                  )
                  : h('div', { className: 'dc-empty' }, t.logEmpty),
              ) : null,
              ),
            ),

        h('div', { className: 'dc-footer' },
          t.probeCost,
          data && data.gateway && data.modelPrefix
            ? h('span', null, ` · ${t.scopeHint}: ${data.gateway} · ${data.modelPrefix}*`)
            : null,
        ),
      )
    }

    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      render() {
        if (this.state.error) {
          return h('div', { className: 'dc-notice dc-notice-bad', style: { marginTop: 24, padding: 16, border: '1px solid currentColor', borderRadius: 10 } },
            `Cline upstream panel failed: ${String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error)}`)
        }
        return this.props.children
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
          name: 'settings.models.footer',
          id: 'dsh-cline',
          order: 20,
        }, (slotProps) => h(Boundary, null, h(Panel, slotProps || {}))))

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'dsh-cline-upstream',
          order: 2,
        }, UpstreamPill))
      },
    }
  },
})