import { useEffect, useMemo, useRef, useState } from "react"
import { BoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { ConfigProvider, FocusScope, Input, truncateToWidth, useToken } from "@antd-tui/components"
import { LiveTree, LiveView } from "@antd-tui/live"
import { AcpClient } from "@antd-tui/acp"
import { PiAgent, runNativeCommand, type AgentBackend } from "@antd-tui/pi-agent"
import type { Models } from "@earendil-works/pi-ai"
import { createEvalRepl } from "./eval"
import { BOOT_PROMPT, EXAMPLE_REFERENCE, LIVE_GUIDE } from "./knowledge"
import { startMcpCanvasServer, type CanvasBridge, type McpCanvasServer } from "./mcp"
import { nativeCanvasTools } from "./canvas-tools"
import { webTools } from "./web-tools"
import { startMcpToolServer, toAgentTools } from "@antd-tui/pi-agent"
import { createPageSnapshotRenderer, type PageSnapshotRenderer } from "./page-snapshot"

/**
 * vibe-tui：完全由 agent 驱动的 TUI 操作界面。
 *
 * 布局：画板（agent 用 $ui 活对象树搭的页面）+ 状态行 + 单行输入框。
 * agent 驱动通道：MCP 工具 vibetui_eval/snapshot/guide（经 session/new 的 mcpServers 注入）。
 * vibetui_eval 在 $ui 活组件树上执行真 JS，组件/props/监听每步即时上屏。
 * 键盘分区：默认输入行模式（画板 FocusScope 挂起）；Tab 循环切换 输入 → 页面（键盘交给画板）→
 * 对话面板 → 输入（macOS 的 F 键默认是媒体键，单一 Tab 跨平台可靠；F2/F3 仍是静默别名）。
 * 鼠标在所有模式下都直达画板。
 * 人类 → agent：输入框 prompt；页面事件经 $agent.send(text, payload?) 回流为 "[page] ..."。
 * 会话就绪后自动注入硬编码引导（新建与恢复都注入：agent 必须知道自己身处 vibe-tui）。
 */
export type { AgentBackend }
export interface VibeAppProps {
  /** agent 后端：ACP 命令（argv 形式）或 pi 原生后端 */
  agent: AgentBackend
  /** 复用既有会话：经 session/load 恢复，历史回放进对话记录；此类会话退出时不删除（仅 ACP 后端） */
  resumeSessionId?: string
  /** 退出回调（Esc×2 / Ctrl+C 触发，会话清理完成后调用）；缺省 process.exit(0) */
  onQuit?: () => void
  /** 测试注入：pi 后端的 Models（faux provider）；生产路径留空走默认 provider 集 */
  piModels?: Models
}

const LOG_LIMIT = 300
type ConversationKind = "agent" | "user" | "page" | "system" | "error"

interface ConversationEntry {
  kind: ConversationKind
  text: string
}

export function VibeApp({ agent, resumeSessionId, onQuit, piModels }: VibeAppProps) {
  /** 画布是否已有内容：首次 $ui 变更后置真，之前显示空画板提示 */
  const [hasCanvas, setHasCanvas] = useState(false)
  const [status, setStatus] = useState("agent 启动中…")
  const [log, setLog] = useState<ConversationEntry[]>([])
  /** 流式未完行：chunk 拼接缓冲，遇 \n 才沉淀成 log 行 */
  const [partial, setPartial] = useState<ConversationEntry | null>(null)
  const partialRef = useRef<ConversationEntry | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [pageMode, setPageMode] = useState(false)
  const [input, setInput] = useState("")
  /** agent 是否有 prompt 轮次在途（运行中/空闲指示） */
  const [busy, setBusy] = useState(false)
  const renderer = useRenderer()
  const canvasPaneRef = useRef<BoxRenderable | null>(null)
  const snapshotRendererRef = useRef<PageSnapshotRenderer | null>(null)

  const pushLines = (kind: ConversationKind, lines: string[]) => {
    const cleaned = lines.filter((l) => l.trim() !== "")
    if (cleaned.length > 0) {
      setLog((prev) => [...prev, ...cleaned.map((text) => ({ kind, text }))].slice(-LOG_LIMIT))
    }
    return cleaned
  }

  /** 流式 chunk：只做拼接，完整行（含 \n）才入日志；状态行始终跟随最新文本 */
  const appendChunk = (text: string, kind: "agent" | "system" = "agent") => {
    // 不同来源不能混进同一个未完行：例如自动授权恰好插在 agent 流式回复中间。
    if (partialRef.current && partialRef.current.kind !== kind) flushPartial()
    const merged = (partialRef.current?.text ?? "") + text
    const parts = merged.split("\n")
    const rest = parts.pop() ?? ""
    partialRef.current = rest === "" ? null : { kind, text: rest }
    setPartial(partialRef.current)
    const completed = pushLines(kind, parts)
    const latest = rest.trim() || completed.at(-1)
    if (latest) setStatus(latest)
  }

  /** 轮次结束/中断：把未完行冲刷成正式日志行 */
  const flushPartial = () => {
    const partialEntry = partialRef.current
    const rest = partialEntry?.text.trim() ?? ""
    partialRef.current = null
    setPartial(null)
    if (rest && partialEntry) pushLines(partialEntry.kind, [rest])
  }

  /** 非流式消息需先收束此前 agent chunk，保证对话列表的时间顺序。 */
  const appendMessage = (kind: ConversationKind, text: string) => {
    flushPartial()
    pushLines(kind, [text])
    setStatus(text)
  }

  // vibetui_dispatch 演练深度：>0 表示当前正由 agent 主动触发回调做自测。
  // 演练期间抑制一切 ACP 回流（$agent.send 与 onCallbackError），否则 agent 每验证
  // 一个 tuiOnClick/回调就会被自己的 $agent.send 或抛错回灌一条 [page] prompt，
  // 造成“自测即自我 prompt 轰炸”。演练结果已由 dispatch 工具的返回值/异常同步回传。
  const dispatchDepthRef = useRef(0)

  // $ui 活对象树：唯一的画布真相源。合法变更即把画板标记为有内容（渲染由 observable 自驱）
  // agent 回调抛错（如 tuiOnClick 里 get 了不存在的节点）由框架兜住：
  // 记入对话、提示状态行，并以 [page] error 回流给 agent 让它自行修正
  const liveRef = useRef<LiveTree | null>(null)
  if (liveRef.current === null) {
    liveRef.current = new LiveTree({
      onMutate: () => setHasCanvas(true),
      onCallbackError: (error, context) => {
        const detail = (error as Error).message ?? String(error)
        // 演练触发的回调抛错：只记对话，不再回流（dispatch 会把同一错误作为工具异常返回）
        if (dispatchDepthRef.current > 0) {
          appendMessage("error", `[dispatch 演练] 回调出错（${context}）：${detail}`)
          return
        }
        appendMessage("error", `页面回调出错（${context}）：${detail}`)
        clientRef.current?.prompt(`[page] error ${context}: ${detail}`)
      },
    })
  }

  const clientRef = useRef<AcpClient | PiAgent | null>(null)

  // 页面 → agent 的回流通道：$ui 的 handler 是真函数，在 eval 作用域里直接闭包捕获 $agent
  const scopeExtras = useMemo(
    () => ({
      $agent: {
        send: (text: unknown, payload?: unknown) => {
          const suffix = payload === undefined ? "" : ` ${JSON.stringify(payload)}`
          const message = `${String(text)}${suffix}`
          // 演练触发的 $agent.send：只记对话、不回流，避免 agent 自测时给自己灌 [page] prompt
          if (dispatchDepthRef.current > 0) {
            appendMessage("system", `[dispatch 演练] $agent.send：${message}（未回流）`)
            return
          }
          appendMessage("page", message)
          clientRef.current?.prompt(`[page] ${message}`)
        },
      },
    }),
    [],
  )

  // 一个 Vibe 会话对应一个 JS REPL。不要放进 MCP 请求处理器里重建，否则
  // agent 在前一次 eval 声明的 helpers、actions 与闭包会在下一次调用丢失。
  const replRef = useRef<ReturnType<typeof createEvalRepl> | null>(null)
  if (replRef.current === null) {
    replRef.current = createEvalRepl({ $ui: liveRef.current.ui, ...scopeExtras })
  }

  /** 读主渲染器完整帧：仅供 host snapshot，故意保留日志层/状态栏/输入框。 */
  const captureHostFrame = () => {
    const buffer = renderer?.currentRenderBuffer
    if (!buffer) throw new Error("画布尚未就绪")
    return new TextDecoder().decode(buffer.getRealCharBytes(true))
  }

  /**
   * 使用独立内存 renderer 截取 $ui 页面。不要从主帧裁剪：主帧可能正显示 F3 日志层，
   * 并且裁剪不能保证 React 已把最新 LiveTree 变更写入当前渲染缓冲。
   */
  const capturePageFrame = async () => {
    const pane = canvasPaneRef.current
    if (!pane) throw new Error("页面画板尚未就绪")
    const snapshotRenderer = snapshotRendererRef.current
    if (!snapshotRenderer) throw new Error("页面快照渲染器尚未就绪")
    return snapshotRenderer.capture(pane.width, pane.height)
  }

  useEffect(() => {
    let mcp: McpCanvasServer | null = null
    const boot = async () => {
      snapshotRendererRef.current = await createPageSnapshotRenderer(liveRef.current!)
      // 画布桥是唯一事实源：MCP（ACP 后端）与原生工具（pi 后端）都只做注册面
      const bridge: CanvasBridge = {
        // $ui/$agent 是会话级 REPL 的宿主入口；顶层变量和闭包跨 eval 保留。
        evaluate: (code) => replRef.current!.evaluate(code),
        snapshot: capturePageFrame,
        hostSnapshot: captureHostFrame,
        guide: () => LIVE_GUIDE,
        example: () => EXAMPLE_REFERENCE,
        layout: () => {
          const pane = canvasPaneRef.current
          return liveRef.current!.inspectLayout(
            pane ? { width: pane.width, height: pane.height } : undefined,
          )
        },
        inspect: (id) => liveRef.current!.inspect(id),
        reset: () => {
          liveRef.current!.clear()
          replRef.current!.reset()
          setHasCanvas(false)
          return { cleared: true, scopeReset: true }
        },
        dispatch: (id, event, value) => {
          // 标记演练区间：期间 $agent.send / onCallbackError 只记对话不回流
          dispatchDepthRef.current += 1
          try {
            return liveRef.current!.dispatch(id, event, value)
          } finally {
            dispatchDepthRef.current -= 1
          }
        },
      }
      const handlers = {
        onUpdate: appendChunk,
        onTurnEnd: flushPartial,
        onBusy: setBusy,
        onExit: (code: number | null) => {
          flushPartial()
          appendMessage("system", `agent 已退出（code ${code ?? "?"}）`)
        },
      }
      const web = webTools()
      if (agent.kind === "pi") {
        // 原生后端：画布工具进程内直调，不起 MCP HTTP，会话全内存
        const pi = new PiAgent({
          spec: agent.runtime?.spec ?? agent.spec,
          thinkingLevel: agent.runtime?.thinkingLevel,
          systemPrompt:
            "你是 vibe-tui 的界面 agent：用 vibetui_* 工具在 $ui 活对象树上生成、操作终端界面；需要外部信息时用 web_search / web_read 搜索并阅读网页；[page] 前缀的消息是页面事件回流。",
          tools: [...nativeCanvasTools(bridge), ...toAgentTools(web)],
          handlers,
          models: piModels ?? agent.runtime?.models,
        })
        clientRef.current = pi
        await pi.start()
      } else {
        const canvasMcp = await startMcpCanvasServer(bridge)
        const webMcp = await startMcpToolServer("vibetui-web", web)
        const client = new AcpClient(
          agent.cmd,
          handlers,
          {
            sessionId: resumeSessionId,
            mcpServers: [
              { type: "http", name: "vibetui", url: canvasMcp.url, headers: [] },
              { type: "http", name: "vibetui-web", url: webMcp.url, headers: [] },
            ],
          },
        )
        clientRef.current = client
        await client.start()
        mcp = { url: canvasMcp.url, close: () => { canvasMcp.close(); webMcp.close() } }
      }
      setStatus(
        resumeSessionId ? "会话已恢复（F3 查看历史），引导注入中…" : "agent 就绪，引导注入中…",
      )
      // 硬编码引导：新建与恢复都注入——agent 必须知道自己身处 vibe-tui 并主动画初始界面
      appendMessage("system", "[已注入 vibe-tui 引导]")
      clientRef.current!.prompt(BOOT_PROMPT)
    }
    void boot().catch((err: Error) => setStatus(`agent 启动失败：${err.message}`))
    return () => {
      void clientRef.current?.stop()
      mcp?.close()
      snapshotRendererRef.current?.destroy()
      snapshotRendererRef.current = null
      liveRef.current?.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 模式切换是宿主级全局键：Tab 三态循环（输入 → 页面 → 对话 → 输入），F2/F3 为静默别名；
  // Esc 逐层返回（对话面板 → 输入 · 页面模式 → 输入 · 顶层双击退出）；
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
    } else if (key.name === "tab") {
      // Tab 三态循环：输入 → 页面 → 对话 → 输入。macOS 的 F 键默认是媒体键，
      // 单一 Tab 跨平台可靠；画布 FocusScope 以 tabNavigable=false 让出 Tab
      //（画布内用鼠标/方向键导航）。
      key.stopPropagation()
      if (showLog) {
        setShowLog(false)
      } else if (pageMode) {
        setPageMode(false)
        setShowLog(true)
      } else {
        setPageMode(true)
      }
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
    // pi 原生 slash 命令在本地消化（/model /effort /reset），不发给模型；
    // 其余 / 开头输入照常当 prompt——画布 agent 也许自己定义了约定
    const client = clientRef.current
    if (text.startsWith("/") && client instanceof PiAgent) {
      const [name, ...rest] = text.slice(1).split(/\s+/)
      const native = runNativeCommand(client, name ?? "", rest.join(" "))
      if (native) {
        // 逐行入对话：一行一个条目，F3 面板里每行独立成行
        for (const line of native.lines) appendMessage(native.ok ? "system" : "error", line)
        setStatus(native.lines[native.lines.length - 1] ?? "")
        return
      }
    }
    // 我方发言也入对话记录，未完的 agent 流式行先冲刷
    flushPartial()
    appendMessage("user", text)
    clientRef.current?.prompt(text)
  }

  return (
    <ConfigProvider>
      <FocusScope>
        <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
          {/* 画板：agent 用 $ui 搭的页面；输入行模式下挂起（键盘静默，鼠标仍可用）。
              F3 切换为日志面板查看 agent 完整回复 */}
          <box ref={canvasPaneRef} style={{ flexGrow: 1, flexShrink: 1, flexDirection: "column" }}>
            {showLog ? (
              <LogPanel log={log} partial={partial} />
            ) : (
              <FocusScope suspended={!pageMode} tabNavigable={false}>
                {hasCanvas ? (
                  <LiveView tree={liveRef.current!} handleEscape={false} hideHint />
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
      <text attributes={0} fg={token.colorTextSecondary}>
        画板空白 —— 在下方输入 prompt，由 agent 生成界面
      </text>
    </box>
  )
}

/** 滚动对话面板：agent 的完整回复按行留存（含流式未完行），F3/Esc 关闭 */
function LogPanel({ log, partial }: { log: ConversationEntry[]; partial: ConversationEntry | null }) {
  const token = useToken()
  const empty = log.length === 0 && partial === null
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
      title="对话记录（Esc 关闭 · 滚轮滚动）"
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
          <text attributes={0} fg={token.colorTextSecondary}>
            暂无对话
          </text>
        ) : (
          <>
            {log.map((entry, i) => (
              <ConversationLine key={i} entry={entry} />
            ))}
            {partial ? <ConversationLine entry={partial} /> : null}
          </>
        )}
      </scrollbox>
    </box>
  )
}

/** 角色前缀与颜色同时表达来源；颜色不可见时，纯字符快照仍保留可读语义。 */
function ConversationLine({ entry }: { entry: ConversationEntry }) {
  const token = useToken()
  const presentation: Record<ConversationKind, { label: string; color: string }> = {
    user: { label: "你", color: token.colorPrimaryHover },
    agent: { label: "Agent", color: token.colorWarning },
    page: { label: "页面", color: token.colorSuccess },
    system: { label: "系统", color: token.colorTextSecondary },
    error: { label: "错误", color: token.colorError },
  }
  const { label, color } = presentation[entry.kind]
  return (
    <text attributes={0} fg={color}>
      {`${label} › ${entry.text}`}
    </text>
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
      ? "[页面模式 Tab 对话 · Esc 返回]"
      : "[输入模式 Tab 页面 · Esc×2 退出]"
  const line = truncateToWidth(
    `${indicator} ${tag} ${status.replace(/\s+/g, " ")}`,
    Math.max(1, width - 2),
  )
  return (
    <box style={{ flexShrink: 0, height: 1, paddingLeft: 1, paddingRight: 1, overflow: "hidden" }}>
      <text
        attributes={0}
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
  return (
    <FocusScope suspended={!active}>
      <box style={{ flexShrink: 0, width: "100%" }}>
        <Input
          value={value}
          placeholder="输入 prompt，Enter 发送"
          tuiOnChange={onChange}
          tuiOnPressEnter={onSubmit}
        />
      </box>
    </FocusScope>
  )
}
