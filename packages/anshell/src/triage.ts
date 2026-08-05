import type { Triage } from "./types"
import { lexShell, SHELL_BUILTINS, unquoteShellWord } from "./shell"

/** 默认不按命令名猜测呈现方式；PTY 进入 alternate screen 时由运行时自动提升浮层。 */
export const DEFAULT_OVERLAY_COMMANDS: readonly string[] = []

const BUILTINS = new Set<string>(SHELL_BUILTINS)

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
 *   3. 含 shell 结构，或首词能在 PATH/builtin 解析 → command
 *   4. 否则 → agent（自然语言，交给 agent）
 */
export function classifyInput(line: string, opts: ClassifyOptions): Triage {
  const raw = line
  const lexed = lexShell(line)
  const commandToken = lexed.tokens.find((token) => token.kind === "command")
  const command = commandToken ? unquoteShellWord(commandToken.text) : ""
  const args = commandToken
    ? lexed.tokens
        .filter((token) => token.start > commandToken.end && token.kind !== "operator" && token.kind !== "comment")
        .map((token) => unquoteShellWord(token.text))
    : []

  if (command && opts.inline.has(command)) {
    return { kind: "interactive", command, args, raw, surface: "inline" }
  }
  if (command && opts.overlay.has(command)) {
    return { kind: "interactive", command, args, raw, surface: "overlay" }
  }
  const hasShellSyntax =
    lexed.incomplete ||
    lexed.tokens.some(
      (token) =>
        token.kind === "operator" ||
        token.kind === "assignment" ||
        token.kind === "variable" ||
        (token.kind === "word" && /[*?[]/.test(token.text)),
    )
  if (hasShellSyntax || (command && (BUILTINS.has(command) || opts.which(command)))) {
    return { kind: "command", command, args, raw }
  }
  return { kind: "agent", command, args, raw }
}
