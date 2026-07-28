/**
 * ACP 客户端桥：基于官方 @agentclientprotocol/sdk（不自研 JSON-RPC）。
 *
 * vibe-tui 是 client，agent 是子进程（NDJSON stdio）：
 *   client → agent：initialize / session/new / session/prompt（人类输入与页面事件都走 prompt）
 *   agent → client 通知：session/update（流式文本，喂状态行）
 *   agent → client 扩展请求：_vibetui/render { schema } —— 渲染/替换画板页面，
 *     校验失败时响应携带 errors，agent 可据此自修
 */
import { client, ndJsonStream, type ActiveSession, type ClientContext } from "@agentclientprotocol/sdk"

export interface RenderResult {
  ok: boolean
  errors?: string[]
}

export interface AcpClientHandlers {
  /** agent 请求渲染页面；返回校验结果 */
  onRender: (schema: unknown) => RenderResult
  /** session/update 流式文本片段（chunk 是碎片而非整行，由上层拼接） */
  onUpdate: (text: string) => void
  /** 一轮 prompt 结束（stop 消息），上层可冲刷未完的流式行 */
  onTurnEnd?: () => void
  /** agent 进程退出 */
  onExit: (code: number | null) => void
}

export interface AcpClientOptions {
  /** 退出时删除临时 ACP session，默认开启 */
  ephemeral?: boolean
  /** 等待 initialize + session/new 完成的最长时间，默认 10 秒 */
  startupTimeoutMs?: number
}

export class AcpClient {
  private proc: ReturnType<typeof Bun.spawn> | null = null
  private session: ActiveSession | null = null
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

    const startupTimeoutMs = this.options.startupTimeoutMs ?? 10_000
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

    const app = client().onRequest(
      "_vibetui/render",
      (params: unknown) => params as { schema: unknown },
      (cx) => this.handlers.onRender(cx.params.schema),
    )

    // 长驻连接：建会话后持续泵 session/update 到状态行，连接关闭时结束
    void app
      .connectWith(stream, async (ctx) => {
        this.ctx = ctx
        const init = (await ctx.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: {},
        })) as { agentCapabilities?: { sessionCapabilities?: { delete?: unknown } } }
        // ACP 用 null/undefined 都表示未声明该能力；只有对象才代表支持 delete。
        this.canDeleteSession = init.agentCapabilities?.sessionCapabilities?.delete != null
        const session = await ctx.buildSession(process.cwd()).start()
        this.session = session
        this.resolveReady()
        for (;;) {
          const msg = await session.nextUpdate()
          if (msg.kind === "session_update") {
            const update = msg.update as { content?: { text?: string } }
            if (update.content?.text) this.handlers.onUpdate(update.content.text)
          } else if (msg.kind === "stop") {
            // 一轮 prompt 结束，通知上层冲刷流式缓冲，继续等下一轮
            this.handlers.onTurnEnd?.()
          }
        }
      })
      .catch(async (err: unknown) => {
        // initialize/session/new 失败时必须让 start() 返回失败，不能永远停在「启动中」。
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

  /** 发送一轮 prompt（人类输入或页面事件回流）；不阻塞等待轮次结束 */
  prompt(text: string): void {
    void this.ready.then(() => {
      void this.session?.prompt(text).catch(() => {
        // 轮次失败不致命：agent 侧可经 session/update 反馈
      })
    }).catch(() => {
      // agent 尚未成功启动或已退出：丢弃无法送达的输入，避免未处理拒绝。
    })
  }

  /**
   * 结束会话。ephemeral（默认开启）且 agent 声明支持 session/delete 时，
   * 退出前删除本次会话，避免临时使用在 agent 侧堆积会话记录。
   */
  async stop(): Promise<void> {
    this.stopped = true
    this.rejectReady(new Error("agent 已停止"))
    if (this.options.ephemeral !== false && this.canDeleteSession && this.ctx && this.session) {
      try {
        await this.ctx.request(
          "session/delete",
          { sessionId: this.session.sessionId },
          { timeout: 2000 } as never,
        )
      } catch {
        // 删除失败不阻塞退出
      }
    }
    this.proc?.kill()
  }
}
