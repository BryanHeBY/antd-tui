import { useEffect, useMemo, useRef, useState } from "react"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { ConfigProvider, FocusScope, useToken } from "@antd-tui/components"
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
}

interface PageState {
  schema: PageSchema
  /** 每次 render 递增：整页重挂载（新 form/$state） */
  key: number
}

export function VibeApp({ agentCmd }: VibeAppProps) {
  const [page, setPage] = useState<PageState | null>(null)
  const [status, setStatus] = useState("agent 启动中…")
  const [pageMode, setPageMode] = useState(false)
  const [input, setInput] = useState("")
  const pageKeyRef = useRef(0)

  const clientRef = useRef<AcpClient | null>(null)
  if (clientRef.current === null) {
    clientRef.current = new AcpClient(agentCmd, {
      onRender: (raw) => {
        const result = validatePageSchema(raw, componentWhitelist, componentPropsWhitelist)
        if (!result.ok) return { ok: false, errors: result.errors }
        pageKeyRef.current += 1
        setPage({ schema: raw as PageSchema, key: pageKeyRef.current })
        return { ok: true }
      },
      onUpdate: (text) => {
        // 状态行只保留最后一行非空文本
        const line = text.split("\n").filter(Boolean).at(-1)
        if (line) setStatus(line)
      },
      onExit: (code) => setStatus(`agent 已退出（code ${code ?? "?"}）`),
    })
  }
  const acp = clientRef.current

  useEffect(() => {
    void acp
      .start()
      .then(() => setStatus("agent 就绪，输入 prompt 开始"))
      .catch((err: Error) => setStatus(`agent 启动失败：${err.message}`))
    return () => acp.stop()
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

  // 模式切换是宿主级全局键：F2 进页面模式，Esc 回输入行（不做作用域圈闭判断）
  useKeyboard((key) => {
    if (key.name === "f2") setPageMode((v) => !v)
    else if (key.name === "escape" && pageMode) setPageMode(false)
  })

  const submitPrompt = () => {
    const text = input.trim()
    if (text === "") return
    setInput("")
    setStatus(`> ${text}`)
    acp.prompt(text)
  }

  return (
    <ConfigProvider>
      <FocusScope>
        <box style={{ flexDirection: "column", width: "100%", height: "100%" }}>
          {/* 画板：agent 下发的页面；输入行模式下挂起（键盘静默，鼠标仍可用） */}
          <box style={{ flexGrow: 1, flexShrink: 1, flexDirection: "column" }}>
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
          </box>

          <StatusLine status={status} pageMode={pageMode} />
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

function StatusLine({ status, pageMode }: { status: string; pageMode: boolean }) {
  const token = useToken()
  return (
    <box style={{ flexShrink: 0, minHeight: 1, flexDirection: "row", paddingLeft: 1, paddingRight: 1 }}>
      <text attributes={TextAttributes.BOLD} fg={token.colorPrimaryHover}>
        {pageMode ? "[页面模式 Esc 返回] " : "[输入模式 F2 进页面] "}
      </text>
      <text attributes={TextAttributes.BOLD} fg={token.colorTextSecondary}>
        {status}
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
