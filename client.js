// Browser half of dsh-cline. Renders the Cline upstream console in the
// Settings -> Models footer slot. Plain JavaScript: React comes from the
// harness module table, styling uses host theme tokens with safe fallbacks.
window.__ModuleLoader__.load({
  id: 'dsh-cline',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const API = '/dsh-cline'

    const TEXT = {
      zh: {
        title: 'Cline 上游',
        subtitle: '枚举订阅模型背后的渠道，精确钉住或按优先级回退，并回读每条请求实际命中的上游。',
        enabled: '已启用',
        disabled: '已停用',
        enable: '启用',
        disable: '停用',
        refresh: '刷新',
        model: '模型',
        pipeline: '管道',
        channels: '渠道',
        targets: '目标上游',
        mode: '模式',
        sort: '排序',
        last: '最近实际',
        actions: '操作',
        probe: '探测',
        validate: '校验',
        test: '测试',
        auto: '自动（不钉）',
        strict: '严格钉住',
        preferred: '优先 + 回退',
        smart: '网关智能选',
        cost: '最低成本',
        ttft: '最快首字',
        tps: '最高吞吐',
        unknown: '未探测',
        noRows: '还没有可显示的模型。点「刷新」，或先发送一条消息让插件捕获模型。',
        noChannels: '尚未枚举渠道，点「探测」获取。',
        apiKeyMissing: '未检测到上游凭据，探测/校验/测试不可用；正常聊天仍会透传。',
        disabledHint: '插件已停用：所有请求按原生方式透传，不会注入任何字段。',
        probeCost: '探测会产生一条极小的真实请求；枚举渠道本身零 token。',
        channelsTitle: '渠道与可用性',
        selectOk: '全选可用',
        clear: '清空优先',
        priority: '优先',
        exclude: '排除',
        up: '上移',
        down: '下移',
        statusOk: '可用',
        statusLimited: '限流',
        statusBad: '不可钉',
        statusAuth: '鉴权',
        statusUnknown: '未知',
        emptyPriority: '未选择上游 = 自动模式',
        target: '目标',
        actual: '实际',
        attempts: '尝试',
        noActual: '—',
        error: '错误',
        loading: '加载中…',
        requestFailed: '请求失败',
        probeDone: '探测完成',
        validateDone: '校验完成',
        hit: '命中',
        missed: '未命中目标',
        trace: '尝试序列',
        canonical: '规范模型',
        probedAt: '上次探测',
        validatedAt: '上次校验',
        requests: '请求',
        errors: '错误',
        models: '模型',
        pinned: '已钉',
      },
      en: {
        title: 'Cline Upstreams',
        subtitle: 'Discover every channel behind a subscription model, pin one or an ordered fallback list, and read back which upstream actually served each request.',
        enabled: 'Enabled',
        disabled: 'Disabled',
        enable: 'Enable',
        disable: 'Disable',
        refresh: 'Refresh',
        model: 'Model',
        pipeline: 'Pipeline',
        channels: 'Channels',
        targets: 'Targets',
        mode: 'Mode',
        sort: 'Sort',
        last: 'Last actual',
        actions: 'Actions',
        probe: 'Probe',
        validate: 'Validate',
        test: 'Test',
        auto: 'Auto (no pin)',
        strict: 'Strict pin',
        preferred: 'Preferred + fallback',
        smart: 'Gateway default',
        cost: 'Lowest cost',
        ttft: 'Fastest first token',
        tps: 'Highest throughput',
        unknown: 'Not probed',
        noRows: 'No models yet. Refresh, or send a message so the plugin can observe one.',
        noChannels: 'No channels discovered yet. Press Probe.',
        apiKeyMissing: 'Upstream credential not detected. Probe / validate / test are unavailable; ordinary chat still passes through.',
        disabledHint: 'Plugin disabled: every request passes through unchanged.',
        probeCost: 'Probing sends one tiny real completion; enumerating channels itself costs zero tokens.',
        channelsTitle: 'Channels and availability',
        selectOk: 'Select available',
        clear: 'Clear priority',
        priority: 'Priority',
        exclude: 'Exclude',
        up: 'Up',
        down: 'Down',
        statusOk: 'available',
        statusLimited: 'rate-limited',
        statusBad: 'not pinnable',
        statusAuth: 'auth',
        statusUnknown: 'unknown',
        emptyPriority: 'No upstream selected = automatic mode',
        target: 'target',
        actual: 'actual',
        attempts: 'attempts',
        noActual: '—',
        error: 'error',
        loading: 'Loading…',
        requestFailed: 'Request failed',
        probeDone: 'Probe complete',
        validateDone: 'Validation complete',
        hit: 'hit',
        missed: 'did not match target',
        trace: 'Attempts',
        canonical: 'Canonical model',
        probedAt: 'Probed',
        validatedAt: 'Validated',
        requests: 'requests',
        errors: 'errors',
        models: 'models',
        pinned: 'pinned',
      },
    }

    const COLORS = {
      bg: 'var(--dsw-alias-bg-layer-1, #171a21)',
      bgSoft: 'var(--dsw-alias-bg-layer-2, #1d212b)',
      border: 'var(--dsw-alias-border, #2a2f3c)',
      text: 'var(--dsw-alias-text, #e6e6e6)',
      dim: 'var(--dsw-alias-text-secondary, #9aa4b2)',
      accent: 'var(--dsw-alias-accent, #4c8dff)',
      danger: 'var(--dsw-alias-danger, #ff6b6b)',
      success: 'var(--dsw-alias-success, #52c41a)',
      warning: 'var(--dsw-alias-warning, #d89614)',
    }

    const S = {
      card: {
        marginTop: 18,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 10,
        background: COLORS.bg,
        color: COLORS.text,
        padding: 16,
        boxSizing: 'border-box',
        font: '13px/1.55 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
      },
      header: { display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' },
      title: { fontSize: 15, fontWeight: 650, letterSpacing: 0.1 },
      subtitle: { color: COLORS.dim, fontSize: 12.5, marginTop: 3, maxWidth: 760 },
      grow: { flex: '1 1 auto' },
      toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
      stats: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 },
      stat: { border: `1px solid ${COLORS.border}`, borderRadius: 20, padding: '2px 10px', color: COLORS.dim, fontSize: 12 },
      banner: { marginTop: 12, border: `1px solid ${COLORS.border}`, borderLeft: `3px solid ${COLORS.warning}`, borderRadius: 6, padding: '8px 10px', color: COLORS.dim, fontSize: 12.5 },
      error: { borderLeftColor: COLORS.danger, color: COLORS.danger },
      success: { borderLeftColor: COLORS.success, color: COLORS.success },
      tableWrap: { marginTop: 14, overflowX: 'auto' },
      table: { width: '100%', borderCollapse: 'collapse', minWidth: 980 },
      th: { textAlign: 'left', color: COLORS.dim, fontWeight: 500, fontSize: 11.5, padding: '7px 8px', borderBottom: `1px solid ${COLORS.border}`, whiteSpace: 'nowrap' },
      td: { padding: '8px', borderBottom: `1px solid ${COLORS.border}`, verticalAlign: 'top' },
      mono: { fontFamily: 'Consolas, "Cascadia Mono", monospace', fontSize: 12 },
      small: { color: COLORS.dim, fontSize: 11.5 },
      select: { background: COLORS.bgSoft, color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: '4px 6px', fontSize: 12 },
      button: { background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 6, padding: '4px 9px', fontSize: 12, cursor: 'pointer' },
      buttonOn: { background: COLORS.accent, borderColor: COLORS.accent, color: '#fff' },
      buttonDanger: { borderColor: COLORS.danger, color: COLORS.danger },
      buttonTiny: { padding: '2px 7px', fontSize: 11 },
      chip: { display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: '2px 8px', fontSize: 11.5, cursor: 'pointer', color: COLORS.dim, background: 'transparent' },
      chipOn: { borderColor: COLORS.accent, color: COLORS.accent, background: 'color-mix(in srgb, var(--dsw-alias-accent, #4c8dff) 12%, transparent)' },
      chipBad: { borderColor: COLORS.danger, color: COLORS.danger },
      badge: { display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 12, padding: '1px 8px', fontSize: 11.5, border: `1px solid ${COLORS.border}`, color: COLORS.dim },
      dot: { width: 7, height: 7, borderRadius: '50%', display: 'inline-block' },
      detail: { padding: '10px 12px 14px', background: COLORS.bgSoft, borderBottom: `1px solid ${COLORS.border}` },
      channelRow: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderBottom: `1px dashed ${COLORS.border}` },
      channelName: { minWidth: 180, fontWeight: 550 },
      spacer: { flex: '1 1 auto' },
      nowrap: { whiteSpace: 'nowrap' },
    }

    const STATUS = {
      ok: { color: COLORS.success, key: 'statusOk' },
      limited: { color: COLORS.warning, key: 'statusLimited' },
      bad: { color: COLORS.danger, key: 'statusBad' },
      auth: { color: COLORS.danger, key: 'statusAuth' },
      unknown: { color: COLORS.dim, key: 'statusUnknown' },
    }

    function langFromStorage() {
      try {
        const saved = window.localStorage.getItem('dsh-cline.lang')
        if (saved === 'zh' || saved === 'en') return saved
      } catch {
        // ignore
      }
      return String(navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en'
    }

    async function api(path, body) {
      const response = await fetch(API + path, body === undefined
        ? { headers: { accept: 'application/json' }, credentials: 'same-origin' }
        : {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(body),
        })
      const json = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
      if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`)
      if (json && json.ok === false) throw new Error(json.error || 'request failed')
      return json
    }

    async function apiRaw(path, body) {
      const response = await fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
      const json = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
      return { status: response.status, json }
    }

    function fmtTime(value) {
      if (!value) return '—'
      try {
        return new Date(value).toLocaleTimeString()
      } catch {
        return '—'
      }
    }

    function pipelineBadge(model, t) {
      if (model.pipeline === 'planner') return h('span', { style: { ...S.badge, borderColor: COLORS.accent, color: COLORS.accent } }, 'planner · Vercel')
      if (model.pipeline === 'direct') return h('span', { style: { ...S.badge, borderColor: COLORS.success, color: COLORS.success } }, 'direct · OpenRouter')
      return h('span', { style: S.badge }, t.unknown)
    }

    function statusBadge(channel, t) {
      const status = channel.status && STATUS[channel.status] ? channel.status : 'unknown'
      const meta = STATUS[status]
      return h('span', { style: { ...S.badge, color: meta.color, borderColor: meta.color }, title: channel.note || '' },
        h('span', { style: { ...S.dot, background: meta.color } }),
        t[meta.key])
    }

    function Chip(props) {
      return h('button', {
        type: 'button',
        onClick: props.onClick,
        title: props.title || '',
        'aria-pressed': !!props.on,
        style: { ...S.chip, ...(props.on ? S.chipOn : null), ...(props.bad ? S.chipBad : null) },
      }, props.children)
    }

    function channelLabel(channel) {
      return channel.slug
    }

    function ModelRow(props) {
      const { model, lang, busy, expanded, onToggle, onProbe, onValidate, onTest, onCfg, t } = props
      const cfg = model.cfg || { upstreams: [], exclude: [], pinMode: 'strict', sort: null }
      const selected = Array.isArray(cfg.upstreams) ? cfg.upstreams : []
      const excluded = Array.isArray(cfg.exclude) ? cfg.exclude : []
      const rowBusy = busy && String(busy).endsWith(`:${model.id}`)
      const anyBusy = !!busy
      const channels = Array.isArray(model.upstreams) ? model.upstreams : []
      const last = model.last || null
      const target = selected[0] || null
      const actual = last && last.provider ? last.provider : null
      const hit = !target || (actual && actual === target)

      const save = (patch) => {
        onCfg(model, patch)
      }

      const togglePriority = (slug) => {
        const next = selected.includes(slug) ? selected.filter((value) => value !== slug) : [...selected, slug]
        save({ upstreams: next, exclude: excluded.filter((value) => value !== slug) })
      }

      const toggleExclude = (slug) => {
        const next = excluded.includes(slug) ? excluded.filter((value) => value !== slug) : [...excluded, slug]
        save({ exclude: next, upstreams: selected.filter((value) => value !== slug) })
      }

      const move = (slug, delta) => {
        const index = selected.indexOf(slug)
        if (index < 0) return
        const next = [...selected]
        const targetIndex = index + delta
        if (targetIndex < 0 || targetIndex >= next.length) return
        ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
        save({ upstreams: next })
      }

      const selectAvailable = () => {
        const usable = channels
          .filter((channel) => !channel.status || channel.status === 'ok')
          .map((channel) => channel.slug)
          .filter((slug) => !excluded.includes(slug))
        save({ upstreams: [...new Set([...selected, ...usable])] })
      }

      return h(React.Fragment, null,
        h('tr', null,
          h('td', { style: S.td },
            h('div', { style: S.mono }, model.id),
            h('div', { style: S.small }, `${model.requests || 0} ${t.requests}${model.errors ? ` · ${model.errors} ${t.errors}` : ''}`),
            h('div', { style: { marginTop: 4 } }, pipelineBadge(model, t)),
          ),
          h('td', { style: { ...S.td, ...S.small } },
            model.canonicalSlug ? h('div', { style: S.mono }, model.canonicalSlug) : '—',
            model.tier0 && model.tier0.length ? h('div', { style: S.small }, `tier-0: ${model.tier0.join(', ')}`) : null,
          ),
          h('td', { style: S.td },
            h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
              h('span', { style: { ...S.badge, borderColor: channels.length ? COLORS.border : COLORS.warning } }, String(channels.length)),
              h('button', { type: 'button', style: { ...S.button, ...S.buttonTiny }, onClick: () => onToggle(model.id) }, expanded ? '−' : '+'),
            ),
          ),
          h('td', { style: S.td },
            selected.length
              ? h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 260 } }, selected.map((slug, index) => h('span', { key: slug, style: { ...S.badge, color: COLORS.accent, borderColor: COLORS.accent } }, `${index + 1}. ${slug}`)))
              : h('span', { style: S.small }, t.auto),
          ),
          h('td', { style: S.td },
            h('select', {
              value: cfg.pinMode || 'strict',
              style: S.select,
              onChange: (event) => save({ pinMode: event.target.value }),
            },
            h('option', { value: 'strict' }, t.strict),
            h('option', { value: 'preferred' }, t.preferred)),
          ),
          h('td', { style: S.td },
            h('select', {
              value: cfg.sort || '',
              style: S.select,
              onChange: (event) => save({ sort: event.target.value || null }),
            },
            h('option', { value: '' }, t.smart),
            h('option', { value: 'cost' }, t.cost),
            h('option', { value: 'ttft' }, t.ttft),
            h('option', { value: 'tps' }, t.tps)),
          ),
          h('td', { style: S.td },
            actual
              ? h('div', null,
                h('span', { style: { ...S.badge, color: hit ? COLORS.success : COLORS.warning, borderColor: hit ? COLORS.success : COLORS.warning } }, actual),
                h('div', { style: S.small }, `${last.ms || 0} ms · ${fmtTime(last.at)}`),
              )
              : h('div', null,
                h('span', { style: { ...S.badge, color: last && last.error ? COLORS.danger : COLORS.dim } }, last && last.error ? t.error : t.noActual),
                last && last.error ? h('div', { style: { ...S.small, color: COLORS.danger, maxWidth: 220, wordBreak: 'break-word' } }, String(last.error).slice(0, 160)) : null,
              ),
            last && Array.isArray(last.attempts) && last.attempts.length > 1
              ? h('div', { style: { ...S.small, marginTop: 3 } }, `${t.trace}: ${last.attempts.join(' → ')}`)
              : null,
          ),
          h('td', { style: S.td },
            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              h('button', { type: 'button', disabled: anyBusy, style: S.button, onClick: () => onProbe(model) }, rowBusy && String(busy).startsWith('probe:') ? '…' : t.probe),
              h('button', { type: 'button', disabled: anyBusy || !channels.length, style: S.button, onClick: () => onValidate(model) }, rowBusy && String(busy).startsWith('validate:') ? '…' : t.validate),
              h('button', { type: 'button', disabled: anyBusy, style: S.button, onClick: () => onTest(model) }, rowBusy && String(busy).startsWith('test:') ? '…' : t.test),
            ),
          ),
        ),
        expanded ? h('tr', null,
          h('td', { colSpan: 8, style: S.detail },
            h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
              h('strong', null, t.channelsTitle),
              h('span', { style: S.small }, model.probedAt ? `${t.probedAt} ${fmtTime(model.probedAt)}` : ''),
              model.validatedAt ? h('span', { style: S.small }, `${t.validatedAt} ${fmtTime(model.validatedAt)}`) : null,
              h('span', { style: S.spacer }),
              h('button', { type: 'button', disabled: anyBusy, style: { ...S.button, ...S.buttonTiny }, onClick: selectAvailable }, t.selectOk),
              h('button', { type: 'button', disabled: anyBusy, style: { ...S.button, ...S.buttonTiny }, onClick: () => save({ upstreams: [] }) }, t.clear),
            ),
            channels.length
              ? h('div', { style: { marginTop: 8 } }, channels.map((channel) => {
                const isSelected = selected.includes(channel.slug)
                const isExcluded = excluded.includes(channel.slug)
                const position = selected.indexOf(channel.slug)
                return h('div', { key: channel.slug, style: S.channelRow },
                  h('button', {
                    type: 'button',
                    onClick: () => togglePriority(channel.slug),
                    'aria-pressed': isSelected,
                    style: { ...S.button, ...S.buttonTiny, ...(isSelected ? S.buttonOn : null) },
                    title: t.priority,
                  }, isSelected ? `✓ ${t.priority} ${position + 1}` : t.priority),
                  h('button', {
                    type: 'button',
                    onClick: () => toggleExclude(channel.slug),
                    'aria-pressed': isExcluded,
                    style: { ...S.button, ...S.buttonTiny, ...(isExcluded ? { ...S.buttonDanger, background: 'transparent', borderColor: COLORS.danger } : null) },
                    title: t.exclude,
                  }, isExcluded ? `✕ ${t.exclude}` : t.exclude),
                  h('button', { type: 'button', disabled: !isSelected || position <= 0, style: { ...S.button, ...S.buttonTiny }, onClick: () => move(channel.slug, -1), title: t.up }, '↑'),
                  h('button', { type: 'button', disabled: !isSelected || position < 0 || position >= selected.length - 1, style: { ...S.button, ...S.buttonTiny }, onClick: () => move(channel.slug, 1), title: t.down }, '↓'),
                  h('span', { style: { ...S.channelName, ...S.mono } }, channelLabel(channel)),
                  channel.name && channel.name !== channel.slug ? h('span', { style: S.small }, channel.name) : null,
                  statusBadge(channel, t),
                  channel.ms ? h('span', { style: S.small }, `${channel.ms} ms`) : null,
                  channel.context ? h('span', { style: S.small }, `ctx ${channel.context}`) : null,
                  channel.uptime ? h('span', { style: S.small }, `up ${channel.uptime}%`) : null,
                  h('span', { style: S.spacer }),
                  channel.note ? h('span', { style: { ...S.small, maxWidth: 360, wordBreak: 'break-word' }, title: channel.note }, String(channel.note).slice(0, 120)) : null,
                )
              }))
              : h('div', { style: { ...S.small, marginTop: 8 } }, t.noChannels),
            selected.length
              ? h('div', { style: { ...S.small, marginTop: 10 } }, `${t.targets}: ${selected.join(' > ')}${cfg.pinMode === 'strict' ? ` · ${t.strict}` : ` · ${t.preferred}`}`)
              : h('div', { style: { ...S.small, marginTop: 10 } }, t.emptyPriority),
          ),
        ) : null,
      )
    }

    function Panel(props) {
      const [lang, setLang] = React.useState(langFromStorage)
      const [data, setData] = React.useState(props && props.initialData ? props.initialData : null)
      const [error, setError] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [expanded, setExpanded] = React.useState(props && props.initialExpanded ? props.initialExpanded : null)
      const t = TEXT[lang]

      const reload = React.useCallback(async () => {
        try {
          const next = await api('/state')
          setData(next)
          setError(null)
          return next
        } catch (failure) {
          setError(String(failure?.message || failure))
          return null
        }
      }, [])

      React.useEffect(() => {
        let alive = true
        let timer = null
        const tick = async () => {
          if (!alive) return
          try {
            const next = await api('/state')
            if (alive) {
              setData(next)
              setError(null)
            }
          } catch (failure) {
            if (alive) setError(String(failure?.message || failure))
          } finally {
            if (alive) timer = setTimeout(tick, 2500)
          }
        }
        tick()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [])

      const setLanguage = (next) => {
        setLang(next)
        try {
          window.localStorage.setItem('dsh-cline.lang', next)
        } catch {
          // ignore
        }
      }

      const run = async (key, operation, describe) => {
        setBusy(key)
        setNotice(null)
        try {
          const result = await operation()
          if (describe) setNotice({ tone: 'ok', text: describe(result) })
          await reload()
        } catch (failure) {
          setNotice({ tone: 'bad', text: String(failure?.message || failure) })
        } finally {
          setBusy(null)
        }
      }

      const probe = (model) => run(`probe:${model.id}`, () => api('/probe', { model: model.id }),
        (result) => `${t.probeDone}: ${result.pipeline || t.unknown} · ${result.upstreams?.length || 0} ${t.channels} · ${result.ms} ms`)

      const validate = (model) => run(`validate:${model.id}`, () => api('/validate', { model: model.id }),
        (result) => `${t.validateDone}: ${result.summary?.ok || 0} ${t.statusOk} / ${result.summary?.limited || 0} ${t.statusLimited} / ${result.summary?.bad || 0} ${t.statusBad}`)

      const test = async (model) => {
        setBusy(`test:${model.id}`)
        setNotice(null)
        try {
          const result = await apiRaw('/test', { model: model.id })
          if (!result.json.ok) {
            setNotice({ tone: 'bad', text: `${t.test} ${t.requestFailed}: ${result.json.error || 'unknown'}` })
            return
          }
          const target = (model.cfg?.upstreams || [])[0] || null
          const actual = result.json.actual || null
          const hit = !target || actual === target
          setNotice({
            tone: hit ? 'ok' : 'warn',
            text: `${hit ? '✔' : '⚠'} ${t.actual} ${actual || t.unknown}${target ? ` · ${t.target} ${target}` : ''} · ${result.json.ms} ms · ${t.trace}: ${(result.json.trace || []).map((step) => `${step.upstream || 'auto'}(${step.status})`).join(' → ')}`,
          })
          await reload()
        } catch (failure) {
          setNotice({ tone: 'bad', text: String(failure?.message || failure) })
        } finally {
          setBusy(null)
        }
      }

      const saveCfg = async (model, patch) => {
        const cfg = model.cfg || { upstreams: [], exclude: [], pinMode: 'strict', sort: null }
        try {
          await api('/config', {
            model: model.id,
            upstreams: patch.upstreams ?? cfg.upstreams ?? [],
            exclude: patch.exclude ?? cfg.exclude ?? [],
            pinMode: patch.pinMode ?? cfg.pinMode ?? 'strict',
            sort: patch.sort !== undefined ? patch.sort : cfg.sort,
          })
          await reload()
        } catch (failure) {
          setNotice({ tone: 'bad', text: String(failure?.message || failure) })
        }
      }

      const toggleEnabled = () => run('enabled', () => api('/enabled', { enabled: !(data && data.enabled) }),
        (result) => result.enabled ? t.enabled : t.disabled)

      const rows = React.useMemo(() => {
        const map = new Map()
        for (const id of data?.modelIds || []) {
          map.set(id, {
            id,
            pipeline: null,
            canonicalSlug: null,
            upstreams: [],
            cfg: { upstreams: [], exclude: [], pinMode: 'strict', sort: null },
            last: null,
            requests: 0,
            errors: 0,
          })
        }
        for (const model of data?.models || []) {
          map.set(model.id, {
            ...map.get(model.id),
            ...model,
            cfg: model.cfg || { upstreams: [], exclude: [], pinMode: 'strict', sort: null },
            upstreams: Array.isArray(model.upstreams) ? model.upstreams : [],
          })
        }
        return [...map.values()].sort((left, right) => left.id.localeCompare(right.id))
      }, [data])

      const summary = data?.summary || {}

      return h('section', { style: S.card, 'aria-label': t.title },
        h('div', { style: S.header },
          h('div', { style: S.grow },
            h('div', { style: S.title }, t.title),
            h('div', { style: S.subtitle }, t.subtitle),
            h('div', { style: { ...S.small, marginTop: 4 } },
              h('span', { style: S.mono }, data?.gateway || 'https://api.cline.bot/api/v1'),
              data ? h('span', null, ` · ${data.llmProvider || 'cline'}`) : null,
            ),
          ),
          h('div', { style: S.toolbar },
            h('button', {
              type: 'button',
              disabled: !!busy || !data,
              style: { ...S.button, ...(data?.enabled ? S.buttonOn : S.buttonDanger) },
              onClick: toggleEnabled,
              title: data?.enabled ? t.disable : t.enable,
            }, busy === 'enabled' ? '…' : data?.enabled ? t.enabled : t.disabled),
            h('button', { type: 'button', disabled: !!busy, style: S.button, onClick: reload }, t.refresh),
            h('button', { type: 'button', style: S.button, onClick: () => setLanguage(lang === 'zh' ? 'en' : 'zh') }, lang === 'zh' ? 'EN' : '中文'),
          ),
        ),

        h('div', { style: S.stats },
          h('span', { style: S.stat }, `${summary.models || 0} ${t.models}`),
          h('span', { style: S.stat }, `${summary.channels || 0} ${t.channels}`),
          h('span', { style: S.stat }, `${summary.pinned || 0} ${t.pinned}`),
          h('span', { style: S.stat }, `${summary.requests || 0} ${t.requests}`),
          summary.errors ? h('span', { style: { ...S.stat, color: COLORS.danger, borderColor: COLORS.danger } }, `${summary.errors} ${t.errors}`) : null,
        ),

        data && data.enabled === false ? h('div', { style: S.banner }, t.disabledHint) : null,
        data && data.apiKeyConfigured === false ? h('div', { style: S.banner }, `${t.apiKeyMissing} (${data.apiKeyEnv || 'CLINE_API_KEY'})`) : null,
        error ? h('div', { style: { ...S.banner, ...S.error } }, `${t.requestFailed}: ${error}`) : null,
        notice ? h('div', { style: { ...S.banner, ...(notice.tone === 'ok' ? S.success : notice.tone === 'bad' ? S.error : null) } }, notice.text) : null,

        !data
          ? h('div', { style: { ...S.small, marginTop: 14 } }, t.loading)
          : rows.length === 0
            ? h('div', { style: { ...S.small, marginTop: 14 } }, t.noRows)
            : h('div', { style: S.tableWrap },
              h('table', { style: S.table },
                h('thead', null,
                  h('tr', null,
                    h('th', { style: S.th }, t.model),
                    h('th', { style: S.th }, t.canonical),
                    h('th', { style: S.th }, t.channels),
                    h('th', { style: S.th }, t.targets),
                    h('th', { style: S.th }, t.mode),
                    h('th', { style: S.th }, t.sort),
                    h('th', { style: S.th }, t.last),
                    h('th', { style: S.th }, t.actions),
                  ),
                ),
                h('tbody', null,
                  rows.map((model) => h(ModelRow, {
                    key: model.id,
                    model,
                    lang,
                    busy,
                    expanded: expanded === model.id,
                    onToggle: (id) => setExpanded(expanded === id ? null : id),
                    onProbe: probe,
                    onValidate: validate,
                    onTest: test,
                    onCfg: saveCfg,
                    t,
                  })),
                ),
              ),
            ),

        h('div', { style: { ...S.small, marginTop: 12 } }, t.probeCost),
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
          return h('div', { style: { ...S.card, ...S.error } },
            `Cline upstream panel failed: ${String(this.state.error?.message || this.state.error)}`)
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
        }, (props) => h(Boundary, null, h(Panel, props || {}))))
      },
    }
  },
})
