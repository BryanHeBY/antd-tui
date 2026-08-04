import { describe, expect, test } from "bun:test"
import { renderTui, type TuiTestSetup } from "@antd-tui/test-utils"
import { displayWidth } from "@antd-tui/components"
import { ConfigProvider, FocusScope } from "@antd-tui/components"
import { Antop, type AntopSnapshot } from "../src/index"

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

describe("antop", () => {
  test("鼠标选择进程、过滤与结束请求确认", async () => {
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
        { pid: 1700432, ppid: 1700431, user: "postgres", state: "S", cpu: 0.3, memory: 1.2, command: "postgres: autovacuum worker" },
        { pid: 1700433, ppid: 1700431, user: "postgres", state: "S", cpu: 0.1, memory: 0.9, command: "postgres: walwriter" },
        { pid: 1700500, ppid: 1700432, user: "postgres", state: "S", cpu: 0.0, memory: 0.4, command: "postgres: autovacuum worker child" },
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
    // 顶部菜单栏：操作在左，品牌居中，时间在右。
    const topMenu = lineWith(t.frame(), "antop")
    expect(topMenu).toContain("刷新")
    expect(topMenu).toContain("暂停")
    expect(topMenu).toContain("结束")
    expect(topMenu.indexOf("刷新")).toBeLessThan(topMenu.indexOf("antop"))
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
    await t.settle()

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
    // 双击进程行打开分屏详情面板
    await doubleClick(t, "postgres: checkpointer")
    await t.waitUntil(() => t.frame().includes("PID: "), 4000)
    expect(t.frame()).toContain("1700431")
    await click(t, "终止进程")
    await t.waitUntil(() => t.frame().includes("即将终止"), 4000)
    await click(t, "确认终止")
    expect(submitted as Record<string, unknown> | null).toEqual({
      action: "terminate-request",
      pid: 1700431,
      command: "postgres: checkpointer --config /etc/postgresql.conf",
    })

    // 关闭详情 Modal 再过滤，否则详情区仍显示 postgres 进程信息
    await t.type("\x1b")
    await t.waitUntil(() => !t.frame().includes("进程树"), 2000)

    await click(t, "过滤 PID / 用户 / 命令")
    await t.type("nginx")
    await t.waitUntil(() => t.frame().includes("nginx: worker process"), 4000)
    expect(t.frame()).not.toContain("postgres: checkpointer")
    t.destroy()
  }, 20000)
})
