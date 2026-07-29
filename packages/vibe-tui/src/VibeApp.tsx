import { useEffect, useMemo, useRef, useState } from "react"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import {
  ConfigProvider,
  FocusScope,
  componentPropsWhitelist,
  componentWhitelist,
  truncateToWidth,
  useToken,
} from "@antd-tui/components"
import { PageView, SchemaStore, validatePageSchema, type PageSchema } from "@antd-tui/engine"
import { LiveTree, LiveView } from "@antd-tui/live"
import { AcpClient } from "./acp"
import { evalInScope } from "./eval"
import { BOOT_PROMPT, SCHEMA_GUIDE } from "./knowledge"
import { startMcpCanvasServer, type McpCanvasServer } from "./mcp"

/**
 * vibe-tui：完全由 agent 驱动的 TUI 操作界面。
 *
 * 布局：画板（agent 下发的 antd-tui 页面）+ 状态行 + 单行输入框。
 * agent 驱动通道（双轨）：MCP 工具 vibetui_render/eval/snapshot/guide（通用 agent 原生可用，
 * 经 session/new 的 mcpServers 注入）；ACP 扩展 _vibetui/render（懂协议的 agent 可直调）。
 * 键盘分区：默认输入行模式（画板 FocusScope 挂起）；F2 进入页面模式把键盘交给画板，
 * Esc 返回输入行。鼠标在两种模式下都直达画板。
 * 人类 → agent：输入框 prompt；页面事件经 $agent.send(text, payload?) 回流为 "[page] ..."。
 * 会话就绪后自动注入硬编码引导（新建与恢复都注入：agent 必须知道自己身处 vibe-tui）。
 */
export interface VibeAppProps {
  /** agent 启动命令（argv 形式），如 ["bun", "mock-agent.ts"] */
  agentCmd: string[]
  /** 复用既有会话：经 session/load 恢复，历史回放进对话记录；此类会话退出时不删除 */
  resumeSessionId?: string
  /** 退出回调（Esc×2 / Ctrl+C 触发，会话清理完成后调用）；缺省 process.exit(0) */
  onQuit?: () => void
}

/**
 * 画布真相源（双通路，最后写者胜）：
 * schema = vibetui_render / $schema 代理下发的页面（PageView 渲染，key 变则重挂载）；
 * live   = $ui 活对象树（LiveView 渲染，observable 自驱，无需 key）
 */
type CanvasState = { kind: "schema"; schema: PageSchema; key: number } | { kind: "live" } | null

const LOG_LIMIT = 300

