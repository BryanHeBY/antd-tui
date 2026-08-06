/**
 * ACP 客户端桥：基于官方 @agentclientprotocol/sdk（不自研 JSON-RPC）。
 *
 * 宿主是 client，agent 是子进程（NDJSON stdio）：
 *   client → agent：initialize / session/new 或 session/load（复用会话，历史回放）
 *                    / session/prompt（人类输入与页面事件都走 prompt）/ session/cancel
 *   agent → client 通知：session/update（13 种变体，见 dispatchUpdate）
 *   agent → client 请求：session/request_permission（默认自动放行，宿主可接管）
 */
import { client, ndJsonStream, type ClientContext } from "@agentclientprotocol/sdk"
import type {
  AgentCapabilities,
  AvailableCommand,
  ContentBlock,
  PermissionOption,
  PlanEntry,
  RequestPermissionRequest,
  SessionConfigOption,
  SessionModeState,
  SessionNotification,
  SessionUpdate,
  StopReason,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk"

/**
 * ACP agent 可能还要解压运行时、启动 app-server、恢复认证状态；10 秒只适合轻量 mock。
 * 保持调用方可覆盖，避免把真实 agent 的冷启动误报为协议连接失败。
 */
const DEFAULT_STARTUP_TIMEOUT_MS = 60_000

/** 启动失败时回带的 stderr 尾巴长度：够定位报错，又不至于把整个日志灌进 UI。 */
const STDERR_TAIL = 2000

/** 交给宿主决策的权限请求。ACP 的 toolCall 是 ToolCallUpdate，只有 toolCallId 必然存在。 */
export interface AcpPermissionRequest {
  toolCallId: string
  title?: string
  /** ACP ToolKind：read/edit/delete/move/search/execute/think/fetch/switch_mode/other */
  kind?: string
  options: PermissionOption[]
  raw: RequestPermissionRequest
}

export type AcpPermissionDecision =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" }

/** 一次 prompt 轮次的句柄：可等待终止原因，也可中途取消。 */
export interface AcpTurn {
  /** 轮次终止原因；连接不可用或请求失败时为 null */
  done: Promise<StopReason | null>
  cancel: () => void
}

export interface AcpClientHandlers {
  /** agent_message_chunk 的流式文本（chunk 是碎片而非整行，由上层拼接） */
  onUpdate: (text: string, kind?: "agent" | "system") => void
  /** agent_thought_chunk；未提供时思考内容被丢弃，不会混进正文 */
  onThought?: (text: string) => void
  /** tool_call（phase="start"）与 tool_call_update（phase="update"）。content/locations 是整体替换语义 */
  onToolCall?: (call: ToolCall | ToolCallUpdate, phase: "start" | "update") => void
  /** plan：entries 每次全量替换 */
  onPlan?: (entries: PlanEntry[]) => void
  /** available_commands_update：agent 侧命令表，全量替换 */
  onCommands?: (commands: AvailableCommand[]) => void
  /** current_mode_update：agent 自行切换了会话模式 */
  onMode?: (modeId: string) => void
  /** config_option_update：模型等配置项，全量替换 */
  onConfigOptions?: (options: SessionConfigOption[]) => void
  /** usage_update：上下文占用与费用 */
  onUsage?: (usage: { used: number; size: number; cost?: { amount: number; currency: string } }) => void
  /** session_info_update：标题与更新时间（null 表示清空） */
  onSessionInfo?: (info: { title?: string | null; updatedAt?: string | null }) => void
  /**
   * session/request_permission：未提供时自动放行（优先 allow_always）并经 onUpdate 留痕，
   * 提供后由宿主决策——取消 prompt 轮次时必须回 cancelled。
   */
  onPermission?: (request: AcpPermissionRequest) => Promise<AcpPermissionDecision> | AcpPermissionDecision
  /** 一轮 prompt 结束，上层可冲刷未完的流式行 */
  onTurnEnd?: (stopReason?: StopReason) => void
  /** 运行状态变化：true = 有 prompt 轮次在途（agent 运行中），false = 空闲 */
  onBusy?: (busy: boolean) => void
  /** agent 进程退出 */
  onExit: (code: number | null) => void
}

export interface AcpClientOptions {
  /** 退出时删除临时 ACP session，默认开启；恢复的会话（sessionId 指定）永不删除 */
  ephemeral?: boolean
  /** 等待 initialize + session 建立完成的最长时间，默认 60 秒 */
  startupTimeoutMs?: number
  /** 复用既有会话：经 session/load 恢复（需 agent 声明 loadSession 能力），历史经 update 回放 */
  sessionId?: string
  /** 注入给 agent 的 MCP server 列表（session/new 与 session/load 均携带） */
  mcpServers?: unknown[]
  /** 会话工作目录，默认 process.cwd()；宿主自己维护 cwd 时应传入 */
  cwd?: string
}

/** agent 声明的能力换算成可直接判断的开关。ACP 用「键是否存在」表达支持，null/缺省都是不支持。 */
export interface AcpSupport {
  loadSession: boolean
  listSessions: boolean
  deleteSession: boolean
  forkSession: boolean
  resumeSession: boolean
  closeSession: boolean
  /** session/new 返回了 modes 才能用 session/set_mode */
  setMode: boolean
  /** 返回了 configOptions 才能用 session/set_config_option（模型选择走这里） */
  setConfigOption: boolean
}

export interface AgentSessionInfo {
  sessionId: string
  title?: string
  cwd?: string
  updatedAt?: string
}

function textOf(content: ContentBlock | undefined): string | null {
  if (!content || content.type !== "text") return null
  return content.text
}

export class AcpClient {
  private proc: ReturnType<typeof Bun.spawn> | null = null
  private currentSessionId: string | null = null
  private resumed = false
  private ctx: ClientContext | null = null
  private agentCapabilities: AgentCapabilities | null = null
  private sessionModes: SessionModeState | null = null
  private sessionConfigOptions: SessionConfigOption[] = []
  private commands: AvailableCommand[] = []
  private stderrTail = ""
  private stopped = false
  private readySettled = false
  private startupTimer: ReturnType<typeof setTimeout> | null = null
  private readyResolve: (() => void) | null = null
  private readyReject: ((reason: Error) => void) | null = null
  private exitNotified = false
  private readonly ready = new Promise<void>((resolve, reject) => {
    this.readyResolve = resolve
    this.readyReject = reject
  })

  constructor(
    private readonly cmd: string[],
    private readonly handlers: AcpClientHandlers,
    private readonly options: AcpClientOptions = {},
  ) {
    // ready 同时供 start() 与 prompt() 等待。后者会在启动失败时静默放弃，
    // 因而需要预先吸收那条分支上的拒绝，避免出现未处理 Promise 警告。
    void this.ready.catch(() => {})
  }

  /** 当前会话 id；未建立时为 null */
  get sessionId(): string | null {
    return this.currentSessionId
  }

  get capabilities(): AgentCapabilities | null {
    return this.agentCapabilities
  }

  get modes(): SessionModeState | null {
    return this.sessionModes
  }

  get configOptions(): SessionConfigOption[] {
    return this.sessionConfigOptions
  }

  get availableCommands(): AvailableCommand[] {
    return this.commands
  }

  get support(): AcpSupport {
    const caps = this.agentCapabilities
    const session = caps?.sessionCapabilities
    return {
      loadSession: caps?.loadSession === true,
      listSessions: session?.list != null,
      deleteSession: session?.delete != null,
      forkSession: session?.fork != null,
      resumeSession: session?.resume != null,
      closeSession: session?.close != null,
      setMode: this.sessionModes != null,
      setConfigOption: this.sessionConfigOptions.length > 0,
    }
  }

  private resolveReady(): void {
    if (this.readySettled) return
    this.readySettled = true
    if (this.startupTimer) clearTimeout(this.startupTimer)
    this.startupTimer = null
    this.readyResolve?.()
  }

  private rejectReady(error: Error): void {
    if (this.readySettled) return
    this.readySettled = true
    if (this.startupTimer) clearTimeout(this.startupTimer)
    this.startupTimer = null
    this.readyReject?.(error)
  }

  private failure(message: string): Error {
    const tail = this.stderrTail.trim()
    return new Error(tail === "" ? message : `${message}\n${tail}`)
  }

  private notifyExit(code: number | null): void {
    if (this.exitNotified || this.stopped) return
    this.exitNotified = true
    this.handlers.onExit(code)
  }

  /** session/update 的 13 种变体在这里散开；payload 与判别字段是平铺在同一对象上的。 */
  private dispatchUpdate(update: SessionUpdate): void {
    const h = this.handlers
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const text = textOf(update.content)
        if (text) h.onUpdate(text)
        return
      }
      case "agent_thought_chunk": {
        const text = textOf(update.content)
        if (text) h.onThought?.(text)
        return
      }
      case "tool_call":
        h.onToolCall?.(update, "start")
        return
      case "tool_call_update":
        h.onToolCall?.(update, "update")
        return
      case "plan":
        h.onPlan?.(update.entries)
        return
      case "available_commands_update":
        this.commands = update.availableCommands
        h.onCommands?.(update.availableCommands)
        return
      case "current_mode_update":
        if (this.sessionModes) this.sessionModes = { ...this.sessionModes, currentModeId: update.currentModeId }
        h.onMode?.(update.currentModeId)
        return
      case "config_option_update":
        this.sessionConfigOptions = update.configOptions
        h.onConfigOptions?.(update.configOptions)
        return
      case "usage_update":
        h.onUsage?.({ used: update.used, size: update.size, cost: update.cost ?? undefined })
        return
      case "session_info_update":
        h.onSessionInfo?.({ title: update.title, updatedAt: update.updatedAt })
        return
      default:
        // user_message_chunk 与 plan_update/plan_removed（UNSTABLE，未声明能力）不消费
        return
    }
  }

  private async decidePermission(
    params: RequestPermissionRequest,
  ): Promise<{ outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" } }> {
    const cancelled = { outcome: { outcome: "cancelled" as const } }
    if (this.stopped) return cancelled
    const options = params.options ?? []
    const decide = this.handlers.onPermission
    if (decide) {
      const decision = await decide({
        toolCallId: params.toolCall?.toolCallId ?? "",
        title: params.toolCall?.title ?? undefined,
        kind: params.toolCall?.kind ?? undefined,
        options,
        raw: params,
      })
      if (decision.outcome === "selected") {
        return { outcome: { outcome: "selected" as const, optionId: decision.optionId } }
      }
      return cancelled
    }
    // 无宿主决策时自动放行：vibe-tui 那种无人值守闭环不能被交互确认卡死。
    // 优先选 allow_always 减少重复请求；日志里留痕保证透明。
    const pick =
      options.find((o) => o.kind === "allow_always") ??
      options.find((o) => o.kind === "allow_once") ??
      options[0]
    if (!pick) return cancelled
    this.handlers.onUpdate(`[自动授权] ${params.toolCall?.title ?? "工具调用"}\n`, "system")
    return { outcome: { outcome: "selected" as const, optionId: pick.optionId } }
  }

  async start(): Promise<void> {
    try {
      this.proc = Bun.spawn(this.cmd, { stdin: "pipe", stdout: "pipe", stderr: "pipe" })
    } catch (err) {
      const error = new Error(`无法启动 agent：${(err as Error).message}`)
      this.rejectReady(error)
      throw error
    }

    // agent 崩溃时 stderr 往往是唯一线索；只留尾巴，避免长跑进程无限攒日志。
    void (async () => {
      const stderr = this.proc?.stderr
      if (!stderr || typeof stderr === "number") return
      const reader = (stderr as ReadableStream<Uint8Array>).getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        if (!value) continue
        this.stderrTail = (this.stderrTail + decoder.decode(value, { stream: true })).slice(-STDERR_TAIL)
      }
    })().catch(() => {})

    const startupTimeoutMs = this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
    if (startupTimeoutMs > 0) {
      this.startupTimer = setTimeout(() => {
        this.rejectReady(this.failure(`等待 agent 初始化超时（${startupTimeoutMs}ms）`))
      }, startupTimeoutMs)
    }

    const sink = this.proc.stdin as import("bun").FileSink
    const output = new WritableStream<Uint8Array>({
      write: (chunk) => {
        sink.write(chunk)
        void sink.flush()
      },
    })
    const stream = ndJsonStream(output, this.proc.stdout as ReadableStream<Uint8Array>)

    const handleExit = (code: number | null) => {
      if (this.stopped) return
      this.rejectReady(this.failure(`agent 在初始化完成前退出（code ${code ?? "?"}）`))
      this.notifyExit(code)
    }
    void this.proc.exited.then(handleExit)

    const app = client()
      // 统一的 update 通道：新会话的流式输出与 session/load 的历史回放走同一处理
      .onNotification("session/update", (cx) => {
        // React 宿主已经卸载时，stdio 连接可能仍在收尾并送达最后几个 chunk。
        // 这些消息不能再回写已销毁的宿主。
        if (this.stopped) return
        const params = cx.params as SessionNotification
        if (this.currentSessionId && params.sessionId !== this.currentSessionId) return
        this.dispatchUpdate(params.update)
      })
      .onRequest(
        "session/request_permission",
        (params: unknown) => params as RequestPermissionRequest,
        (cx) => this.decidePermission(cx.params),
      )

    // 长驻连接：会话建立后保持挂起，通知经上面的 handler 分发，连接关闭时结束
    void app
      .connectWith(stream, async (ctx) => {
        this.ctx = ctx
        const init = (await ctx.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: {},
        })) as { agentCapabilities?: AgentCapabilities }
        this.agentCapabilities = init.agentCapabilities ?? {}

        if (this.options.sessionId) {
          if (this.agentCapabilities.loadSession !== true) {
            throw new Error("该 agent 不支持恢复会话（未声明 loadSession 能力）")
          }
          // 先记 sessionId：load 期间历史就开始经 session/update 回放
          this.currentSessionId = this.options.sessionId
          this.resumed = true
          const loaded = (await ctx.request("session/load", {
            sessionId: this.options.sessionId,
            cwd: this.cwd(),
            mcpServers: (this.options.mcpServers ?? []) as never,
          })) as { modes?: SessionModeState | null; configOptions?: SessionConfigOption[] | null } | null
          this.adoptSessionState(loaded)
        } else {
          const created = (await ctx.request("session/new", {
            cwd: this.cwd(),
            mcpServers: (this.options.mcpServers ?? []) as never,
          })) as {
            sessionId: string
            modes?: SessionModeState | null
            configOptions?: SessionConfigOption[] | null
          }
          this.currentSessionId = created.sessionId
          this.adoptSessionState(created)
        }
        this.resolveReady()
        // 保持连接存活（op 返回即断开）
        await new Promise<never>(() => {})
      })
      .catch(async (err: unknown) => {
        // initialize/session 建立失败时必须让 start() 返回失败，不能永远停在「启动中」。
        // 如果连接正因子进程退出而断开，先等待退出码并触发 onExit，确保 start()
        // 失败时宿主状态不会短暂落后于真实进程状态。
        const proc = this.proc
        if (proc && !this.stopped) {
          const code = await proc.exited
          handleExit(code)
          return
        }
        this.rejectReady(this.failure(`ACP 连接失败：${err instanceof Error ? err.message : String(err)}`))
      })

    await this.ready
  }

  private cwd(): string {
    return this.options.cwd ?? process.cwd()
  }

  private adoptSessionState(
    state: { modes?: SessionModeState | null; configOptions?: SessionConfigOption[] | null } | null,
  ): void {
    this.sessionModes = state?.modes ?? null
    this.sessionConfigOptions = state?.configOptions ?? []
  }

  /** 在途 prompt 轮次计数：>0 即 agent 运行中 */
  private inflight = 0

  private trackTurn(delta: 1 | -1): void {
    const wasBusy = this.inflight > 0
    this.inflight = Math.max(0, this.inflight + delta)
    // stop() 后仍可能有已经发出的 session/prompt 完成；只维护内部计数，
    // 不再把异步收尾回调送往已经卸载的宿主。
    if (this.stopped) return
    const busy = this.inflight > 0
    if (busy !== wasBusy) this.handlers.onBusy?.(busy)
  }

  /** 发送一轮 prompt（人类输入或页面事件回流）；轮次结束时触发 onTurnEnd */
  prompt(text: string): AcpTurn {
    if (this.stopped) return { done: Promise.resolve(null), cancel: () => {} }
    this.trackTurn(1)
    const done = this.ready
      .then(async () => {
        if (!this.ctx || !this.currentSessionId) return null
        try {
          const result = (await this.ctx.request("session/prompt", {
            sessionId: this.currentSessionId,
            prompt: [{ type: "text", text }],
          })) as { stopReason?: StopReason } | null
          const stopReason = result?.stopReason
          this.handlers.onTurnEnd?.(stopReason)
          return stopReason ?? null
        } catch {
          // 轮次失败不致命：agent 侧可经 session/update 反馈
          return null
        }
      })
      .catch(() => null)
      .finally(() => this.trackTurn(-1))
    return { done, cancel: () => this.cancel() }
  }

  /** 中断当前轮次（session/cancel 是通知，agent 之后会以 cancelled 回收 prompt） */
  cancel(): void {
    if (this.stopped || !this.ctx || !this.currentSessionId) return
    void this.ctx.notify("session/cancel", { sessionId: this.currentSessionId })
  }

  /** 列出 agent 侧会话（需 sessionCapabilities.list），复用当前连接而不另起进程 */
  async listSessions(): Promise<AgentSessionInfo[]> {
    await this.ready
    if (!this.ctx) return []
    const result = (await this.ctx.request("session/list", {})) as { sessions?: AgentSessionInfo[] }
    return result.sessions ?? []
  }

  /** 在当前连接上切到另一个会话（session/load）；成功后 sessionId 与模式/配置随之更新 */
  async loadSession(sessionId: string): Promise<void> {
    await this.ready
    if (!this.ctx) throw new Error("agent 尚未就绪")
    if (this.agentCapabilities?.loadSession !== true) {
      throw new Error("该 agent 不支持恢复会话（未声明 loadSession 能力）")
    }
    this.currentSessionId = sessionId
    this.resumed = true
    const loaded = (await this.ctx.request("session/load", {
      sessionId,
      cwd: this.cwd(),
      mcpServers: (this.options.mcpServers ?? []) as never,
    })) as { modes?: SessionModeState | null; configOptions?: SessionConfigOption[] | null } | null
    this.adoptSessionState(loaded)
  }

  /** 另起一个空会话（session/new）；当前会话原样留在 agent 侧 */
  async newSession(): Promise<string> {
    await this.ready
    if (!this.ctx) throw new Error("agent 尚未就绪")
    const created = (await this.ctx.request("session/new", {
      cwd: this.cwd(),
      mcpServers: (this.options.mcpServers ?? []) as never,
    })) as {
      sessionId: string
      modes?: SessionModeState | null
      configOptions?: SessionConfigOption[] | null
    }
    this.currentSessionId = created.sessionId
    // 新建的会话是本次运行创造的，退出时可以按 ephemeral 规则清理
    this.resumed = false
    this.commands = []
    this.adoptSessionState(created)
    return created.sessionId
  }

  /** 删除 agent 侧会话（需 sessionCapabilities.delete） */
  async deleteSession(sessionId: string): Promise<void> {
    await this.ready
    if (!this.ctx) throw new Error("agent 尚未就绪")
    await this.ctx.request("session/delete", { sessionId })
  }

  /** 切换会话模式（需 session/new 返回过 modes） */
  async setMode(modeId: string): Promise<void> {
    await this.ready
    if (!this.ctx || !this.currentSessionId) throw new Error("agent 尚未就绪")
    await this.ctx.request("session/set_mode", { sessionId: this.currentSessionId, modeId })
    if (this.sessionModes) this.sessionModes = { ...this.sessionModes, currentModeId: modeId }
  }

  /**
   * 改一项会话配置（ACP 没有 session/set_model，模型是 category:"model" 的 select 配置项）。
   * 响应总是回带完整配置集，直接采纳。
   */
  async setConfigOption(configId: string, value: string | boolean): Promise<SessionConfigOption[]> {
    await this.ready
    if (!this.ctx || !this.currentSessionId) throw new Error("agent 尚未就绪")
    const params =
      typeof value === "boolean"
        ? { sessionId: this.currentSessionId, configId, type: "boolean" as const, value }
        : { sessionId: this.currentSessionId, configId, value }
    const result = (await this.ctx.request("session/set_config_option", params)) as {
      configOptions?: SessionConfigOption[]
    }
    this.sessionConfigOptions = result.configOptions ?? this.sessionConfigOptions
    this.handlers.onConfigOptions?.(this.sessionConfigOptions)
    return this.sessionConfigOptions
  }

  /**
   * 结束会话。ephemeral（默认开启）且 agent 声明支持 session/delete 时，
   * 退出前删除本次会话，避免临时使用在 agent 侧堆积会话记录。
   * 恢复的会话（--resume）是持久资产，永不删除。
   */
  async stop(): Promise<void> {
    this.stopped = true
    this.rejectReady(new Error("agent 已停止"))
    if (
      this.options.ephemeral !== false &&
      !this.resumed &&
      this.support.deleteSession &&
      this.ctx &&
      this.currentSessionId
    ) {
      try {
        await this.ctx.request(
          "session/delete",
          { sessionId: this.currentSessionId },
          { timeout: 2000 } as never,
        )
      } catch {
        // 删除失败不阻塞退出
      }
    }
    this.proc?.kill()
  }
}

