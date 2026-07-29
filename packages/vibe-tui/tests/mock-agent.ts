/**
 * Mock ACP agent（测试替身）：用官方 SDK 的 agent() 实现最小 ACP 服务，
 * 演示/测试 vibe-tui 闭环——收到 prompt 后经 MCP vibetui_eval 用 $ui 活对象树搭页面，
 * 页面按钮 $agent.send('inc') 回流后计数 +1 并热换 Statistic。
 */
import { agent, ndJsonStream } from "@agentclientprotocol/sdk"

let count = 0
let mcpUrl: string | null = null

/** 以 MCP HTTP 客户端身份调用 vibe-tui 画布工具（无状态传输,单次 POST 即可） */
async function callCanvasTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (!mcpUrl) throw new Error("session/new 未注入 MCP 地址")
  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  })
  const raw = await response.text()
  const dataLine = raw.split("\n").find((line) => line.startsWith("data:"))
  const payload = JSON.parse(dataLine ? dataLine.slice(5).trim() : raw) as {
    result?: { content?: Array<{ text?: string }> }
  }
  return payload.result?.content?.[0]?.text ?? ""
}

async function callCanvas(code: string): Promise<void> {
  await callCanvasTool("vibetui_eval", { code })
}

const app = agent()
  .onRequest("initialize", () => ({
    protocolVersion: 1,
    agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
    authMethods: [],
  }))
  .onRequest("session/new", (cx) => {
    const servers = (cx.params.mcpServers ?? []) as Array<{ url?: string }>
    mcpUrl = servers[0]?.url ?? null
    return { sessionId: "mock-session" }
  })
  .onRequest("session/load", async (cx) => {
    // 恢复会话也携带 mcpServers（与 session/new 一致）：捕获画布地址
    const servers = (cx.params.mcpServers ?? []) as Array<{ url?: string }>
    mcpUrl = servers[0]?.url ?? mcpUrl
    // 把历史对话经 session/update 回放（与真实 agent 一致）
    for (const line of ["> 历史提问", "历史回答第一行", "历史回答第二行"]) {
      await cx.client.notify("session/update", {
        sessionId: cx.params.sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `${line}\n` },
        },
      })
    }
    return {}
  })
  .onRequest(
    "session/list",
    (params: unknown) => params as Record<string, never>,
    () => ({
      sessions: [
        { sessionId: "mock-old", title: "历史会话", updatedAt: "2026-07-29T00:00:00Z" },
      ],
    }),
  )
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

    // vibe-tui 启动注入的硬编码引导：确认身份即可，不主动渲染（保持测试可控）
    if (text.includes("你已连接 vibe-tui")) {
      await say("mock 就绪，等待指令\n")
      return { stopReason: "end_turn" as const }
    }

    // $ui 活对象树场景：真函数 handler、props 热换（活树验收）
    if (text.includes("live-hit")) {
      // 活树按钮回流：只确认收到，不改画布
      await say("收到 live-hit\n")
      return { stopReason: "end_turn" as const }
    }
    if (text.includes("live")) {
      await callCanvas('$ui.page({ title: "活树页" })')
      await say("已设活树标题\n")
      await callCanvas(
        '$ui.add("Button", { id: "hit", content: "触发", props: { tuiSize: "small", tuiOnClick: () => $agent.send("live-hit") } })',
      )
      await say("已加触发按钮\n")
      await callCanvas('$ui.add("Typography.Text", { id: "note", content: "活树第二块" })')
      await say("已加第二块\n")
      return { stopReason: "end_turn" as const }
    }

    // 页面快照场景：测试 eval 后立刻截帧，以及 F3 日志层不应污染 agent 页面快照。
    if (text.includes("snapshot-overlay")) {
      await callCanvas(
        '$ui.clear(); $ui.page({ title: "快照页" }); $ui.add("Typography.Text", { content: "页面新标记" })',
      )
      // 给宿主测试机会切入 F3；真实 agent 在复杂页面构建后也会有这一段思考/校验间隙。
      await new Promise((resolve) => setTimeout(resolve, 120))
      const page = await callCanvasTool("vibetui_snapshot", {})
      await say(page.includes("快照页") && page.includes("页面新标记") ? "页面快照已确认\n" : "页面快照错误\n")
      return { stopReason: "end_turn" as const }
    }

    // 流式场景：把一句话拆成字符级 chunk 发出（模拟真实 LLM 流式输出）
    if (text.includes("stream")) {
      for (const ch of "这是一段流式拼接的完整回复") {
        await say(ch)
        // 微延迟：让宿主的「运行中」指示在测试帧里可观测
        await new Promise((r) => setTimeout(r, 30))
      }
      await say("\n")
      return { stopReason: "end_turn" as const }
    }

    // 计数器场景（$ui 活对象树）：点击 +1 回流 'inc' 后热换 Statistic 值
    if (text.includes("inc")) {
      count += 1
      await callCanvas(`$ui.get("stat").props.value = ${count}`)
      await say(`已更新计数器（count=${count}）\n`)
      return { stopReason: "end_turn" as const }
    }
    count = 0
    await callCanvas('$ui.clear(); $ui.page({ title: "计数器", mode: "interactive" })')
    await callCanvas('$ui.add("Statistic", { id: "stat", props: { title: "当前计数", value: 0 } })')
    await callCanvas(
      '$ui.add("Button", { id: "btnInc", content: "+1", props: { tuiSize: "small", tuiOnClick: () => $agent.send("inc") } })',
    )
    await say("已渲染计数器（count=0）\n")
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
