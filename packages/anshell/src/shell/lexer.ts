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

export function isCommandSeparator(text: string): boolean {
  return COMMAND_SEPARATORS.has(text)
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
