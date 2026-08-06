import type { CssLikeStyle } from "@antd-tui/components"
import type { StyledText } from "@opentui/core"
import type { AntermSession } from "@antd-tui/anterm"

/** 分诊结果：一行输入被判定成 shell 还是 agent。 */
export type InputKind = "command" | "agent"

export interface Triage {
  kind: InputKind
  /** 首词（argv0） */
  command: string
  /** 首词之后的参数 */
  args: string[]
  /** 原始整行 */
  raw: string
}

/** 流式历史的一个块。终端/agent 渲染成卡片，note 是纯行。 */
export type Block =
  | {
      id: number
      kind: "shell"
      /** 提交的整行命令，作为卡片头 */
      label: string
      cwd: string
      state: "running" | "exited"
      exitCode?: number
      /** 用户显式要求以浮层起跑（Ctrl+O / overlayCommands） */
      requestedOverlay: boolean
      /** 退出后的不可变输出快照；运行中为空（由 RunningShellCard 每帧派生） */
      lines?: StyledText[]
      /** 区间不可靠（整屏重画 / 标记被裁 / 没等到 C），呈现降级 */
      degraded?: boolean
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
      rows: CommandRow[]
    }
  | { id: number; kind: "note"; level: "system" | "error"; text: string }

/**
 * 斜杠命令结果的一行。拆成「标记 + 主体 + 参数提示 + 说明」而不是一整串文本，
 * 卡片才能给命令名/会话 id 上色——纯字符串只能靠猜边界。
 */
export interface CommandRow {
  /** 行首标记，如当前项的 ▸ 或审计流水的 #1；对齐用，非当前项传空格 */
  marker?: string
  /** 主体：命令名、会话 id、模式 id 等，高亮 */
  primary: string
  /** 参数提示（/help 里的 hint），dim */
  hint?: string
  /** 说明，正文色 */
  detail?: string
  /** 行尾备注，如 · agent */
  note?: string
  /** 当前项：主体用强调色 */
  current?: boolean
  tone?: "default" | "error"
}

/** 命令进入 alternate screen（或被要求浮层起跑）时，浮层接管的共享 shell 会话。 */
export interface PromotedTerminal {
  id: number
  label: string
  cwd: string
  session: AntermSession
}

export interface AnshellProps {
  /** 起始工作目录，默认 process.cwd() */
  cwd?: string
  /** 执行用的 Shell；默认 $SHELL。仅支持 bash/zsh，其余在 CLI 层报错。 */
  shell?: string
  /** shell 初始化：user 先 source 用户配置；minimal 干净环境（测试用）。默认 user。 */
  shellInit?: "user" | "minimal"
  /** 显式浮层命令集合（首词命中 → 以浮层起跑）；默认空，通常交给 alternate-screen 自动检测。 */
  overlayCommands?: readonly string[]
  /**
   * 可选 agent 接入命令（argv）。配置后，分诊为 agent 的输入经 @antd-tui/acp
   * 的 AcpClient 走 prompt/stream 闭环；未配置则回一句系统提示。
   */
  agentCmd?: string[]
  /** 退出回调（Ctrl-D / exit 触发）；缺省 process.exit(0) */
  onQuit?: () => void
  style?: CssLikeStyle
}
