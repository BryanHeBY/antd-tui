import type { CssLikeStyle } from "@antd-tui/components"
import type { AntermSession } from "@antd-tui/anterm"

/** 分诊结果：一行输入被判定成哪种执行路径。 */
export type InputKind = "command" | "interactive" | "agent"

/** interactive 的呈现面：inline 内嵌流内活终端卡片；overlay 弹窗/全屏浮层。 */
export type InteractiveSurface = "inline" | "overlay"

export interface Triage {
  kind: InputKind
  /** 首词（argv0） */
  command: string
  /** 首词之后的参数（interactive 用得上；command 交给配置的 Shell 跑整行） */
  args: string[]
  /** 原始整行 */
  raw: string
  /** 仅 kind==="interactive" 时有意义 */
  surface?: InteractiveSurface
}

/** 流式历史的一个块。终端/agent 渲染成卡片，note 是纯行。 */
export type Block =
  | {
      id: number
      kind: "terminal"
      command: string
      args: string[]
      label: string
      cwd: string
      prompt: "shell" | "terminal"
      /** 用户显式要求浮层运行（Ctrl+O / overlayCommands）：不等 alternate screen 就提升。 */
      fullscreen: boolean
      state: "running" | "exited"
      exitCode?: number
    }
  | { id: number; kind: "prompt"; text: string; cwd: string }
  | { id: number; kind: "agent"; text: string }
  | {
      id: number
      kind: "tool"
      toolCallId: string
      title: string
      /** ACP ToolKind；缺省按 other 呈现 */
      toolKind?: string
      status: "pending" | "in_progress" | "completed" | "failed"
      /** 工具输出的文本摘要（content 为整体替换语义，这里也整体替换） */
      lines: string[]
    }
  | {
      id: number
      kind: "permission"
      toolCallId: string
      title: string
      options: Array<{ optionId: string; name: string; kind: string }>
      state: "pending" | "decided"
      /** 已决策时的选项名 */
      chosen?: string
      /** true = 命中记忆策略自动决定 */
      auto?: boolean
    }
  | {
      id: number
      kind: "command"
      /** 不带斜杠的命令名 */
      name: string
      /** 命令名之后的原始参数 */
      input: string
      cwd: string
      lines: string[]
    }
  | { id: number; kind: "note"; level: "system" | "error"; text: string }

/** 流内 PTY 被提升为浮层视图后，浮层接管的同一终端会话。 */
export interface PromotedTerminal {
  id: number
  label: string
  command: string
  args: string[]
  cwd: string
  session: AntermSession
}

export interface AnshellProps {
  /** 起始工作目录，默认 process.cwd() */
  cwd?: string
  /** 执行与语法检查使用的 Shell；默认 $SHELL，缺省时回退 /bin/sh。 */
  shell?: string
  /** 显式浮层命令集合（首词命中 → 弹窗/全屏）；默认空，通常交给 alternate-screen 自动检测。 */
  overlayCommands?: readonly string[]
  /** 内嵌流内活终端卡片的交互命令集合（首词命中 → inline 卡片）。默认空，按需配置（如 ["fzf"]） */
  inlineCommands?: readonly string[]
  /**
   * 可选 agent 接入命令（argv）。配置后，分诊为 agent 的输入经 @antd-tui/acp
   * 的 AcpClient 走 prompt/stream 闭环；未配置则回一句系统提示。
   */
  agentCmd?: string[]
  /** 退出回调（Ctrl-D / exit 触发）；缺省 process.exit(0) */
  onQuit?: () => void
  style?: CssLikeStyle
}
