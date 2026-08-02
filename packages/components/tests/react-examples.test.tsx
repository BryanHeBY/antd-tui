import { describe, expect, test } from "bun:test"
import { renderTui, type TuiTestSetup } from "@antd-tui/test-utils"
import { displayWidth } from "../src/width"
import { ConfigProvider } from "../src/theme"
import { FocusScope } from "../src/focus"
import { Calculator } from "../../../examples/react/calculator"
import { Antop, type AntopSnapshot } from "../../../examples/react/antop"
import { Dashboard } from "../../../examples/react/dashboard"

/**
 * 原生 React 示例冒烟:组件库当普通 React 组件用的第三种形态,
 * 顺带把 examples/react/*.tsx 纳入 typecheck 与 CI。
 */

function locate(frame: string, target: string): { x: number; y: number } {
  const lines = frame.split("\n")
  let found: { x: number; y: number } | null = null
  for (let y = 0; y < lines.length; y++) {
    const idx = lines[y]!.indexOf(target)
    if (idx >= 0) {
      const x = displayWidth(lines[y]!.slice(0, idx))
      found = { x: x + Math.floor(displayWidth(target) / 2), y }
    }
  }
  if (!found) throw new Error(`帧中找不到 "${target}"`)
  return found
}

function lastLine(frame: string, target: string): number {
  const lines = frame.split("\n")
  for (let y = lines.length - 1; y >= 0; y--) {
    if (lines[y]!.includes(target)) return y
  }
  throw new Error(`帧中找不到 "${target}"`)
}

function lineWith(frame: string, target: string): string {
  return frame.split("\n").find((line) => line.includes(target)) ?? (() => { throw new Error(`帧中找不到 "${target}"`) })()
}

async function click(t: TuiTestSetup, label: string) {
  const pos = locate(t.frame(), label)
  await t.raw.mockMouse.click(pos.x, pos.y)
  await t.settle()
}

async function doubleClick(t: TuiTestSetup, label: string) {
  const pos = locate(t.frame(), label)
  await t.raw.mockMouse.doubleClick(pos.x, pos.y)
  await t.settle()
}

