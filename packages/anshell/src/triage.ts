import type { Triage } from "./types"
import { lexShell, SHELL_BUILTINS, unquoteShellWord } from "./shell"

/** 默认不按命令名猜测呈现方式；PTY 进入 alternate screen 时由运行时自动提升浮层。 */
export const DEFAULT_OVERLAY_COMMANDS: readonly string[] = []

const BUILTINS = new Set<string>(SHELL_BUILTINS)

export interface ClassifyOptions {
  /** 命令是否已知（PATH 可执行 / builtin / shell 自报的函数别名）。 */
  which: (cmd: string) => boolean
}

/**
 * shell / agent 二选一分诊（斜杠命令在更上层已经分流）：
 *   含 shell 结构，或首词是已知命令 → command（交给长驻 shell）
 *   否则 → agent（自然语言）
 *
 * 一旦有真 shell，无法预判的命令交给 shell 报错也无妨；这里只把「像自然语言」的
 * 输入挡在 shell 之外——因为写进 PTY 的字节收不回来。
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
