import { basename } from "node:path"

/** 能注入 shell integration 钩子的方言。 */
export type ShellDialect = "bash" | "zsh"

export interface ResolvedShell {
  path: string
  /** null = 无法注入钩子（fish/dash/…），anshell 不支持 */
  dialect: ShellDialect | null
}

/**
 * 判定要跑哪个 shell 以及它属于哪种方言。
 *
 * anshell 把所有命令跑在一条长驻交互 shell 里，靠 OSC 133 标记切卡片，而标记只能
 * 由 shell 自己在 prompt 钩子里打出来——bash 的 `PROMPT_COMMAND`/`PS0` 与 zsh 的
 * `precmd`/`preexec` 是唯一两条能注入且与用户 prompt 框架共存的路子。
 */
export function resolveShellDialect(shell?: string): ResolvedShell {
  const path = shell || process.env.SHELL || "/bin/bash"
  const name = basename(path)
  if (name === "bash" || name.startsWith("bash")) return { path, dialect: "bash" }
  if (name === "zsh" || name.startsWith("zsh")) return { path, dialect: "zsh" }
  return { path, dialect: null }
}

/** 不支持的 shell 的提示文本；CLI 与库消费方共用同一份措辞。 */
export function unsupportedShellMessage(path: string): string {
  return [
    `ansh 只支持 bash 与 zsh（当前是 ${path}）`,
    "命令跑在一条长驻 shell 里，需要注入 prompt 钩子来切分卡片；",
    "用 --shell /bin/bash 指定一个受支持的交互式 shell。",
  ].join("\n")
}