/**
 * 列出 agent 侧的会话（session/list，qodercli 等在 sessionCapabilities.list 声明）。
 * 一次性连接：initialize → session/list → 断开。活着的 AcpClient 请用 listSessions()。
 */
export async function listAgentSessions(cmd: string[]): Promise<AgentSessionInfo[]> {
  const proc = Bun.spawn(cmd, { stdin: "pipe", stdout: "pipe", stderr: "ignore" })
  const sink = proc.stdin as import("bun").FileSink
  const output = new WritableStream<Uint8Array>({
    write: (chunk) => {
      sink.write(chunk)
      void sink.flush()
    },
  })
  const stream = ndJsonStream(output, proc.stdout as ReadableStream<Uint8Array>)
  try {
    return await client().connectWith(stream, async (ctx) => {
      await ctx.request("initialize", { protocolVersion: 1, clientCapabilities: {} })
      const result = (await ctx.request("session/list", {})) as { sessions?: AgentSessionInfo[] }
      return result.sessions ?? []
    })
  } finally {
    proc.kill()
  }
}

export type {
  AgentCapabilities,
  AvailableCommand,
  PermissionOption,
  PlanEntry,
  SessionConfigOption,
  SessionMode,
  SessionModeState,
  StopReason,
  ToolCall,
  ToolCallUpdate,
} from "@agentclientprotocol/sdk"
