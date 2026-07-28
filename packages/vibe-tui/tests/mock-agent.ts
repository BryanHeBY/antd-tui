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
          "x-component-props": { tuiSize: "small", tuiOnClick: "{{ () => $agent.send('inc') }}" },
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

    const say = async (chunk: string) => {
      await cx.client.notify("session/update", {
        sessionId: cx.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: chunk },
        },
      })
    }

    // 流式场景：把一句话拆成字符级 chunk 发出（模拟真实 LLM 流式输出）
    if (text.includes("stream")) {
      for (const ch of "这是一段流式拼接的完整回复") await say(ch)
      await say("\n")
      return { stopReason: "end_turn" as const }
    }

    if (text.includes("inc")) count += 1
    else count = 0

    const result = await cx.client.request<{ ok: boolean; errors?: string[] }>(
      "_vibetui/render",
      { schema: counterSchema(count) },
    )
    await say(result.ok ? `已渲染计数器（count=${count}）` : `渲染失败：${result.errors?.[0]}`)
    return { stopReason: "end_turn" as const }
  })

const stdout = new WritableStream<Uint8Array>({
  write: (chunk) => {
    process.stdout.write(chunk)
  },
})
// 顶层 await 让 Bun 在 stdio 连接存活期间保持进程；不等待会使 mock 在启动后
// 立即退出，导致集成测试偶发/持续卡在「agent 启动中」。
await app.connect(ndJsonStream(stdout, Bun.stdin.stream() as ReadableStream<Uint8Array>))
