import type { ParsedKey } from "@opentui/core"

export interface KeyModes {
  /** DECCKM：子进程要求光标键用 SS3（\x1bOA）而非 CSI（\x1b[A） */
  applicationCursorKeys: boolean
}

/** 解析后的逃逸键描述，如 "ctrl+]" → { ctrl: true, name: "]" }。 */
export interface EscapeKeySpec {
  ctrl: boolean
  alt: boolean
  shift: boolean
  name: string
}

export function parseEscapeKey(spec: string): EscapeKeySpec {
  const parts = spec.toLowerCase().split("+")
  const name = parts.pop() ?? ""
  return {
    ctrl: parts.includes("ctrl"),
    alt: parts.includes("alt") || parts.includes("meta") || parts.includes("option"),
    shift: parts.includes("shift"),
    name,
  }
}

export function matchesEscapeKey(key: ParsedKey, spec: EscapeKeySpec): boolean {
  return (
    key.name === spec.name &&
    key.ctrl === spec.ctrl &&
    key.shift === spec.shift &&
    (key.meta || key.option) === spec.alt
  )
}

/** CSI 修饰位：1 + shift(1) + alt(2) + ctrl(4) */
function modifierParam(key: ParsedKey): number {
  return 1 + (key.shift ? 1 : 0) + (key.meta || key.option ? 2 : 0) + (key.ctrl ? 4 : 0)
}

/** name → CSI 结尾字符（光标键与编辑键用 CSI final byte 形式） */
const CSI_FINAL: Record<string, string> = {
  up: "A",
  down: "B",
  right: "C",
  left: "D",
  end: "F",
  home: "H",
}

/** name → CSI ~ 形式的参数号 */
const CSI_TILDE: Record<string, number> = {
  insert: 2,
  delete: 3,
  pageup: 5,
  pagedown: 6,
  f5: 15,
  f6: 17,
  f7: 18,
  f8: 19,
  f9: 20,
  f10: 21,
  f11: 23,
  f12: 24,
}

/** name → SS3 结尾字符（F1-F4） */
const SS3_FINAL: Record<string, string> = { f1: "P", f2: "Q", f3: "R", f4: "S" }

const LITERAL: Record<string, string> = {
  return: "\r",
  enter: "\r",
  linefeed: "\n",
  tab: "\t",
  escape: "\x1b",
  space: " ",
  backspace: "\x7f",
}

/**
 * 从 name + 修饰键重建 legacy（非 kitty）字节序列。
 * 宿主开启 kitty keyboard 协议时 raw 是 `\x1b[97u` 这类子进程读不懂的序列，
 * 必须降级重编码。
 */
function legacyEncode(key: ParsedKey, modes: KeyModes): string | null {
  const final = CSI_FINAL[key.name]
  if (final) {
    const mod = modifierParam(key)
    if (mod > 1) return `\x1b[1;${mod}${final}`
    // 光标键在应用模式下走 SS3；end/home 同样遵循
    return modes.applicationCursorKeys ? `\x1bO${final}` : `\x1b[${final}`
  }

  const tilde = CSI_TILDE[key.name]
  if (tilde !== undefined) {
    const mod = modifierParam(key)
    return mod > 1 ? `\x1b[${tilde};${mod}~` : `\x1b[${tilde}~`
  }

  const ss3 = SS3_FINAL[key.name]
  if (ss3) {
    const mod = modifierParam(key)
    return mod > 1 ? `\x1b[1;${mod}${ss3}` : `\x1bO${ss3}`
  }

  const literal = LITERAL[key.name]
  if (literal) return (key.meta || key.option ? "\x1b" : "") + literal

  // 单字符键
  if (key.name.length === 1) {
    let ch = key.name
    if (key.ctrl) {
      const code = ch.toLowerCase().charCodeAt(0)
      // Ctrl+A..Z → 0x01..0x1a；Ctrl+[ \ ] ^ _ → 0x1b..0x1f
      if (code >= 97 && code <= 122) ch = String.fromCharCode(code - 96)
      else if (code >= 91 && code <= 95) ch = String.fromCharCode(code - 64)
      else if (code === 32) ch = "\0"
      else return null
    } else if (key.shift) {
      ch = ch.toUpperCase()
    }
    return (key.meta || key.option ? "\x1b" : "") + ch
  }

  return null
}

/**
 * 把宿主按键编码成写给子进程的字节。
 *
 * 绝大多数情况直接返回 `key.raw`——它就是宿主终端发来的原始序列，保真度最高，
 * 无需自己重建键表。只有两种情况需要改写：kitty 协议下的序列，以及 DECCKM
 * 开启时的光标键（子进程期待 `\x1bOA` 而宿主发的是 `\x1b[A`）。
 */
export function encodeKey(key: ParsedKey, modes: KeyModes): string | null {
  if (key.source === "kitty") return legacyEncode(key, modes)

  if (modes.applicationCursorKeys && CSI_FINAL[key.name] && modifierParam(key) === 1) {
    return `\x1bO${CSI_FINAL[key.name]}`
  }

  return key.raw || key.sequence || null
}

/** 括号粘贴模式下需要给粘贴内容加标记，否则 shell 会把换行当回车逐行执行。 */
export function encodePaste(text: string, bracketed: boolean): string {
  return bracketed ? `\x1b[200~${text}\x1b[201~` : text
}
