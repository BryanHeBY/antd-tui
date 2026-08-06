import type { CompletionItem, CompletionResult } from "./completion"
import { toCodePointOffset } from "./lexer"
import type { ShellSession } from "./session"

/** shell 引号转义：静默脚本里给 __ansh_compgen 传两个位置参数用。 */
function shArg(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

/**
 * 找到光标所在词的替换区间（与启发式 completion 的口径一致：UTF-16 → 码点偏移）。
 * 真实补全把整行交给 bash 的 completion 函数,但插入替换仍需要知道当前词边界。
 */
function currentWord(line: string, cursor: number): { start: number; word: string } {
  const before = line.slice(0, cursor)
  const m = /[^\s]*$/.exec(before)
  const word = m ? m[0] : ""
  return { start: cursor - word.length, word }
}

/**
 * 问那条长驻 bash 要真实补全：设 COMP_* → 调 completion 函数 → 回带 TSV。
 * 通过 runHidden 的文件通道传输,无需担心引号/长度/OSC 上限。
 */
export async function completeLive(
  session: ShellSession,
  line: string,
  cursor: number,
  timeoutMs = 600,
): Promise<CompletionResult | null> {
  const out = await session.runHidden(`__ansh_compgen ${shArg(line)} ${cursor}`, { timeoutMs }).catch(() => null)
  if (out === null) return null

  let cur = ""
  let opts = ""
  const values: string[] = []
  for (const row of out.split("\n")) {
    const tab = row.indexOf("\t")
    if (tab < 0) continue
    const key = row.slice(0, tab)
    const value = row.slice(tab + 1)
    if (key === "cur") cur = value
    else if (key === "opts") opts = value
    else if (key === "item" && value !== "") values.push(value)
  }
  if (values.length === 0) return null

  const filenames = /\s-o\s+filenames\b/.test(opts)
  const nospace = /\s-o\s+nospace\b/.test(opts)
  const items: CompletionItem[] = values.map((value) => {
    const isDir = filenames && value.endsWith("/")
    return {
      label: value,
      value,
      kind: isDir ? "directory" : filenames ? "file" : "command",
    }
  })

  const { start } = currentWord(line, cursor)
  return {
    start: toCodePointOffset(line, start),
    end: toCodePointOffset(line, cursor),
    items: items.slice(0, 200),
    nospace,
  }
}
