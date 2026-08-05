import { describe, expect, test } from "bun:test"
import { parseKeypress } from "@opentui/core"
import { encodeKey, encodePaste, matchesEscapeKey, parseEscapeKey } from "../src/index"

function key(sequence: string) {
  const parsed = parseKeypress(sequence)
  if (!parsed) throw new Error(`无法解析按键: ${JSON.stringify(sequence)}`)
  return parsed
}

const normal = { applicationCursorKeys: false }
const application = { applicationCursorKeys: true }

describe("encodeKey", () => {
  test("普通按键原样直通宿主发来的字节", () => {
    expect(encodeKey(key("a"), normal)).toBe("a")
    expect(encodeKey(key("\r"), normal)).toBe("\r")
    expect(encodeKey(key("\t"), normal)).toBe("\t")
    expect(encodeKey(key("\x03"), normal)).toBe("\x03")
    expect(encodeKey(key("\x7f"), normal)).toBe("\x7f")
    expect(encodeKey(key("\x1b[3~"), normal)).toBe("\x1b[3~")
  })

  test("DECCKM 开启时光标键改用 SS3", () => {
    expect(encodeKey(key("\x1b[A"), application)).toBe("\x1bOA")
    expect(encodeKey(key("\x1b[D"), application)).toBe("\x1bOD")
    expect(encodeKey(key("\x1b[H"), application)).toBe("\x1bOH")
  })

  test("带修饰键的光标键不受 DECCKM 影响（CSI 修饰形式无 SS3 对应）", () => {
    expect(encodeKey(key("\x1b[1;5A"), application)).toBe("\x1b[1;5A")
  })

  test("kitty 协议序列降级重编码成 legacy 字节", () => {
    const kitty = { ...key("a"), source: "kitty" as const }
    expect(encodeKey(kitty, normal)).toBe("a")

    const kittyCtrlC = { ...key("\x03"), source: "kitty" as const }
    expect(encodeKey(kittyCtrlC, normal)).toBe("\x03")

    const kittyUp = { ...key("\x1b[A"), source: "kitty" as const }
    expect(encodeKey(kittyUp, normal)).toBe("\x1b[A")
    expect(encodeKey(kittyUp, application)).toBe("\x1bOA")

    const kittyF1 = { ...key("\x1bOP"), source: "kitty" as const }
    expect(encodeKey(kittyF1, normal)).toBe("\x1bOP")

    const kittyAltA = { ...key("\x1ba"), source: "kitty" as const }
    expect(encodeKey(kittyAltA, normal)).toBe("\x1ba")
  })
})

describe("逃逸键", () => {
  test("解析修饰键组合", () => {
    expect(parseEscapeKey("ctrl+]")).toEqual({ ctrl: true, alt: false, shift: false, name: "]" })
    expect(parseEscapeKey("ctrl+shift+q")).toEqual({
      ctrl: true,
      alt: false,
      shift: true,
      name: "q",
    })
  })

  test("Ctrl+] 命中，Ctrl+C 不命中", () => {
    const spec = parseEscapeKey("ctrl+]")
    expect(matchesEscapeKey(key("\x1d"), spec)).toBe(true)
    expect(matchesEscapeKey(key("\x03"), spec)).toBe(false)
  })

  test("hotkey 匹配：Ctrl+O 命中其 spec，普通键不命中（用于 tuiHotkeys 拦截）", () => {
    const spec = parseEscapeKey("ctrl+o")
    expect(matchesEscapeKey(key("\x0f"), spec)).toBe(true) // Ctrl+O = 0x0f
    expect(matchesEscapeKey(key("o"), spec)).toBe(false)
    expect(matchesEscapeKey(key("\x03"), spec)).toBe(false)
  })
})

describe("encodePaste", () => {
  test("括号粘贴模式加标记，否则原样", () => {
    expect(encodePaste("a\nb", true)).toBe("\x1b[200~a\nb\x1b[201~")
    expect(encodePaste("a\nb", false)).toBe("a\nb")
  })
})