export function VibeApp({ agentCmd, resumeSessionId, onQuit }: VibeAppProps) {
  const [canvas, setCanvas] = useState<CanvasState>(null)
  const [status, setStatus] = useState("agent 启动中…")
  const [log, setLog] = useState<string[]>([])
  /** 流式未完行：chunk 拼接缓冲，遇 \n 才沉淀成 log 行 */
  const [partial, setPartial] = useState("")
  const partialRef = useRef("")
  const [showLog, setShowLog] = useState(false)
  const [pageMode, setPageMode] = useState(false)
  const [input, setInput] = useState("")
  /** agent 是否有 prompt 轮次在途（运行中/空闲指示） */
  const [busy, setBusy] = useState(false)
  const pageKeyRef = useRef(0)
  const renderer = useRenderer()

  const pushLines = (lines: string[]) => {
    const cleaned = lines.filter((l) => l.trim() !== "")
    if (cleaned.length > 0) setLog((prev) => [...prev, ...cleaned].slice(-LOG_LIMIT))
    return cleaned
  }

  /** 流式 chunk：只做拼接，完整行（含 \n）才入日志；状态行始终跟随最新文本 */
  const appendChunk = (text: string) => {
    const merged = partialRef.current + text
    const parts = merged.split("\n")
    partialRef.current = parts.pop() ?? ""
    setPartial(partialRef.current)
    const completed = pushLines(parts)
    const latest = partialRef.current.trim() || completed.at(-1)
    if (latest) setStatus(latest)
  }

  /** 轮次结束/中断：把未完行冲刷成正式日志行 */
  const flushPartial = () => {
    const rest = partialRef.current.trim()
    partialRef.current = ""
    setPartial("")
    if (rest) pushLines([rest])
  }

  /** 渲染入口（vibetui_render / ACP 扩展）：全量换页语义——重挂载、状态重置 */
  const renderSchema = (raw: unknown): { ok: boolean; errors?: string[] } => {
    const store = storeRef.current!
    const result = store.replace(raw)
    if (!result.ok) return result
    pageKeyRef.current += 1
    setCanvas({
      kind: "schema",
      schema: store.current() as unknown as PageSchema,
      key: pageKeyRef.current,
    })
    return { ok: true }
  }

  // Schema REPL 存储：$schema 代理的每次合法修改经 onChange 热更上屏
  // （同 key 重渲染不重挂载，表单值/$state 保留——"一点一点搭页面"）
  const storeRef = useRef<SchemaStore | null>(null)
  if (storeRef.current === null) {
    storeRef.current = new SchemaStore({
      validate: (schema) =>
        validatePageSchema(schema, componentWhitelist, componentPropsWhitelist),
      onChange: (schema) => {
        // schema 通路成为最后写者：清掉活树（含 watch），画布落回 schema
        liveRef.current?.ui.clear()
        const next = schema as unknown as PageSchema
        setCanvas((prev) =>
          prev?.kind === "schema"
            ? { kind: "schema", schema: next, key: prev.key }
            : { kind: "schema", schema: next, key: ++pageKeyRef.current },
        )
      },
    })
  }

  // $ui 活对象树：真 JS 对象 + 真函数的 REPL 真相源；合法变更即把画布切到 live
  const liveRef = useRef<LiveTree | null>(null)
  if (liveRef.current === null) {
    liveRef.current = new LiveTree({
      onMutate: () => setCanvas((prev) => (prev?.kind === "live" ? prev : { kind: "live" })),
    })
  }

  // 活页面桥：eval 需要当前页编译后的表达式作用域（PageView 每次挂载回传）
  const scopeRef = useRef<Record<string, unknown>>({})

  const clientRef = useRef<AcpClient | null>(null)

  // 页面 → agent 的回流通道：schema 页经 scopeExtras 注入表达式作用域；
  // live 页的 handler 是真函数，在 eval 作用域里直接闭包捕获 $agent
  const scopeExtras = useMemo(
    () => ({
      $agent: {
        send: (text: unknown, payload?: unknown) => {
          const suffix = payload === undefined ? "" : ` ${JSON.stringify(payload)}`
          clientRef.current?.prompt(`[page] ${String(text)}${suffix}`)
        },
      },
    }),
    [],
  )

  useEffect(() => {
    let mcp: McpCanvasServer | null = null
    const boot = async () => {
      mcp = await startMcpCanvasServer({
        render: renderSchema,
        // $ui：活对象树（真函数，推荐）；$schema：schema 草稿深代理。
        // $agent 必须独立注入——live 模式没有 PageView 回传的作用域
        evaluate: (code) =>
          evalInScope(code, {
            $ui: liveRef.current!.ui,
            $schema: storeRef.current!.proxy(),
            ...scopeRef.current,
            ...scopeExtras,
          }),
        snapshot: () => {
          const buffer = renderer?.currentRenderBuffer
          if (!buffer) throw new Error("画布尚未就绪")
          return new TextDecoder().decode(buffer.getRealCharBytes(true))
        },
        guide: () => SCHEMA_GUIDE,
      })
      const client = new AcpClient(
        agentCmd,
        {
          onRender: renderSchema,
          onUpdate: appendChunk,
          onTurnEnd: flushPartial,
          onBusy: setBusy,
          onExit: (code) => {
            flushPartial()
            pushLines([`agent 已退出（code ${code ?? "?"}）`])
            setStatus(`agent 已退出（code ${code ?? "?"}）`)
          },
        },
        {
          sessionId: resumeSessionId,
          mcpServers: [{ type: "http", name: "vibetui", url: mcp.url, headers: [] }],
        },
      )
      clientRef.current = client
      await client.start()
      setStatus(
        resumeSessionId ? "会话已恢复（F3 查看历史），引导注入中…" : "agent 就绪，引导注入中…",
      )
      // 硬编码引导：新建与恢复都注入——agent 必须知道自己身处 vibe-tui 并主动画初始界面
      pushLines(["[已注入 vibe-tui 引导]"])
      client.prompt(BOOT_PROMPT)
    }
    void boot().catch((err: Error) => setStatus(`agent 启动失败：${err.message}`))
    return () => {
      void clientRef.current?.stop()
      mcp?.close()
      liveRef.current?.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 模式切换是宿主级全局键：F2 页面模式，F3 日志面板；
  // Esc 逐层返回（日志面板 → 页面模式 → 顶层双击退出）；
  // 退出（Esc×2 / Ctrl+C）先清理临时会话（session/delete）再走 onQuit
  const lastEscRef = useRef(0)
  const quit = () => {
    const done = onQuit ?? (() => process.exit(0))
    const client = clientRef.current
    if (client) void client.stop().finally(done)
    else done()
  }

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      quit()
    } else if (key.name === "f2") setPageMode((v) => !v)
    else if (key.name === "f3") setShowLog((v) => !v)
    else if (key.name === "escape") {
      if (showLog) setShowLog(false)
      else if (pageMode) setPageMode(false)
      else {
        // 顶层 Esc：双击确认退出，防止误触丢会话
        const now = Date.now()
        if (now - lastEscRef.current < 2000) quit()
        else {
          lastEscRef.current = now
          setStatus("再按一次 Esc 退出 vibe-tui")
        }
      }
    }
  })

  const submitPrompt = () => {
    const text = input.trim()
    if (text === "") return
    setInput("")
    // 我方发言也入对话记录，未完的 agent 流式行先冲刷
    flushPartial()
    pushLines([`> ${text}`])
    setStatus(`> ${text}`)
    clientRef.current?.prompt(text)
  }

  return (
    <ConfigProvider>
      <FocusScope>
        <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
          {/* 画板：agent 下发的页面；输入行模式下挂起（键盘静默，鼠标仍可用）。
              F3 切换为日志面板查看 agent 完整回复 */}
          <box style={{ flexGrow: 1, flexShrink: 1, flexDirection: "column" }}>
            {showLog ? (
              <LogPanel log={log} partial={partial} />
            ) : (
              <FocusScope suspended={!pageMode}>
                {canvas?.kind === "live" ? (
                  <LiveView tree={liveRef.current!} handleEscape={false} hideHint />
                ) : canvas ? (
                  <PageView
                    key={canvas.key}
                    schema={canvas.schema}
                    handleEscape={false}
                    hideHint
                    onFinish={(values) =>
                      clientRef.current?.prompt(`[page] submit ${JSON.stringify(values)}`)
                    }
                    onCancel={() => clientRef.current?.prompt("[page] cancel")}
                    onScopeReady={(scope) => {
                      scopeRef.current = scope
                    }}
                    scopeExtras={scopeExtras}
                  />
                ) : (
                  <EmptyCanvas />
                )}
              </FocusScope>
            )}
          </box>

          <StatusLine status={status} pageMode={pageMode} showLog={showLog} busy={busy} />
          <InputLine value={input} onChange={setInput} onSubmit={submitPrompt} active={!pageMode} />
        </box>
      </FocusScope>
    </ConfigProvider>
  )
}

