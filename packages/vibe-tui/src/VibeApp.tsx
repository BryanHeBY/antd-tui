import { useEffect, useMemo, useRef, useState } from "react"
import { TextAttributes } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { ConfigProvider, FocusScope, truncateToWidth, useToken } from "@antd-tui/components"
import { componentWhitelist, componentPropsWhitelist } from "@antd-tui/formily"
import { PageView, validatePageSchema, type PageSchema } from "@antd-tui/engine"
import { AcpClient } from "./acp"

/**
 * vibe-tui：完全由 agent 驱动的 TUI 操作界面。
 *
 * 布局：画板（agent 经 _vibetui/render 下发的 antd-tui 页面）+ 状态行 + 单行输入框。
 * 键盘分区：默认输入行模式（画板 FocusScope 挂起）；F2 进入页面模式把键盘交给画板，
 * Esc 返回输入行。鼠标在两种模式下都直达画板。
 * 双向通道：输入框 → session/prompt；页面事件经 $agent.send(text, payload?) 回流为 prompt。
 */
export interface VibeAppProps {
  /** agent 启动命令（argv 形式），如 ["bun", "mock-agent.ts"] */
  agentCmd: string[]
  /** 复用既有会话：经 session/load 恢复，历史回放进对话记录；此类会话退出时不删除 */
  resumeSessionId?: string
}

interface PageState {
  schema: PageSchema
  /** 每次 render 递增：整页重挂载（新 form/$state） */
  key: number
}

const LOG_LIMIT = 300

export function VibeApp({ agentCmd, resumeSessionId }: VibeAppProps) {
  const [page, setPage] = useState<PageState | null>(null)
  const [status, setStatus] = useState("agent 启动中…")
  const [log, setLog] = useState<string[]>([])
  /** 流式未完行：chunk 拼接缓冲，遇 \n 才沉淀成 log 行 */
  const [partial, setPartial] = useState("")
  const partialRef = useRef("")
  const [showLog, setShowLog] = useState(false)
  const [pageMode, setPageMode] = useState(false)
  const [input, setInput] = useState("")
  const pageKeyRef = useRef(0)

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

  const clientRef = useRef<AcpClient | null>(null)
  if (clientRef.current === null) {
    clientRef.current = new AcpClient(
      agentCmd,
      {
      onRender: (raw) => {
        const result = validatePageSchema(raw, componentWhitelist, componentPropsWhitelist)
        if (!result.ok) return { ok: false, errors: result.errors }
        pageKeyRef.current += 1
        setPage({ schema: raw as PageSchema, key: pageKeyRef.current })
        return { ok: true }
      },
      onUpdate: appendChunk,
      onTurnEnd: flushPartial,
      onExit: (code) => {
        flushPartial()
        pushLines([`agent 已退出（code ${code ?? "?"}）`])
        setStatus(`agent 已退出（code ${code ?? "?"}）`)
      },
      },
      { sessionId: resumeSessionId },
    )
  }
  const acp = clientRef.current

  useEffect(() => {
    void acp
      .start()
      .then(() =>
        setStatus(
          resumeSessionId ? "会话已恢复（F3 查看历史），继续输入 prompt" : "agent 就绪，输入 prompt 开始",
        ),
      )
      .catch((err: Error) => setStatus(`agent 启动失败：${err.message}`))
    return () => {
      void acp.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 页面 → agent 的回流通道，注入表达式作用域
  const scopeExtras = useMemo(
    () => ({
      $agent: {
        send: (text: unknown, payload?: unknown) => {
          const suffix = payload === undefined ? "" : ` ${JSON.stringify(payload)}`
          acp.prompt(`[page] ${String(text)}${suffix}`)
        },
      },
    }),
    [acp],
  )

  // 模式切换是宿主级全局键：F2 页面模式，F3 日志面板，Esc 逐层返回；
  // Ctrl+C 自行接管：先清理临时会话（session/delete）再退出
  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      void acp.stop().finally(() => process.exit(0))
    } else if (key.name === "f2") setPageMode((v) => !v)
    else if (key.name === "f3") setShowLog((v) => !v)
    else if (key.name === "escape") {
      if (showLog) setShowLog(false)
      else if (pageMode) setPageMode(false)
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
    acp.prompt(text)
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
                {page ? (
                  <PageView
                    key={page.key}
                    schema={page.schema}
                    handleEscape={false}
                    hideHint
                    onFinish={(values) => acp.prompt(`[page] submit ${JSON.stringify(values)}`)}
                    onCancel={() => acp.prompt("[page] cancel")}
                    scopeExtras={scopeExtras}
                  />
                ) : (
                  <EmptyCanvas />
                )}
              </FocusScope>
            )}
          </box>

          <StatusLine status={status} pageMode={pageMode} showLog={showLog} />
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

/**
 * 单行状态行：整行一个 text 输出（拆成多个横排 text 会因宽度计算叠字），
 * 并按终端宽度截断，避免长回复换行顶到输入框。完整内容按 F3 看对话面板。
 */
function StatusLine({
  status,
  pageMode,
  showLog,
}: {
  status: string
  pageMode: boolean
  showLog: boolean
}) {
  const token = useToken()
  const { width } = useTerminalDimensions()
  const tag = showLog ? "[对话记录 Esc 关闭]" : pageMode ? "[页面模式 Esc 返回]" : "[输入模式 F2 页面 · F3 对话]"
  const line = truncateToWidth(`${tag} ${status.replace(/\s+/g, " ")}`, Math.max(1, width - 2))
  return (
    <box style={{ flexShrink: 0, height: 1, paddingLeft: 1, paddingRight: 1, overflow: "hidden" }}>
      <text attributes={TextAttributes.BOLD} fg={token.colorTextSecondary}>
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
