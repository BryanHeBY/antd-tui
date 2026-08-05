import { describe, expect, test } from "bun:test"
import { encodeMouse, scanSgrMouseMode, type MouseInput } from "../src/index"

describe("scanSgrMouseMode", () => {
  test("识别单独的 1006 开关", () => {
    expect(scanSgrMouseMode("\x1b[?1006h", false)).toBe(true)
    expect(scanSgrMouseMode("\x1b[?1006l", true)).toBe(false)
  })

  test("识别合并参数的 DECSET（htop 实际发的形式）", () => {
    expect(scanSgrMouseMode("\x1b[?1006;1000h", false)).toBe(true)
    expect(scanSgrMouseMode("\x1b[?1000;1006h", false)).toBe(true)
    expect(scanSgrMouseMode("\x1b[?1000;1006;1015l", true)).toBe(false)
  })

  test("无关的私有模式不改变状态", () => {
    expect(scanSgrMouseMode("\x1b[?1049h\x1b[?25l\x1b[?1000h", false)).toBe(false)
    expect(scanSgrMouseMode("\x1b[?1049h", true)).toBe(true)
  })

  test("同块内以最后一次协商为准", () => {
    expect(scanSgrMouseMode("\x1b[?1006h ... \x1b[?1006l", false)).toBe(false)
    expect(scanSgrMouseMode("\x1b[?1006l ... \x1b[?1006;1000h", false)).toBe(true)
  })

  test("1006 出现在参数中间不会被前缀匹配误伤", () => {
    // 10060 不是 1006
    expect(scanSgrMouseMode("\x1b[?10060h", false)).toBe(false)
  })
})

const noMods = { shift: false, alt: false, ctrl: false }

function ev(overrides: Partial<MouseInput> = {}): MouseInput {
  return { type: "down", button: 0, col: 0, row: 0, modifiers: noMods, ...overrides }
}

describe("追踪级别过滤", () => {
  test("none 时一律不上报", () => {
    expect(encodeMouse(ev(), "none", true)).toBeNull()
    expect(encodeMouse(ev({ type: "scroll", scroll: { direction: "up", delta: 1 } }), "none", true)).toBeNull()
  })

  test("x10 只上报按下", () => {
    expect(encodeMouse(ev({ type: "down" }), "x10", true)).not.toBeNull()
    expect(encodeMouse(ev({ type: "up" }), "x10", true)).toBeNull()
    expect(encodeMouse(ev({ type: "drag" }), "x10", true)).toBeNull()
    expect(encodeMouse(ev({ type: "move" }), "x10", true)).toBeNull()
  })

  test("vt200 上报按下与松开，但不报拖拽", () => {
    expect(encodeMouse(ev({ type: "up" }), "vt200", true)).not.toBeNull()
    expect(encodeMouse(ev({ type: "drag" }), "vt200", true)).toBeNull()
    expect(encodeMouse(ev({ type: "move" }), "vt200", true)).toBeNull()
  })

  test("drag 上报拖拽但不报无按键移动", () => {
    expect(encodeMouse(ev({ type: "drag" }), "drag", true)).not.toBeNull()
    expect(encodeMouse(ev({ type: "move" }), "drag", true)).toBeNull()
  })

  test("any 连无按键移动也上报", () => {
    // 无按键移动的按钮号是 3（released）+ 32（motion）
    expect(encodeMouse(ev({ type: "move", col: 4, row: 2 }), "any", true)).toBe("\x1b[<35;5;3M")
  })

  test("over / out 是 opentui 自造事件，协议里没有对应上报", () => {
    expect(encodeMouse(ev({ type: "over" }), "any", true)).toBeNull()
    expect(encodeMouse(ev({ type: "out" }), "any", true)).toBeNull()
  })
})

describe("SGR 编码", () => {
  test("坐标 1 起，按下用 M 松开用 m", () => {
    expect(encodeMouse(ev({ col: 4, row: 2 }), "vt200", true)).toBe("\x1b[<0;5;3M")
    expect(encodeMouse(ev({ type: "up", col: 4, row: 2 }), "vt200", true)).toBe("\x1b[<0;5;3m")
  })

  test("右键与中键", () => {
    expect(encodeMouse(ev({ button: 1 }), "vt200", true)).toBe("\x1b[<1;1;1M")
    expect(encodeMouse(ev({ button: 2 }), "vt200", true)).toBe("\x1b[<2;1;1M")
  })

  test("修饰键按 shift=4 / alt=8 / ctrl=16 叠加", () => {
    expect(encodeMouse(ev({ modifiers: { shift: true, alt: false, ctrl: false } }), "vt200", true)).toBe(
      "\x1b[<4;1;1M",
    )
    expect(encodeMouse(ev({ modifiers: { shift: false, alt: true, ctrl: false } }), "vt200", true)).toBe(
      "\x1b[<8;1;1M",
    )
    expect(encodeMouse(ev({ modifiers: { shift: false, alt: false, ctrl: true } }), "vt200", true)).toBe(
      "\x1b[<16;1;1M",
    )
    expect(encodeMouse(ev({ modifiers: { shift: true, alt: true, ctrl: true } }), "vt200", true)).toBe(
      "\x1b[<28;1;1M",
    )
  })

  test("滚轮上下左右分别是 64/65/66/67", () => {
    const wheel = (direction: "up" | "down" | "left" | "right") =>
      encodeMouse(ev({ type: "scroll", scroll: { direction, delta: 1 } }), "vt200", true)
    expect(wheel("up")).toBe("\x1b[<64;1;1M")
    expect(wheel("down")).toBe("\x1b[<65;1;1M")
    expect(wheel("left")).toBe("\x1b[<66;1;1M")
    expect(wheel("right")).toBe("\x1b[<67;1;1M")
  })

  test("拖拽叠加 motion 位（32）", () => {
    expect(encodeMouse(ev({ type: "drag", button: 0 }), "drag", true)).toBe("\x1b[<32;1;1M")
  })

  test("大坐标不受限", () => {
    expect(encodeMouse(ev({ col: 400, row: 300 }), "vt200", true)).toBe("\x1b[<0;401;301M")
  })
})

describe("X10 兜底编码", () => {
  test("坐标偏移 32", () => {
    expect(encodeMouse(ev({ col: 4, row: 2 }), "vt200", false)).toBe(`\x1b[M${String.fromCharCode(32, 37, 35)}`)
  })

  test("松开统一报按钮号 3", () => {
    expect(encodeMouse(ev({ type: "up", button: 2 }), "vt200", false)).toBe(
      `\x1b[M${String.fromCharCode(35, 33, 33)}`,
    )
  })

  test("坐标超出单字节可表示范围时放弃上报", () => {
    expect(encodeMouse(ev({ col: 300, row: 2 }), "vt200", false)).toBeNull()
    expect(encodeMouse(ev({ col: 2, row: 300 }), "vt200", false)).toBeNull()
  })
})

test("负坐标不上报", () => {
  expect(encodeMouse(ev({ col: -1 }), "any", true)).toBeNull()
  expect(encodeMouse(ev({ row: -1 }), "any", true)).toBeNull()
})