function EmptyCanvas() {
  const token = useToken()
  return (
    <box style={{ flexGrow: 1, alignItems: "center", justifyContent: "center" }}>
      <text attributes={TextAttributes.BOLD} fg={token.colorTextSecondary}>
        画板空白 —— 在下方输入 prompt，由 agent 生成界面
      </text>
    </box>
  )
}

/** 滚动对话面板：agent 的完整回复按行留存（含流式未完行），F3/Esc 关闭 */
function LogPanel({ log, partial }: { log: string[]; partial: string }) {
  const token = useToken()
  const empty = log.length === 0 && partial.trim() === ""
  return (
    <box
      border
      style={{
        flexGrow: 1,
        flexDirection: "column",
        borderStyle: token.borderStyle,
        borderColor: token.colorBorder,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title="对话记录（F3/Esc 关闭 · 滚轮滚动）"
    >
      <scrollbox
        style={{ flexGrow: 1 }}
        scrollY
        scrollX={false}
        stickyScroll
        stickyStart="bottom"
        contentOptions={{ flexDirection: "column" }}
      >
        {empty ? (
          <text attributes={TextAttributes.BOLD} fg={token.colorTextSecondary}>
            暂无对话
          </text>
        ) : (
          <>
            {log.map((line, i) => (
              <text key={i} attributes={TextAttributes.BOLD} fg={token.colorText}>
                {line}
              </text>
            ))}
            {partial.trim() !== "" ? (
              <text attributes={TextAttributes.BOLD} fg={token.colorTextSecondary}>
                {partial}
              </text>
            ) : null}
          </>
        )}
      </scrollbox>
    </box>
  )
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/**
 * 单行状态行：整行一个 text 输出（拆成多个横排 text 会因宽度计算叠字），
 * 并按终端宽度截断，避免长回复换行顶到输入框。完整内容按 F3 看对话面板。
 * 最左侧是 agent 运行指示：转轮 = prompt 轮次在途，· = 空闲。
 */
function StatusLine({
  status,
  pageMode,
  showLog,
  busy,
}: {
  status: string
  pageMode: boolean
  showLog: boolean
  busy: boolean
}) {
  const token = useToken()
  const { width } = useTerminalDimensions()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => setTick((v) => v + 1), 120)
    return () => clearInterval(timer)
  }, [busy])

  const indicator = busy ? `${SPINNER_FRAMES[tick % SPINNER_FRAMES.length]} 运行中` : "· 空闲"
  const tag = showLog
    ? "[对话记录 Esc 关闭]"
    : pageMode
      ? "[页面模式 Esc 返回]"
      : "[输入模式 F2 页面 · F3 对话 · Esc×2 退出]"
  const line = truncateToWidth(
    `${indicator} ${tag} ${status.replace(/\s+/g, " ")}`,
    Math.max(1, width - 2),
  )
  return (
    <box style={{ flexShrink: 0, height: 1, paddingLeft: 1, paddingRight: 1, overflow: "hidden" }}>
      <text
        attributes={TextAttributes.BOLD}
        fg={busy ? token.colorPrimaryHover : token.colorTextSecondary}
      >
        {line}
      </text>
    </box>
  )
}

function InputLine({
  value,
  onChange,
  onSubmit,
  active,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  active: boolean
}) {
  const token = useToken()
  return (
    <box
      border
      style={{
        flexShrink: 0,
        height: 3,
        borderStyle: token.borderStyle,
        borderColor: active ? token.colorPrimaryHover : token.colorBorder,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <input
        value={value}
        placeholder="输入 prompt，Enter 发送"
        focused={active}
        onInput={onChange}
        onSubmit={onSubmit}
        style={{ flexGrow: 1 }}
      />
    </box>
  )
}
