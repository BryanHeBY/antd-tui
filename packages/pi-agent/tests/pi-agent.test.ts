import { afterEach, describe, expect, test } from "bun:test"
import type { AgentTool } from "@earendil-works/pi-agent-core"
import { createModels, Type } from "@earendil-works/pi-ai"
import type { AssistantMessage } from "@earendil-works/pi-ai"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"
import { PiAgent, parseModelSpec } from "../src/index"
import type { AcpClientHandlers, ToolCallUpdate } from "@antd-tui/acp"

function fauxBackend() {
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  return { faux, models }
}

function recordingHandlers() {
  let text = ""
  let thoughts = ""
  const toolCalls: Array<[ToolCallUpdate, "start" | "update"]> = []
  const busyLog: boolean[] = []
  const turnEnds: (string | undefined)[] = []
  /** 首次进入 busy 的信号：cancel 测试用它确定轮次已在途 */
  const firstBusy = Promise.withResolvers<void>()
  /** 首个工具开始执行的信号：cancel 测试用它确定打断时机 */
  const firstToolCall = Promise.withResolvers<void>()
  const handlers: AcpClientHandlers = {
    onUpdate: (chunk) => {
      text += chunk
    },
    onThought: (chunk) => {
      thoughts += chunk
    },
    onToolCall: (call, phase) => {
      toolCalls.push([call as ToolCallUpdate, phase])
      if (phase === "start") firstToolCall.resolve()
    },
    onBusy: (busy) => {
      busyLog.push(busy)
      if (busy) firstBusy.resolve()
    },
    onTurnEnd: (reason) => {
      turnEnds.push(reason)
    },
    onExit: () => {},
  }
  return {
    handlers,
    firstBusy: firstBusy.promise,
    firstToolCall: firstToolCall.promise,
    text: () => text,
    thoughts: () => thoughts,
    toolCalls: () => toolCalls,
    busyLog: () => busyLog,
    turnEnds: () => turnEnds,
  }
}

afterEach(() => {
  delete process.env.PI_MODEL
})

describe("parseModelSpec", () => {
  test("拆 provider/model", () => {
    expect(parseModelSpec("anthropic/claude-sonnet-4-5")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    })
  })

  test("非法规格报错", () => {
    expect(() => parseModelSpec("pi")).toThrow("provider/model")
    expect(() => parseModelSpec("anthropic/")).toThrow("provider/model")
  })
})

describe("PiAgent", () => {
  test("流式文本与思考映射到 onUpdate/onThought，轮次正常收敛", async () => {
    const { faux, models } = fauxBackend()
    faux.setResponses([
      fauxAssistantMessage([fauxThinking("想一想"), fauxText("你好，世界")]),
    ])
    const h = recordingHandlers()
    const agent = new PiAgent({ spec: "faux/faux-1", systemPrompt: "测试", handlers: h.handlers, models })
    await agent.start()

    const turn = agent.prompt("打个招呼")
    expect(await turn.done).toBe("end_turn")
    expect(h.text()).toBe("你好，世界")
    expect(h.thoughts()).toBe("想一想")
    expect(h.turnEnds()).toEqual(["end_turn"])
    expect(h.busyLog()).toEqual([true, false])
    expect(agent.support.listSessions).toBe(false)
  })

  test("宿主注入的工具被执行", async () => {
    const { faux, models } = fauxBackend()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("echo", { text: "ping" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("工具说：pong")]),
    ])
    const echo: AgentTool = {
      name: "echo",
      label: "回声",
      description: "回声",
      parameters: Type.Object({ text: Type.String() }),
      execute: async (_id, params) => ({
        content: [{ type: "text" as const, text: `pong:${(params as { text: string }).text}` }],
        details: {},
      }),
    }
    const h = recordingHandlers()
    const agent = new PiAgent({
      spec: "faux/faux-1",
      systemPrompt: "测试",
      tools: [echo],
      handlers: h.handlers,
      models,
    })
    await agent.start()

    const turn = agent.prompt("调用回声")
    expect(await turn.done).toBe("end_turn")

    expect(h.text()).toBe("工具说：pong")
    const [start, end] = h.toolCalls()
    expect(start[1]).toBe("start")
    expect(start[0].title).toBe("echo")
    expect(end[1]).toBe("update")
    expect(end[0].status).toBe("completed")
    expect(end[0].content).toEqual([
      { type: "content", content: { type: "text", text: "pong:ping" } },
    ])
  })

  test("没有默认工具：调用未注入的 bash 以失败工具结果回流", async () => {
    const { faux, models } = fauxBackend()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("bash", { command: "ls" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("bash 不可用")]),
    ])
    const h = recordingHandlers()
    const agent = new PiAgent({
      spec: "faux/faux-1",
      systemPrompt: "测试",
      handlers: h.handlers,
      models,
    })
    await agent.start()

    const turn = agent.prompt("列一下目录")
    expect(await turn.done).toBe("end_turn")

    const end = h.toolCalls().find(([, phase]) => phase === "update")
    expect(end?.[0].status).toBe("failed")
    expect(h.text()).toBe("bash 不可用")
  })

  test("cancel 打断在途工具执行，onTurnEnd 收到 cancelled 且无错误噪声", async () => {
    const { faux, models } = fauxBackend()
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("hang", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage("取消后不应到达"),
    ])
    // 工具挂到自己的 abort signal 上：这是 pi 唯一确定性连通 abort 的路径
    //（LLM 请求在途的取消要靠真实 provider 的网络栈）。
    const hang: AgentTool = {
      name: "hang",
      label: "挂起",
      description: "挂起直到被取消",
      parameters: Type.Object({}),
      execute: (_id, _params, signal) =>
        new Promise((resolve) => {
          signal?.addEventListener("abort", () => {
            resolve({ content: [{ type: "text" as const, text: "interrupted" }], details: {} })
          })
        }),
    }
    const h = recordingHandlers()
    const agent = new PiAgent({
      spec: "faux/faux-1",
      systemPrompt: "测试",
      tools: [hang],
      handlers: h.handlers,
      models,
    })
    await agent.start()

    const turn = agent.prompt("调用挂起工具")
    // 等工具真正在执行（onToolCall start）再取消，全程无真实时钟
    await h.firstToolCall
    agent.cancel()
    expect(await turn.done).toBe("cancelled")
    expect(h.turnEnds()).toEqual(["cancelled"])
    expect(h.text()).not.toContain("agent 错误")
  })

  test("spec 与 PI_MODEL 都缺省时启动报错", async () => {
    delete process.env.PI_MODEL
    const { models } = fauxBackend()
    const agent = new PiAgent({ systemPrompt: "测试", handlers: recordingHandlers().handlers, models })
    expect(agent.start()).rejects.toThrow("PI_MODEL")
  })

  test("未注册的 provider 报错并列出内置 provider", async () => {
    const { models } = fauxBackend()
    const agent = new PiAgent({
      spec: "nope/x",
      systemPrompt: "测试",
      handlers: recordingHandlers().handlers,
      models,
    })
    expect(agent.start()).rejects.toThrow("anthropic/openai")
  })
})
