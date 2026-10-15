/**
 * pi 原生 agent 后端：把 @earendil-works/pi-agent-core 的 in-process Agent
 * 适配成 @antd-tui/acp AcpClient 的同形表面（prompt/AcpTurn/handlers/support），
 * 让 ansh / vibe-tui 不经 ACP 子进程、直接在宿主进程内跑一个 agent。
 *
 * 全内存：会话状态、工具注册、事件分发都在内存里，无子进程、无磁盘会话。
 * 无默认工具：pi 的默认工具集在 pi-coding-agent 包里；这里只注册宿主注入的
 * 工具（vibe-tui 注入画布工具，ansh 不注入任何工具）。
 */
import { randomUUID } from "node:crypto"
import { Agent, type AgentEvent, type AgentTool, type AgentToolResult } from "@earendil-works/pi-agent-core"
import type { Models } from "@earendil-works/pi-ai"
import { createModels } from "@earendil-works/pi-ai"
import type {
  AcpClient,
  AcpClientHandlers,
  AcpSupport,
  AcpTurn,
  AgentSessionInfo,
  SessionConfigOption,
  StopReason,
  ToolCallUpdate,
} from "@antd-tui/acp"
import { registerBuiltinProviders, BUILTIN_PROVIDER_IDS, type PiEffort, type PiRuntime } from "./pi-config"

/** pi 的 StopReason → ACP StopReason；ACP 没有 error 段位，错误文本已经 onUpdate 留痕 */
function toAcpStopReason(reason: string | undefined): StopReason {
  if (reason === "length") return "max_tokens"
  if (reason === "aborted") return "cancelled"
  // stop / error / deferred / toolUse（run 已收束时的收尾轮）都按正常结束上报
  return "end_turn"
}

export interface PiAgentOptions {
  /**
   * 模型规格 `provider/model`（如 `anthropic/claude-sonnet-4-5`）。
   * 缺省读 PI_MODEL 环境变量；两者都没有则启动报错并列出可用模型。
   */
  spec?: string
  systemPrompt: string
  /** 推理力度（off/minimal/low/medium/high/xhigh/max），缺省交给模型默认 */
  thinkingLevel?: PiEffort
  /** 宿主注入的工具；不传即零工具的纯对话 agent */
  tools?: AgentTool[]
  handlers: AcpClientHandlers
  /** 测试注入：直接提供 Models（如 faux provider），跳过 provider 注册 */
  models?: Models
}

/**
 * 解析 `provider/model` 规格。
 */
export function parseModelSpec(spec: string): { provider: string; model: string } {
  const slash = spec.indexOf("/")
  if (slash <= 0 || slash === spec.length - 1) {
    throw new Error(`pi 模型规格应为 provider/model，收到 "${spec}"`)
  }
  return { provider: spec.slice(0, slash), model: spec.slice(slash + 1) }
}

function defaultModels(): Models {
  const models = createModels()
  registerBuiltinProviders(models)
  return models
}

function resolveModel(models: Models, spec: string | undefined) {
  const effective = spec ?? process.env.PI_MODEL
  if (!effective) {
    throw new Error("pi 后端需要模型：--model provider/model、PI_MODEL 或 --config 配置文件")
  }
  const { provider, model } = parseModelSpec(effective)
  const resolved = models.getModel(provider, model)
  if (resolved) return resolved
  if (models.getModels(provider).length > 0) {
    const ids = models
      .getModels(provider)
      .slice(0, 8)
      .map((m) => m.id)
      .join(", ")
    throw new Error(`pi 后端找不到模型 "${effective}"；${provider} 可用：${ids} …`)
  }
  throw new Error(
    `pi 后端没有注册 provider "${provider}"；内置：${BUILTIN_PROVIDER_IDS}`,
  )
}

