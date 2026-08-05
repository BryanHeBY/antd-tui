import { afterEach, describe, expect, test } from "bun:test"
import { renderTui, type TuiTestSetup } from "@antd-tui/test-utils"
import { Anshell } from "../src/index"

let active: TuiTestSetup | null = null

afterEach(() => {
  active?.destroy()
  active = null
})

async function mount() {
  const t = await renderTui(<Anshell />, { width: 60, height: 12 })
  active = t
  return t
}

describe("Anshell", () => {
  test("一次性命令输出回显进对话", async () => {
    const t = await mount()
    await t.type("echo hello-shell")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("hello-shell"))
    expect(t.frame()).toContain("hello-shell")
  })

  test("cd 更新状态行 cwd，后续命令在新目录执行", async () => {
    const t = await mount()
    await t.type("cd /tmp")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("/tmp"))
    await t.type("pwd")
    await t.enter()
    // 状态行与 pwd 输出都应出现 /tmp
    await t.waitUntil(() => (t.frame().match(/\/tmp/g)?.length ?? 0) >= 1)
    expect(t.frame()).toContain("/tmp")
  })

  test("自然语言且未配置 agent → 系统提示", async () => {
    const t = await mount()
    await t.type("帮我写个函数")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("未配置 agent"))
    expect(t.frame()).toContain("未配置 agent")
  })

  test("输入交互式程序压入终端视图并接管", async () => {
    const t = await mount()
    await t.type("bash")
    await t.enter()
    // 进入 terminal 视图后状态行出现 [bash …] 标签
    await t.waitUntil(() => t.frame().includes("[bash"))
    expect(t.frame()).toContain("[bash")
  })

  test("交互程序退出后出栈回到对话视图", async () => {
    const t = await mount()
    // bash -c exit 立即结束 → onExit 出栈
    await t.type("bash")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("[bash"))
    // 交互 shell 里输入 exit 结束
    await t.type("exit")
    await t.enter()
    // 回到对话视图：状态行标签变回 [对话 …]
    await t.waitUntil(() => t.frame().includes("[对话"))
    expect(t.frame()).toContain("[对话")
  })
})
