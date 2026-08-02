/**
 * ACP 客户端桥：基于官方 @agentclientprotocol/sdk（不自研 JSON-RPC）。
 *
 * vibe-tui 是 client，agent 是子进程（NDJSON stdio）：
 *   client → agent：initialize / session/new 或 session/load（复用会话，历史回放）
 *                    / session/prompt（人类输入与页面事件都走 prompt）
 *   agent → client 通知：session/update（流式文本，喂状态行；load 的历史回放同通道）
 * 画布由 agent 经注入的 MCP 工具（vibetui_eval 操作 $ui 活对象树）驱动，不走 ACP 扩展。
 */
import { client, ndJsonStream, type ClientContext } from "@agentclientprotocol/sdk"

/**
 * ACP agent 可能还要解压运行时、启动 app-server、恢复认证状态；10 秒只适合轻量 mock。
 * 保持调用方可覆盖，避免把真实 agent 的冷启动误报为协议连接失败。
 */
const DEFAULT_STARTUP_TIMEOUT_MS = 60_000

export interface AcpClientHandlers {
  /** session/update 流式文本片段（chunk 是碎片而非整行，由上层拼接） */
  onUpdate: (text: string) => void
  /** 一轮 prompt 结束，上层可冲刷未完的流式行 */
  onTurnEnd?: () => void
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
}

interface SessionUpdateParams {
  sessionId?: string
  update?: { content?: { text?: string } }
}

interface PermissionRequestParams {
  toolCall?: { title?: string }
  options?: Array<{ optionId: string; kind?: string }>
}

export class AcpClient {
  private proc: ReturnType<typeof Bun.spawn> | null = null
  private sessionId: string | null = null
  private resumed = false
  private ctx: ClientContext | null = null
  private canDeleteSession = false
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

  private notifyExit(code: number | null): void {
    if (this.exitNotified || this.stopped) return
    this.exitNotified = true
    this.handlers.onExit(code)
  }

  async start(): Promise<void> {
    try {
      this.proc = Bun.spawn(this.cmd, { stdin: "pipe", stdout: "pipe", stderr: "ignore" })
    } catch (err) {
      const error = new Error(`无法启动 agent：${(err as Error).message}`)
      this.rejectReady(error)
      throw error
    }

    const startupTimeoutMs = this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS
    if (startupTimeoutMs > 0) {
      this.startupTimer = setTimeout(() => {
        this.rejectReady(new Error(`等待 agent 初始化超时（${startupTimeoutMs}ms）`))
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
      this.rejectReady(new Error(`agent 在初始化完成前退出（code ${code ?? "?"}）`))
      this.notifyExit(code)
    }
    void this.proc.exited.then(handleExit)

    const app = client()
      // 统一的 update 通道：新会话的流式输出与 session/load 的历史回放走同一处理
      .onNotification("session/update", (cx) => {
        const params = cx.params as SessionUpdateParams
        if (this.sessionId && params.sessionId !== this.sessionId) return
        const text = params.update?.content?.text
        if (text) this.handlers.onUpdate(text)
      })
      // 工具权限自动放行：vibe-tui 是 agent 自治画布，交互式确认会卡死无人值守闭环。
      // 优先选 allow_always 减少重复请求；日志里留痕保证透明。
      .onRequest(
        "session/request_permission",
        (params: unknown) => params as PermissionRequestParams,
        (cx) => {
          const options = cx.params.options ?? []
          const pick =
            options.find((o) => o.kind === "allow_always") ??
            options.find((o) => o.kind === "allow_once") ??
            options[0]
          if (!pick) return { outcome: { outcome: "cancelled" as const } }
          this.handlers.onUpdate(`[自动授权] ${cx.params.toolCall?.title ?? "工具调用"}\n`)
          return { outcome: { outcome: "selected" as const, optionId: pick.optionId } }
        },
      )

    // 长驻连接：会话建立后保持挂起，通知经上面的 handler 分发，连接关闭时结束
    void app
      .connectWith(stream, async (ctx) => {
        this.ctx = ctx
        const init = (await ctx.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: {},
        })) as {
          agentCapabilities?: { loadSession?: boolean; sessionCapabilities?: { delete?: unknown } }
        }
        // ACP 用 null/undefined 都表示未声明该能力；只有对象才代表支持 delete。
        this.canDeleteSession = init.agentCapabilities?.sessionCapabilities?.delete != null

        if (this.options.sessionId) {
          if (init.agentCapabilities?.loadSession !== true) {
            throw new Error("该 agent 不支持恢复会话（未声明 loadSession 能力）")
          }
          // 先记 sessionId：load 期间历史就开始经 session/update 回放
          this.sessionId = this.options.sessionId
          this.resumed = true
          await ctx.request("session/load", {
            sessionId: this.options.sessionId,
            cwd: process.cwd(),
            mcpServers: (this.options.mcpServers ?? []) as never,
          })
        } else {
          const created = (await ctx.request("session/new", {
            cwd: process.cwd(),
            mcpServers: (this.options.mcpServers ?? []) as never,
          })) as { sessionId: string }
          this.sessionId = created.sessionId
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
        this.rejectReady(new Error(`ACP 连接失败：${err instanceof Error ? err.message : String(err)}`))
      })

    await this.ready
  }

  /** 在途 prompt 轮次计数：>0 即 agent 运行中 */
  private inflight = 0

  private trackTurn(delta: 1 | -1): void {
    const wasBusy = this.inflight > 0
    this.inflight = Math.max(0, this.inflight + delta)
    const busy = this.inflight > 0
    if (busy !== wasBusy) this.handlers.onBusy?.(busy)
  }

  /** 发送一轮 prompt（人类输入或页面事件回流）；轮次结束时触发 onTurnEnd */
  prompt(text: string): void {
    this.trackTurn(1)
    void this.ready
      .then(() => {
        if (!this.ctx || !this.sessionId) {
          this.trackTurn(-1)
          return
        }
        void this.ctx
          .request("session/prompt", {
            sessionId: this.sessionId,
            prompt: [{ type: "text", text }],
          })
          .then(() => this.handlers.onTurnEnd?.())
          .catch(() => {
            // 轮次失败不致命：agent 侧可经 session/update 反馈
          })
          .finally(() => this.trackTurn(-1))
      })
      .catch(() => {
        // agent 尚未成功启动或已退出：丢弃无法送达的输入，避免未处理拒绝。
        this.trackTurn(-1)
      })
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
      this.canDeleteSession &&
      this.ctx &&
      this.sessionId
    ) {
      try {
        await this.ctx.request(
          "session/delete",
          { sessionId: this.sessionId },
          { timeout: 2000 } as never,
        )
      } catch {
        // 删除失败不阻塞退出
      }
    }
    this.proc?.kill()
  }
}

export interface AgentSessionInfo {
  sessionId: string
  title?: string
  cwd?: string
  updatedAt?: string
}

/**
 * 列出 agent 侧的会话（session/list，qodercli 等在 sessionCapabilities.list 声明）。
 * 一次性连接：initialize → session/list → 断开。
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
