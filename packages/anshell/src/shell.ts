import { access, readdir } from "node:fs/promises"
import { constants } from "node:fs"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { homedir } from "node:os"

export type ShellTokenKind =
  | "command"
  | "word"
  | "option"
  | "string"
  | "variable"
  | "operator"
  | "comment"
  | "assignment"
  | "path"
  | "error"

export interface ShellToken {
  kind: ShellTokenKind
  text: string
  /** JavaScript UTF-16 offset；交给 Input 前用 toCodePointOffset 转换。 */
  start: number
  end: number
}

export interface ShellLexResult {
  tokens: ShellToken[]
  incomplete: boolean
}

export type SyntaxDiagnostic =
  | { kind: "valid"; message?: undefined }
  | { kind: "incomplete" | "invalid"; message: string }

export interface CompletionItem {
  label: string
  value: string
  kind: "command" | "directory" | "file" | "variable"
}

export interface CompletionResult {
  /** Unicode code point offsets，直接用于 InputEdit。 */
  start: number
  end: number
  items: CompletionItem[]
}

const CONTROL_OPERATORS = ["<<<", "&&", "||", ">>", "<<", ";;", "|&", ";", "|", "&", ">", "<", "(", ")", "{", "}"]
const COMMAND_SEPARATORS = new Set(["&&", "||", ";", ";;", "|", "|&", "&", "(", "{"])
const REDIRECTIONS = new Set([">", ">>", "<", "<<", "<<<"])
const KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "select",
  "function",
  "time",
  "coproc",
  "in",
])

export const SHELL_BUILTINS = [
  "alias",
  "bg",
  "bind",
  "break",
  "builtin",
  "cd",
  "command",
  "compgen",
  "complete",
  "continue",
  "declare",
  "dirs",
  "disown",
  "echo",
  "enable",
  "eval",
  "exec",
  "exit",
  "export",
  "false",
  "fc",
  "fg",
  "getopts",
  "hash",
  "help",
  "history",
  "jobs",
  "kill",
  "local",
  "logout",
  "mapfile",
  "popd",
  "printf",
  "pushd",
  "pwd",
  "read",
  "readonly",
  "return",
  "set",
  "shift",
  "shopt",
  "source",
  "suspend",
  "test",
  "times",
  "trap",
  "true",
  "type",
  "typeset",
  "ulimit",
  "umask",
  "unalias",
  "unset",
  "wait",
] as const

function matchOperator(input: string, at: number): string | null {
  return CONTROL_OPERATORS.find((operator) => input.startsWith(operator, at)) ?? null
}

function scanQuoted(input: string, start: number, quote: "'" | '"' | "`"): { end: number; closed: boolean } {
  let i = start + 1
  while (i < input.length) {
    if (input[i] === "\\" && quote !== "'") {
      i += 2
      continue
    }
    if (input[i] === quote) return { end: i + 1, closed: true }
    i += 1
  }
  return { end: input.length, closed: false }
}

