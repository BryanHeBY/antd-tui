import type { Triage } from "./types"

/**
 * 默认走浮层（弹窗/全屏）的交互式程序：shell/REPL 或全屏 TUI，piped stdout 无意义。
 */
export const DEFAULT_OVERLAY_COMMANDS: readonly string[] = [
  "bash",
  "zsh",
  "sh",
  "fish",
  "dash",
  "vim",
  "nvim",
  "vi",
  "nano",
  "emacs",
  "htop",
  "top",
  "btop",
  "less",
  "more",
  "man",
  "python",
  "python3",
  "node",
  "bun",
  "irb",
  "psql",
  "mysql",
  "redis-cli",
  "sqlite3",
  "ssh",
  "tmux",
  "screen",
  "ranger",
  "lazygit",
  "gitui",
  "tig",
]

/** 触发「按 shell 跑整行」的元字符：管道 / 重定向 / 逻辑连接 / 变量 / 子 shell。 */
const SHELL_METACHAR = /[|<>&;$`(){}*?~]/

/** 简单空白切分取词（v1 不做引号解析，够分诊用）。 */
function tokenize(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean)
}

export interface ClassifyOptions {
  /** 判断某命令是否可在 PATH 中解析（通常注入 Bun.which） */
  which: (cmd: string) => boolean
  /** 浮层交互式程序集合（弹窗/全屏） */
  overlay: ReadonlySet<string>
  /** 内嵌活终端卡片的交互命令集合（流内） */
  inline: ReadonlySet<string>
}

/**
 * 启发式分诊（无前缀）：
 *   1. 首词属于 inline 集合 → interactive/inline（流内活终端卡片）
 *   2. 首词属于 overlay 集合 → interactive/overlay（弹窗/全屏）
 *   3. 含 shell 元字符，或首词能在 PATH 解析 → command（sh -lc 跑整行）
 *   4. 否则 → agent（自然语言，交给 agent）
 */
export function classifyInput(line: string, opts: ClassifyOptions): Triage {
  const raw = line
  const tokens = tokenize(line)
  const command = tokens[0] ?? ""
  const args = tokens.slice(1)

  if (command && opts.inline.has(command)) {
    return { kind: "interactive", command, args, raw, surface: "inline" }
  }
  if (command && opts.overlay.has(command)) {
    return { kind: "interactive", command, args, raw, surface: "overlay" }
  }
  if (SHELL_METACHAR.test(line) || (command && opts.which(command))) {
    return { kind: "command", command, args, raw }
  }
  return { kind: "agent", command, args, raw }
}
