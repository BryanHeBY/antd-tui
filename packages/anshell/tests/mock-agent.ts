/**
 * Mock ACP agent（anshell 测试替身）：用官方 SDK 的 agent() 覆盖 anshell 真正消费的
 * 协议面——available_commands_update（斜杠命令表）、tool_call/tool_call_update（工具卡片）、
 * session/request_permission（权限卡片）、session/list + session/new（/session）、
 * modes/configOptions（/mode 与 /model）、session/cancel。
 *
 * 关键字驱动：prompt 文本里出现某个词就触发对应行为，测试据此断言 UI。
 */
import { agent, ndJsonStream } from "@agentclientprotocol/sdk"

const COMMANDS = [
  { name: "review", description: "审查改动", input: { hint: "<路径>" } },
  { name: "explain", description: "解释这段代码" },
]

let sessionSeq = 0
let cancelled = false

const app = agent()
  .onRequest("initialize", () => ({
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      sessionCapabilities: { list: {}, delete: {} },
    },
    authMethods: [],
  }))
  .onRequest("session/new", () => ({
    sessionId: sessionSeq === 0 ? "mock-session" : `mock-session-${sessionSeq++}`,
    modes: {
      currentModeId: "chat",
      availableModes: [
        { id: "chat", name: "对话" },
        { id: "agentic", name: "自主", description: "可以自己动手" },
      ],
    },
    configOptions: [
      {
        id: "model",
        name: "模型",
        category: "model",
        type: "select",
        currentValue: "fast",
        options: [
          { value: "fast", name: "快速" },
          { value: "smart", name: "聪明" },
        ],
      },
    ],
  }))
  .onRequest("session/load", () => ({}))
  .onRequest("session/list", () => ({
    sessions: [
      { sessionId: "mock-session", cwd: process.cwd(), title: "当前", updatedAt: "2026-01-01T00:00:00Z" },
      { sessionId: "mock-old", cwd: process.cwd(), title: "历史会话", updatedAt: "2025-12-31T00:00:00Z" },
    ],
  }))
  .onRequest("session/delete", () => ({}))
  .onRequest("session/set_mode", () => ({}))
  .onRequest("session/set_config_option", (cx) => ({
    configOptions: [
      {
        id: "model",
        name: "模型",
        category: "model",
        type: "select",
        currentValue: (cx.params as { value: string }).value,
        options: [
          { value: "fast", name: "快速" },
          { value: "smart", name: "聪明" },
        ],
      },
    ],
  }))
  .onNotification("session/cancel", () => {
    cancelled = true
  })
  .onRequest("session/prompt", async (cx) => {
    const sessionId = (cx.params as { sessionId: string }).sessionId
    const prompt = (cx.params as { prompt: Array<{ text?: string }> }).prompt
      .map((block) => block.text ?? "")
      .join("")
    const say = async (text: string) => {
      await cx.client.notify("session/update", {
        sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
      })
    }

    if (prompt.includes("commands")) {
      await cx.client.notify("session/update", {
        sessionId,
        update: { sessionUpdate: "available_commands_update", availableCommands: COMMANDS },
      })
      await say("命令表已推送\n")
      return { stopReason: "end_turn" as const }
    }

    if (prompt.includes("tool")) {
      await cx.client.notify("session/update", {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-1",
          title: "读取 README.md",
          kind: "read",
          status: "in_progress",
        },
      })
      await cx.client.notify("session/update", {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call-1",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text: "tool-output-line" } }],
        },
      })
      await say("工具已跑完\n")
      return { stopReason: "end_turn" as const }
    }

    if (prompt.includes("ask")) {
      const decision = (await cx.client.request("session/request_permission", {
        sessionId,
        toolCall: { toolCallId: "call-danger", title: "删除 /tmp/x", kind: "delete" },
        options: [
          { optionId: "yes", name: "允许一次", kind: "allow_once" },
          { optionId: "always", name: "总是允许", kind: "allow_always" },
          { optionId: "no", name: "拒绝", kind: "reject_once" },
        ],
      })) as { outcome: { outcome: string; optionId?: string } }
      await say(`权限结果 ${decision.outcome.outcome}:${decision.outcome.optionId ?? "-"}\n`)
      return { stopReason: "end_turn" as const }
    }

    if (prompt.includes("slow")) {
      for (let i = 0; i < 40 && !cancelled; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      if (cancelled) {
        cancelled = false
        await say("已中断\n")
        return { stopReason: "cancelled" as const }
      }
      await say("跑完了\n")
      return { stopReason: "end_turn" as const }
    }

    if (prompt.includes("usage")) {
      await cx.client.notify("session/update", {
        sessionId,
        update: { sessionUpdate: "usage_update", used: 1200, size: 8000 },
      })
      await say("已上报用量\n")
      return { stopReason: "end_turn" as const }
    }

    await say(`收到:${prompt}\n`)
    return { stopReason: "end_turn" as const }
  })

const stdout = new WritableStream<Uint8Array>({
  write: (chunk) => {
    process.stdout.write(chunk)
  },
})
// 顶层 await 让 Bun 在 stdio 连接存活期间保持进程；不等待会使 mock 在启动后立即退出。
await app.connect(ndJsonStream(stdout, Bun.stdin.stream() as ReadableStream<Uint8Array>))