/** 宿主选择 agent 后端的统一描述：ACP 子进程命令，或进程内 pi 原生后端 */
export type AgentBackend =
  | { kind: "acp"; cmd: string[] }
  | {
      kind: "pi"
      /** 显式模型规格（--model），优先于 PI_MODEL 与配置文件 */
      spec?: string
      /** --config 配置文件路径（agent-config JSON） */
      config?: string
      /** --effort 推理力度 */
      effort?: PiEffort
      /** 预解析运行时（CLI 层 buildPiRuntime 的结果，含自定义 provider 与凭据） */
      runtime?: PiRuntime
    }

/** 宿主持有的 agent 客户端：ACP 子进程客户端或进程内 pi 原生后端（同形表面） */
export type AgentClient = AcpClient | PiAgent

export class PiAgent {
  private readonly handlers: AcpClientHandlers
  private agent: Agent | null = null
  private models: Models | null = null
  private stopped = false
  /** 用户已取消本轮：后续的 error 收敛按 ACP 惯例上报 cancelled，不再当作 agent 故障 */
  private cancelling = false
  private readonly id = `pi-${randomUUID()}`
  private lastStopReason: StopReason | null = null

  constructor(private readonly options: PiAgentOptions) {
    this.handlers = options.handlers
  }

  get sessionId(): string {
    return this.id
  }

  /** 原生后端没有 ACP 会话语义：能力开关全部关闭，宿主据此隐藏 /session /mode 等 */
  get support(): AcpSupport {
    return {
      loadSession: false,
      listSessions: false,
      deleteSession: false,
      forkSession: false,
      resumeSession: false,
      closeSession: false,
      setMode: false,
      setConfigOption: false,
    }
  }

  get modes(): null {
    return null
  }

  get configOptions(): SessionConfigOption[] {
    return []
  }

  get availableCommands(): [] {
    return []
  }

  /** 建进程内 Agent；模型与 provider 在这里解析，失败直接抛给 start() 调用方 */
  async start(): Promise<void> {
    const models = this.options.models ?? defaultModels()
    this.models = models
    const model = resolveModel(models, this.options.spec)
    this.agent = new Agent({
      initialState: {
        systemPrompt: this.options.systemPrompt,
        model,
        thinkingLevel: this.options.thinkingLevel,
        tools: this.options.tools ?? [],
      },
      streamFn: models.streamSimple.bind(models),
      sessionId: this.sessionId,
    })
    this.agent.subscribe((event) => this.dispatch(event))
  }

  /** 当前模型规格 `provider/model`；未启动为 null */
  get modelSpec(): string | null {
    const model = this.agent?.state.model
    return model ? `${model.provider}/${model.id}` : null
  }

  /** 当前推理力度；未设定为 undefined */
  get effort(): PiEffort | undefined {
    return this.agent?.state.thinkingLevel
  }

  /** 运行时切换模型：下一轮 prompt 即生效，对话上下文原样保留 */
  setModelSpec(spec: string): void {
    if (!this.agent || !this.models) throw new Error("pi agent 尚未启动")
    this.agent.state.model = resolveModel(this.models, spec)
  }

  /** 运行时切换推理力度 */
  setEffort(level: PiEffort): void {
    if (!this.agent) throw new Error("pi agent 尚未启动")
    this.agent.state.thinkingLevel = level
  }

  /** 可用模型规格（`provider/model`）；可按 provider 过滤 */
  listModelSpecs(provider?: string): string[] {
    if (!this.models) return []
    return this.models.getModels(provider).map((model) => `${model.provider}/${model.id}`)
  }

  /** 清空内存对话从头开始（同 newSession，但不换会话 id） */
  resetConversation(): void {
    this.agent?.reset()
  }

