import { describe, expect, test } from "bun:test"
import { createModels } from "@earendil-works/pi-ai"
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux"
import { PiAgent, runNativeCommand } from "../src/index"
import type { AcpClientHandlers } from "@antd-tui/acp"

const quietHandlers: AcpClientHandlers = {
  onUpdate: () => {},
  onExit: () => {},
}

/** 双模型 faux：切换有真实目标 */
function dualModelBackend() {
  const faux = fauxProvider({ models: [{ id: "faux-a" }, { id: "faux-b" }] })
  const models = createModels()
  models.setProvider(faux.provider)
  return { faux, models }
}

async function startedAgent() {
  const { faux, models } = dualModelBackend()
  const agent = new PiAgent({ spec: "faux/faux-a", systemPrompt: "测试", handlers: quietHandlers, models })
  await agent.start()
  return { faux, models, agent }
}

describe("runNativeCommand", () => {
  test("非原生命令名返回 null，交回宿主分流", async () => {
    const { agent } = await startedAgent()
    expect(runNativeCommand(agent, "session", "")).toBeNull()
    expect(runNativeCommand(agent, "help", "")).toBeNull()
  })

  test("/model 无参列出可用模型并标出当前项", async () => {
    const { agent } = await startedAgent()
    const result = runNativeCommand(agent, "model", "")
    expect(result?.ok).toBe(true)
    expect(result?.lines).toContain("faux/faux-a  ← 当前")
    expect(result?.lines).toContain("faux/faux-b")
  })

  test("/model 切换生效，未知规格报错", async () => {
    const { agent } = await startedAgent()
    const result = runNativeCommand(agent, "model", "faux/faux-b")
    expect(result?.ok).toBe(true)
    expect(agent.modelSpec).toBe("faux/faux-b")

    const bad = runNativeCommand(agent, "model", "nope/x")
    expect(bad?.ok).toBe(false)
    expect(bad?.lines[0]).toContain("切换失败")
  })

  test("/effort 显示与切换，非法值报错", async () => {
    const { agent } = await startedAgent()
    const show = runNativeCommand(agent, "effort", "")
    expect(show?.ok).toBe(true)
    expect(show?.lines[0]).toContain("off")

    const set = runNativeCommand(agent, "effort", "high")
    expect(set?.ok).toBe(true)
    expect(agent.effort).toBe("high")

    const bad = runNativeCommand(agent, "effort", "turbo")
    expect(bad?.ok).toBe(false)
    expect(bad?.lines[0]).toContain("turbo")
  })

  test("/reset 清空内存对话", async () => {
    const { agent } = await startedAgent()
    const result = runNativeCommand(agent, "reset", "")
    expect(result?.ok).toBe(true)
    expect(result?.lines).toContain("内存对话已清空")
  })

  test("未启动时命令按失败返回而不是抛错", () => {
    const agent = new PiAgent({ systemPrompt: "测试", handlers: quietHandlers })
    const result = runNativeCommand(agent, "model", "faux/faux-a")
    expect(result?.ok).toBe(false)
    expect(result?.lines[0]).toContain("切换失败")
  })
})
