/**
 * Mock ACP agent（测试替身）：用官方 SDK 的 agent() 实现最小 ACP 服务，
 * 演示/测试 vibe-tui 闭环——收到 prompt 后经 _vibetui/render 下发计数器页面，
 * 页面按钮 $agent.send('inc') 回流后计数 +1 并重渲染。
 */
import { agent, ndJsonStream } from "@agentclientprotocol/sdk"

let count = 0

function counterSchema(n: number): Record<string, unknown> {
  return {
    version: "0.1",
    page: { title: "计数器", mode: "interactive" },
    form: {
      type: "object",
      properties: {
        stat: {
          type: "void",
          "x-component": "Statistic",
          "x-component-props": { title: "当前计数", value: n },
        },
        btnInc: {
          type: "void",
          "x-component": "Button",
          "x-content": "+1",
          "x-component-props": { tuiSize: "small", onClick: "{{ () => $agent.send('inc') }}" },
        },
      },
    },
  }
}

const app = agent()
  .onRequest("initialize", () => ({
    protocolVersion: 1,
    agentCapabilities: {},
    authMethods: [],
  }))
  .onRequest("session/new", () => ({ sessionId: "mock-session" }))
  .onRequest("session/prompt", async (cx) => {
    const text = cx.params.prompt
      .map((block) => ("text" in block ? block.text : ""))
      .join(" ")

    if (text.includes("inc")) count += 1
    else count = 0

    const result = await cx.client.request<{ ok: boolean; errors?: string[] }>(
      "_vibetui/render",
      { schema: counterSchema(count) },
    )
    await cx.client.notify("session/update", {
      sessionId: cx.params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: result.ok ? `已渲染计数器（count=${count}）` : `渲染失败：${result.errors?.[0]}`,
        },
      },
    })
    return { stopReason: "end_turn" as const }
  })

const stdout = new WritableStream<Uint8Array>({
  write: (chunk) => {
    process.stdout.write(chunk)
  },
})
app.connect(ndJsonStream(stdout, Bun.stdin.stream() as ReadableStream<Uint8Array>))
