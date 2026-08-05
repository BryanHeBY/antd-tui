import { RGBA, parseColor } from "@opentui/core"

/**
 * ANSI 16 色表。
 *
 * opentui 把 palette 索引摊平成 xterm 的默认静态色板——ANSI 1 是 #800000、
 * ANSI 2 是 #008000，也就是 VGA 时代那套发暗的值。放在现代终端里看,子进程的
 * 输出会明显比同样的内容在宿主里发闷。这里换成 Windows Terminal 的 Campbell
 * 色板作为默认值，可经 `tuiPalette` 覆盖。
 *
 * 索引 16-255 是与主题无关的标准 256 色立方体，不在此表内，直接走 opentui 的换算。
 */
export const defaultAnsiPalette: readonly string[] = [
  "#0c0c0c",
  "#c50f1f",
  "#13a10e",
  "#c19c00",
  "#3b78ff",
  "#881798",
  "#3a96dd",
  "#cccccc",
  "#767676",
  "#e74856",
  "#16c60c",
  "#f9f1a5",
  "#6c9dff",
  "#b4009e",
  "#61d6d6",
  "#f2f2f2",
]

export function toAnsiPalette(hex: readonly string[] = defaultAnsiPalette): RGBA[] {
  return Array.from({ length: 16 }, (_, i) =>
    parseColor(hex[i] ?? defaultAnsiPalette[i] ?? "#cccccc"),
  )
}
