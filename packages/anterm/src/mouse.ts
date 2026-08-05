import type { MouseTrackingMode } from "./types"

/** DECSET / DECRST：`\x1b[?<参数;参数;...><h|l>` */
const PRIVATE_MODE_RE = /\x1b\[\?([0-9;]+)([hl])/g

/** 一条 DECSET 里参数最多的现实情况约十来个字符，跨块扫描保留这么长的尾巴 */
export const SGR_SCAN_TAIL = 32

/**
 * 跟踪子进程是否请求了 SGR（1006）鼠标编码。
 *
 * 不能按字面量找 `\x1b[?1006h`：DECSET 允许合并参数，htop 实际发的是
 * `\x1b[?1006;1000h`。漏判会退化成 X10 编码，而期待 SGR 的程序会把
 * `\x1b[M` 之后的坐标字节当成普通按键——htop 就会把滚轮读成 `a` 而弹出
 * CPU 亲和性对话框。
 */
export function scanSgrMouseMode(chunk: string, current: boolean): boolean {
  let enabled = current
  for (const match of chunk.matchAll(PRIVATE_MODE_RE)) {
    if (match[1]!.split(";").includes("1006")) enabled = match[2] === "h"
  }
  return enabled
}

export interface MouseInput {
  type: "down" | "up" | "move" | "drag" | "drag-end" | "drop" | "over" | "out" | "scroll"
  /** 0=左 1=中 2=右 */
  button: number
  /** 组件内的 cell 坐标，0 起 */
  col: number
  row: number
  modifiers: { shift: boolean; alt: boolean; ctrl: boolean }
  scroll?: { direction: "up" | "down" | "left" | "right"; delta: number }
}

const SHIFT = 4
const ALT = 8
const CTRL = 16
const MOTION = 32
const WHEEL = 64

function withModifiers(base: number, mods: MouseInput["modifiers"]): number {
  let b = base
  if (mods.shift) b |= SHIFT
  if (mods.alt) b |= ALT
  if (mods.ctrl) b |= CTRL
  return b
}

/**
 * 把宿主鼠标事件编码成写给子进程的字节。
 *
 * 事件种类需按子进程协商的追踪级别过滤：只开了 1000（vt200）的程序收到拖拽
 * 报告会解析错位。编码形式由 1006 决定——SGR 支持任意坐标，X10 受 223 列限制。
 */
export function encodeMouse(
  input: MouseInput,
  mode: MouseTrackingMode,
  sgr: boolean,
): string | null {
  if (mode === "none") return null
  if (input.col < 0 || input.row < 0) return null

  let button: number
  let pressed = true

  if (input.type === "scroll") {
    if (!input.scroll) return null
    // 滚轮在所有追踪级别下都上报，编码为 64/65（上/下）、66/67（左/右）
    const offset =
      input.scroll.direction === "up"
        ? 0
        : input.scroll.direction === "down"
          ? 1
          : input.scroll.direction === "left"
            ? 2
            : 3
    button = withModifiers(WHEEL + offset, input.modifiers)
  } else if (input.type === "down") {
    button = withModifiers(input.button, input.modifiers)
  } else if (input.type === "up" || input.type === "drag-end" || input.type === "drop") {
    if (mode === "x10") return null
    button = withModifiers(input.button, input.modifiers)
    pressed = false
  } else if (input.type === "drag") {
    if (mode !== "drag" && mode !== "any") return null
    button = withModifiers(input.button | MOTION, input.modifiers)
  } else if (input.type === "move") {
    if (mode !== "any") return null
    // 无按键移动上报 button=3（released）+ MOTION
    button = withModifiers(3 | MOTION, input.modifiers)
  } else {
    // over / out 是 opentui 自造的悬停事件，终端协议里没有对应上报
    return null
  }

  const col = input.col + 1
  const row = input.row + 1

  if (sgr) return `\x1b[<${button};${col};${row}${pressed ? "M" : "m"}`

  // X10 只有一个字节存坐标，减去 32 的偏移后最多表示到 223
  if (col > 223 || row > 223) return null
  // X10 不区分按下与松开的按钮号，松开统一报 3
  const b = pressed ? button : withModifiers(3, input.modifiers)
  return `\x1b[M${String.fromCharCode(32 + b, 32 + col, 32 + row)}`
}