  /** pi 事件 → ACP handlers。文本/思考增量、工具起止、用量与轮次终止原因 */
  private dispatch(event: AgentEvent): void {
    if (this.stopped) return
    const h = this.handlers
    switch (event.type) {
      case "message_update": {
        const inner = event.assistantMessageEvent
        if (inner.type === "text_delta") h.onUpdate(inner.delta)
        else if (inner.type === "thinking_delta") h.onThought?.(inner.delta)
        return
      }
      case "tool_execution_start": {
        h.onToolCall?.(
          {
            toolCallId: event.toolCallId,
            title: event.toolName,
            kind: "other",
            status: "pending",
          },
          "start",
        )
        return
      }
      case "tool_execution_end": {
        const result: AgentToolResult | undefined = event.result
        const update: ToolCallUpdate = {
          toolCallId: event.toolCallId,
          title: event.toolName,
          kind: "other",
          status: event.isError ? "failed" : "completed",
          content: (result?.content ?? [])
            .filter((block) => block.type === "text")
            .map((block) => ({
              type: "content" as const,
              content: { type: "text" as const, text: block.text },
            })),
        }
        h.onToolCall?.(update, "update")
        return
      }
      case "turn_end": {
        if (event.message.role !== "assistant") return
        const message = event.message
        const failed = message.stopReason === "error" || message.stopReason === "aborted"
        if (!failed) {
          h.onUsage?.({
            used: message.usage.totalTokens,
            size: this.agent?.state.model.contextWindow ?? 0,
            cost:
              message.usage.cost.total > 0
                ? { amount: message.usage.cost.total, currency: "USD" }
                : undefined,
          })
        }
        // 工具执行期的取消会让后续请求以 error 收敛；用户语境里这就是 cancelled，
        // 不是 agent 故障，不刷 [agent 错误] 噪声。
        if (message.stopReason === "error" && !this.cancelling) {
          h.onUpdate(`[agent 错误] ${message.errorMessage ?? "未知错误"}\n`, "system")
        }
        this.lastStopReason =
          this.cancelling && failed ? "cancelled" : toAcpStopReason(message.stopReason)
        return
      }
      case "agent_start": {
        h.onBusy?.(true)
        return
      }
      case "agent_end": {
        h.onBusy?.(false)
        return
      }
      default:
        return
    }
  }

  /** 发送一轮 prompt；轮次结束时触发 onTurnEnd（与 AcpClient 的 AcpTurn 同形） */
  prompt(text: string): AcpTurn {
    const agent = this.agent
    if (!agent || this.stopped) {
      return { done: Promise.resolve(null), cancel: () => {} }
    }
    this.cancelling = false
    const done = agent
      .prompt(text)
      .then(() => {
        const reason = this.lastStopReason
        this.lastStopReason = null
        if (!this.stopped) this.handlers.onTurnEnd?.(reason ?? undefined)
        return reason
      })
      .catch(() => null)
    return { done, cancel: () => this.cancel() }
  }

  /** 中断当前轮次：在途 LLM 请求以 aborted 收敛；工具期的取消见 turn_end 的 cancelling 分支 */
  cancel(): void {
    this.cancelling = true
    this.agent?.abort()
  }


  /** 结束后端：中断在途轮次。没有子进程与持久会话，无需清理 */
  async stop(): Promise<void> {
    this.stopped = true
    this.agent?.abort()
  }

  /** 原生后端没有 agent 侧会话存储；这些方法只为对齐 AcpClient 表面 */
  async listSessions(): Promise<AgentSessionInfo[]> {
    return []
  }

  async loadSession(): Promise<void> {
    throw new Error("pi 原生后端是全内存会话，不支持恢复")
  }

  /** 新会话 = 清空内存对话从头开始；返回当前会话 id 保持表面一致 */
  async newSession(): Promise<string> {
    this.agent?.reset()
    return this.sessionId
  }

  async deleteSession(): Promise<void> {}

  async setMode(): Promise<void> {
    throw new Error("pi 原生后端没有会话模式")
  }

  async setConfigOption(): Promise<SessionConfigOption[]> {
    throw new Error("pi 原生后端没有会话配置项")
  }
}

export type { AgentTool }

export { loadAgentConfig, buildPiRuntime, resolveConfigPath, WORKSPACE_CONFIG, BUILTIN_PROVIDER_IDS, PI_EFFORTS } from "./pi-config"
export type { AgentConfigFile, CustomProviderConfig, PiEffort, PiRuntime } from "./pi-config"
export { PI_NATIVE_COMMANDS, runNativeCommand } from "./native-commands"
export type { NativeCommandResult, NativeCommandSpec } from "./native-commands"
