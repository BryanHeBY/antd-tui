import { afterEach, describe, expect, test } from "bun:test"
import { parseColor } from "@opentui/core"
import type { ReactNode } from "react"
import { ConfigProvider, FocusScope } from "@antd-tui/components"
import { renderTui, type TuiTestSetup } from "@antd-tui/test-utils"
import { Anterm } from "../src/index"

let active: TuiTestSetup | null = null

afterEach(() => {
  active?.destroy()
  active = null
})

async function mount(node: ReactNode) {
  const t = await renderTui(
    <ConfigProvider>
      <FocusScope>{node}</FocusScope>
    </ConfigProvider>,
    { width: 40, height: 8 },
  )
  active = t
  return t
}

describe("Anterm", () => {
  test("子进程输出渲染到帧上", async () => {
    const t = await mount(
      <Anterm
        command="bash"
        args={["-c", String.raw`printf '\033[2J\033[3;5HHELLO'; sleep 5`]}
        style={{ width: "100%", height: 8 }}
      />,
    )
    await t.waitUntil(() => t.frame().includes("HELLO"))
    expect(t.frame()).toContain("HELLO")
  })

  test("子进程退出时回调收到退出码", async () => {
    const result: { code: number | null } = { code: null }
    const t = await mount(
      <Anterm
        command="bash"
        args={["-c", "exit 5"]}
        onExit={(c) => {
          result.code = c
        }}
        style={{ width: "100%", height: 8 }}
      />,
    )
    await t.waitUntil(() => result.code !== null)
    expect(result.code).toBe(5)
  })

  test("聚焦后按键透传给子进程并回显", async () => {
    const t = await mount(
      <Anterm command="cat" autoFocus style={{ width: "100%", height: 8 }} />,
    )
    await t.type("ping")
    await t.waitUntil(() => t.frame().includes("ping"))
    expect(t.frame()).toContain("ping")
  })

  test("光标随文本帧反色绘制，不叠加会残留的块字符", async () => {
    const t = await mount(
      <Anterm command="cat" autoFocus style={{ width: "100%", height: 8 }} />,
    )
    const cursorBackground = parseColor("#dcdcdc").toInts()
    const cursorSpans = () => t.raw.captureSpans().lines.flatMap((line) => line.spans).filter((span) => {
      const bg = span.bg.toInts()
      return span.text === " " && bg.every((value, index) => value === cursorBackground[index])
    })

    for (const char of "cursor-moved") {
      await t.type(char)
      await t.waitUntil(() => t.frame().includes(char) && cursorSpans().length === 1)
      expect(cursorSpans()).toHaveLength(1)
    }
    expect(t.frame()).not.toContain("█")
  })

  test("Tab 透传给子进程而不是移走焦点", async () => {
    const t = await mount(
      <Anterm command="cat" autoFocus style={{ width: "100%", height: 8 }} />,
    )
    await t.type("ab")
    await t.waitUntil(() => t.frame().includes("ab"))
    await t.tab()
    await t.type("cd")
    // 焦点仍在终端里，cd 也进了子进程；Tab 在 cat 下回显为空白
    await t.waitUntil(() => /ab\s+cd/.test(t.frame()))
    expect(t.frame()).toMatch(/ab\s+cd/)
  })

  test("tuiOnReady 暴露的 handle 可写入子进程", async () => {
    let write: ((data: string) => void) | null = null
    const t = await mount(
      <Anterm
        command="cat"
        tuiOnReady={(handle) => {
          write = handle.write
        }}
        style={{ width: "100%", height: 8 }}
      />,
    )
    await t.waitUntil(() => write !== null)
    write!("from-handle\r")
    await t.waitUntil(() => t.frame().includes("from-handle"))
    expect(t.frame()).toContain("from-handle")
  })
})