function scanVariable(input: string, start: number): number {
  const next = input[start + 1]
  if (next === "{" || next === "(") {
    const close = next === "{" ? "}" : ")"
    let depth = 1
    let i = start + 2
    while (i < input.length) {
      if (input[i] === next) depth += 1
      if (input[i] === close && --depth === 0) return i + 1
      i += 1
    }
    return input.length
  }
  let i = start + 1
  if (i < input.length && /[?#!$*@0-9-]/.test(input[i]!)) return i + 1
  while (i < input.length && /[A-Za-z0-9_]/.test(input[i]!)) i += 1
  return Math.max(start + 1, i)
}

/** 单行 Shell lexer：负责颜色、分诊和补全边界，不尝试执行展开。 */
export function lexShell(input: string): ShellLexResult {
  const tokens: ShellToken[] = []
  let incomplete = false
  let i = 0

  while (i < input.length) {
    const char = input[i]!
    if (/\s/.test(char)) {
      i += 1
      continue
    }
    if (char === "#" && (i === 0 || /\s/.test(input[i - 1]!))) {
      tokens.push({ kind: "comment", text: input.slice(i), start: i, end: input.length })
      break
    }
    if (char === "'" || char === '"' || char === "`") {
      const quoted = scanQuoted(input, i, char)
      tokens.push({
        kind: quoted.closed ? "string" : "error",
        text: input.slice(i, quoted.end),
        start: i,
        end: quoted.end,
      })
      if (!quoted.closed) incomplete = true
      i = quoted.end
      continue
    }
    if (char === "$") {
      const end = scanVariable(input, i)
      const text = input.slice(i, end)
      const open = text[1]
      if ((open === "{" && !text.endsWith("}")) || (open === "(" && !text.endsWith(")"))) {
        incomplete = true
      }
      tokens.push({ kind: "variable", text, start: i, end })
      i = end
      continue
    }
    const operator = matchOperator(input, i)
    if (operator) {
      tokens.push({ kind: "operator", text: operator, start: i, end: i + operator.length })
      i += operator.length
      continue
    }

    const start = i
    while (i < input.length) {
      const current = input[i]!
      if (/\s/.test(current) || current === "'" || current === '"' || current === "`" || current === "$") break
      if (matchOperator(input, i)) break
      if (current === "\\" && i + 1 < input.length) i += 2
      else i += 1
    }
    if (i === start) i += 1
    tokens.push({ kind: "word", text: input.slice(start, i), start, end: i })
  }

  let expectCommand = true
  let redirectionTarget = false
  for (const token of tokens) {
    if (token.kind === "string") {
      if (expectCommand) {
        token.kind = "command"
        expectCommand = false
      }
      continue
    }
    if (token.kind === "comment" || token.kind === "error" || token.kind === "variable") {
      if (expectCommand && token.kind !== "comment") expectCommand = false
      continue
    }
    if (token.kind === "operator") {
      if (REDIRECTIONS.has(token.text)) redirectionTarget = true
      else if (COMMAND_SEPARATORS.has(token.text)) expectCommand = true
      continue
    }
    if (redirectionTarget) {
      token.kind = "path"
      redirectionTarget = false
      continue
    }
    if (KEYWORDS.has(token.text)) {
      token.kind = "operator"
      if (["then", "else", "elif", "do"].includes(token.text)) expectCommand = true
      continue
    }
    if (expectCommand && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token.text)) {
      token.kind = "assignment"
      continue
    }
    if (expectCommand) {
      token.kind = "command"
      expectCommand = false
    } else if (token.text.startsWith("-")) {
      token.kind = "option"
    } else if (/^(?:\.?\.?\/|~\/|\/)/.test(token.text)) {
      token.kind = "path"
    }
  }

  return { tokens, incomplete }
}

export function toCodePointOffset(text: string, utf16Offset: number): number {
  return Array.from(text.slice(0, utf16Offset)).length
}

export function toUtf16Offset(text: string, codePointOffset: number): number {
  return Array.from(text).slice(0, codePointOffset).join("").length
}

export function unquoteShellWord(word: string): string {
  if ((word.startsWith("'") && word.endsWith("'")) || (word.startsWith('"') && word.endsWith('"'))) {
    return word.slice(1, -1)
  }
  return word.replace(/\\(.)/g, "$1")
}

export function resolveShell(shell?: string): string {
  return shell || process.env.SHELL || "/bin/sh"
}

export async function checkShellSyntax(
  line: string,
  shell: string,
  cwd: string,
): Promise<SyntaxDiagnostic> {
  if (line.trim() === "") return { kind: "valid" }
  const dialect = basename(shell)
  const args = dialect === "bash"
    ? ["--noprofile", "--norc", "-n", "-c", line]
    : dialect === "zsh"
      ? ["-f", "-n", "-c", line]
      : ["-n", "-c", line]
  const proc = Bun.spawn([shell, ...args], {
    cwd,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    env: { ...process.env, BASH_ENV: "", ENV: "" },
  })
  const timer = setTimeout(() => proc.kill("SIGKILL"), 1500)
  try {
    const [code, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    ])
    if (code === 0) return { kind: "valid" }
    const message = stderr.trim().split("\n").at(-1) || `${dialect} 语法检查失败`
    const incomplete = lexShell(line).incomplete || /unexpected (?:end of file|EOF)|unmatched|matching/.test(stderr)
    return { kind: incomplete ? "incomplete" : "invalid", message }
  } finally {
    clearTimeout(timer)
  }
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
  const command = !previous || (previous.kind === "operator" && COMMAND_SEPARATORS.has(previous.text))
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
        .filter((entry) => entry.name.startsWith(basePart))
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