describe("examples/react", () => {
  test("calculator:点击 7 + 8 = 得 15", async () => {
    const t = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <Calculator />
        </FocusScope>
      </ConfigProvider>,
      { width: 70, height: 26 },
    )
    await t.waitUntil(() => t.frame().includes("TUI 计算器（React 版）"), 8000)
    await click(t, "7")
    await click(t, "+")
    await click(t, "8")
    await click(t, "=")
    expect(t.frame()).toContain("15")
    t.destroy()
  }, 20000)

  test("dashboard:登录 → shell 导航 → 条件渲染联动 → 校验", async () => {
    let submitted: Record<string, unknown> | null = null
    const t = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <Dashboard
            actions={{ submit: (v) => (submitted = v), cancel: () => {} }}
          />
        </FocusScope>
      </ConfigProvider>,
      { width: 90, height: 40 },
    )
    await t.waitUntil(() => t.frame().includes("登录"), 8000)

    // 空提交拦截
    await click(t, "登 录")
    await t.waitUntil(() => t.frame().includes("用户名与密码不能为空"), 4000)

    // 点击空提交后焦点在按钮上:分别点回两个输入框填值,再点登录
    await click(t, "ops-admin")
    await t.type("admin")
    await click(t, "任意非空")
    await t.type("secret")
    await click(t, "登 录")
    await t.waitUntil(() => t.frame().includes("节点负载"), 8000)

    // 导航热键 + 条件渲染
    await t.type("2")
    await t.waitUntil(() => t.frame().includes("gateway 详情"), 4000)
    await t.type("4")
    await t.waitUntil(() => t.frame().includes("部署配置"), 4000)
    expect(t.frame()).not.toContain("CPU 上限")

    // 空名称部署:校验错误经 FormItem 上屏,不回传
    await click(t, "  部署  ")
    await t.waitUntil(() => t.frame().includes("服务名称必填"), 4000)
    expect(submitted).toBeNull()
    t.destroy()
  }, 20000)

  test("antop:鼠标选择进程、过滤与结束请求确认", async () => {
    const snapshot: AntopSnapshot = {
      host: "workstation",
      capturedAt: new Date("2026-07-30T09:00:00Z"),
      cpuCount: 8,
      load: [2.4, 1.8, 1.2],
      memoryTotal: 16 * 1024 ** 3,
      memoryUsed: 9 * 1024 ** 3,
      processes: [
        { pid: 1702048, ppid: 1, user: "hby", state: "R", cpu: 48.2, memory: 3.4, command: "bun server.ts --port 3000" },
        { pid: 1700431, ppid: 1, user: "postgres", state: "S", cpu: 2.1, memory: 4.8, command: "postgres: checkpointer --config /etc/postgresql.conf" },
        { pid: 1708001, ppid: 1, user: "root", state: "S", cpu: 0.4, memory: 0.8, command: "nginx: worker process" },
      ],
    }
    let submitted: Record<string, unknown> | null = null
    const t = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <Antop snapshot={snapshot} actions={{ submit: (value) => (submitted = value), cancel: () => {} }} />
        </FocusScope>
      </ConfigProvider>,
      { width: 110, height: 34 },
    )
    await t.waitUntil(() => t.frame().includes("antop"), 8000)
    // 控制项属于 dashboard 式顶部菜单栏，不额外占用进程区高度。
    const topMenu = lineWith(t.frame(), "antop")
    expect(topMenu).toContain("r 刷新")
    expect(topMenu).toContain("p 暂停")
    expect(topMenu).toContain("结束请求")
    expect(topMenu.indexOf("r 刷新")).toBeLessThan(topMenu.indexOf("antop"))
    // htop 式顶部仪表：每个逻辑 CPU 都有独立条，而非只有一个聚合 CPU 数字。
    expect(t.frame()).toContain("CPU0 [")
    expect(t.frame()).toContain("CPU7 [")
    expect(t.frame()).toContain("MEM [")
    expect(t.frame()).toContain("SWP [")
    // 进程区必须是真正的连续表格行：相邻进程没有按钮边框或空行。
    expect(lastLine(t.frame(), "nginx: worker process") - lastLine(t.frame(), "postgres: checkpointer")).toBe(1)
    // PID 达 7 位时，USER 列仍须与表头严格对齐；分隔线可拖动改变列宽。
    const headerBefore = lineWith(t.frame(), "PID│USER")
    expect(lineWith(t.frame(), "postgres: checkpointer").indexOf("postgres")).toBe(headerBefore.indexOf("USER"))
    const dividerX = displayWidth(headerBefore.slice(0, headerBefore.indexOf("│")))
    const dividerY = lastLine(t.frame(), "PID")
    await t.raw.mockMouse.drag(dividerX, dividerY, dividerX + 2, dividerY)
    await t.settle()
    expect(lineWith(t.frame(), "USER").indexOf("USER")).toBe(headerBefore.indexOf("USER") + 2)
    expect(lineWith(t.frame(), "postgres: checkpointer").indexOf("postgres")).toBe(lineWith(t.frame(), "USER").indexOf("USER"))
    await click(t, "postgres: checkpointer")
    await t.waitUntil(() => t.frame().includes("PID 1700431"), 4000)

    await click(t, "USER")
    await t.waitUntil(() => t.frame().includes("USER↓"), 4000)
    expect(lastLine(t.frame(), "nginx: worker process")).toBeLessThan(lastLine(t.frame(), "postgres: checkpointer"))

    await click(t, "PID")
    await t.waitUntil(() => t.frame().includes("PID↓"), 4000)
    expect(lastLine(t.frame(), "nginx: worker process")).toBeLessThan(lastLine(t.frame(), "bun server.ts"))

    await click(t, "MEM%")
    await t.waitUntil(() => t.frame().includes("MEM%↓"), 4000)
    expect(lastLine(t.frame(), "postgres: checkpointer")).toBeLessThan(lastLine(t.frame(), "bun server.ts"))
    await click(t, "MEM%↓")
    await t.waitUntil(() => t.frame().includes("MEM%↑"), 4000)
    expect(lastLine(t.frame(), "nginx: worker process")).toBeLessThan(lastLine(t.frame(), "postgres: checkpointer"))
    await doubleClick(t, "postgres: checkpointer")
    await t.waitUntil(() => t.frame().includes("进程详情"), 4000)
    await click(t, "申请结束")
    await t.waitUntil(() => t.frame().includes("发起结束请求"), 4000)
    await click(t, "回传请求")
    expect(submitted as Record<string, unknown> | null).toEqual({
      action: "terminate-request",
      pid: 1700431,
      command: "postgres: checkpointer --config /etc/postgresql.conf",
    })

    await click(t, "过滤 PID、用户或命令")
    await t.type("nginx")
    await t.waitUntil(() => t.frame().includes("nginx: worker process"), 4000)
    expect(t.frame()).not.toContain("postgres: checkpointer")
    t.destroy()
  }, 20000)
})
