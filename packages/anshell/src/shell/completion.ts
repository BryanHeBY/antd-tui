import { constants } from "node:fs"
import { access, readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import {
  isCommandSeparator,
  lexShell,
  SHELL_BUILTINS,
  toCodePointOffset,
  toUtf16Offset,
  unquoteShellWord,
} from "./lexer"

export interface CompletionItem {
  label: string
  value: string
  kind: "command" | "directory" | "file" | "variable"
  /** 可选说明（真实补全暂不提供，留给下拉框展示） */
  description?: string
}

export interface CompletionResult {
  /** Unicode code point offsets，直接用于 InputEdit。 */
  start: number
  end: number
  items: CompletionItem[]
  /** bash `-o nospace`：唯一候选补全后不追加空格 */
  nospace?: boolean
}

let executableCache: { path: string; expires: number; values: string[] } | null = null

async function executableNames(pathValue: string): Promise<string[]> {
  if (executableCache?.path === pathValue && executableCache.expires > Date.now()) {
    return executableCache.values
  }
  const names = new Set<string>(SHELL_BUILTINS)
  await Promise.all(
    pathValue.split(":").filter(Boolean).map(async (dir) => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      await Promise.all(entries.filter((entry) => !entry.isDirectory()).map(async (entry) => {
        try {
          await access(join(dir, entry.name), constants.X_OK)
          names.add(entry.name)
        } catch {
          // PATH 中不可执行的文件不是命令候选。
        }
      }))
    }),
  )
  const values = [...names].sort()
  executableCache = { path: pathValue, expires: Date.now() + 2000, values }
  return values
}

function expandHome(path: string): string {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return join(homedir(), path.slice(2))
  return path
}

function escapeShellWord(value: string, quoted: boolean): string {
  return quoted ? value : value.replace(/([\s\\'"`$&|;<>()[\]{}*?!#])/g, "\\$1")
}

function completionRange(line: string, cursorUtf16: number): { start: number; raw: string; command: boolean } {
  const before = line.slice(0, cursorUtf16)
  const lexed = lexShell(before)
  const last = lexed.tokens.at(-1)
  if (last && last.end === cursorUtf16 && last.kind !== "operator" && last.kind !== "comment") {
    return { start: last.start, raw: line.slice(last.start, cursorUtf16), command: last.kind === "command" }
  }
  const previous = lexed.tokens.at(-1)
  const command = !previous || (previous.kind === "operator" && isCommandSeparator(previous.text))
  return { start: cursorUtf16, raw: "", command }
}

export async function completeShellInput(
  line: string,
  cursor: number,
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CompletionResult> {
  const cursorUtf16 = toUtf16Offset(line, cursor)
  const range = completionRange(line, cursorUtf16)
  const raw = range.raw
  const quote = raw.startsWith("'") || raw.startsWith('"') ? raw[0] : ""
  const prefix = unquoteShellWord(quote ? raw.slice(1) : raw)
  let items: CompletionItem[] = []

  if (range.command && !prefix.includes("/")) {
    const names = await executableNames(env.PATH ?? "")
    items = names
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({ label: name, value: `${quote}${name}`, kind: "command" as const }))
  } else if (prefix.startsWith("$") && /^\$[A-Za-z0-9_]*$/.test(prefix)) {
    const needle = prefix.slice(1)
    items = Object.keys(env)
      .filter((name) => name.startsWith(needle))
      .sort()
      .map((name) => ({ label: `$${name}`, value: `$${name}`, kind: "variable" as const }))
  } else {
    const expanded = expandHome(prefix)
    const dirPart = dirname(expanded)
    const basePart = basename(expanded)
    const searchDir = isAbsolute(expanded) ? dirPart : resolve(cwd, dirPart === "." ? "" : dirPart)
    try {
      const entries = await readdir(searchDir, { withFileTypes: true })
      const prefixDir = dirname(prefix)
      const shownDir = prefixDir === "." ? "" : prefixDir === "/" ? "/" : `${prefixDir}/`
      items = entries
        .filter(
          (entry) =>
            entry.name.startsWith(basePart) &&
            // 仿 shell：前缀不以 . 开头时不列隐藏文件，否则真实目录会被 dotfile 淹没
            (basePart.startsWith(".") || !entry.name.startsWith(".")),
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => {
          const display = `${shownDir}${entry.name}${entry.isDirectory() ? "/" : ""}`
          return {
            label: display,
            value: `${quote}${escapeShellWord(display, quote !== "")}`,
            kind: entry.isDirectory() ? "directory" as const : "file" as const,
          }
        })
    } catch {
      items = []
    }
  }

  return {
    start: toCodePointOffset(line, range.start),
    end: cursor,
    items: items.slice(0, 200),
  }
}

export function commonPrefix(values: string[]): string {
  if (values.length === 0) return ""
  let prefix = values[0]!
  for (const value of values.slice(1)) {
    while (!value.startsWith(prefix) && prefix.length > 0) prefix = prefix.slice(0, -1)
    if (prefix === "") break
  }
  return prefix
}
