import type { CssLikeStyle } from "@antd-tui/components"

/** 分诊结果：一行输入被判定成哪种执行路径。 */
export type InputKind = "command" | "interactive" | "agent"

export interface Triage {
  kind: InputKind
  /** 首词（argv0） */
  command: string
  /** 首词之后的参数（仅 interactive 用得上；command 交给 sh -lc 跑整行） */
  args: string[]
  /** 原始整行 */
  raw: string
}

/** transcript 里一条记录的来源。颜色不可见时前缀标签仍保留可读语义。 */
export type ConversationKind =
  | "user"
  | "command-out"
  | "command-err"
  | "system"
  | "error"
  | "agent"

export interface ConversationEntry {
  kind: ConversationKind
  text: string
}

/** 视图栈的一层。对话为基座，交互程序压栈接管（为窗口嵌套铺路）。 */
export type ShellView =
  | { kind: "conversation" }
  | { kind: "terminal"; command: string; args: string[] }

export interface AnshellProps {
  /** 起始工作目录，默认 process.cwd() */
  cwd?: string
  /** 覆盖默认的交互式程序集合（首词命中即嵌入 anterm 接管） */
  interactiveCommands?: readonly string[]
  /**
   * 可选 agent 接入命令（argv）。配置后，分诊为 agent 的输入经 @antd-tui/acp
   * 的 AcpClient 走 prompt/stream 闭环；未配置则回一句系统提示。
   */
  agentCmd?: string[]
  /** 退出回调（Ctrl-D / exit 触发）；缺省 process.exit(0) */
  onQuit?: () => void
  style?: CssLikeStyle
}
