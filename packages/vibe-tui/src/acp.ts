/**
 * ACP 客户端桥：基于官方 @agentclientprotocol/sdk（不自研 JSON-RPC）。
 *
 * vibe-tui 是 client，agent 是子进程（NDJSON stdio）：
 *   client → agent：initialize / session/new / session/prompt（人类输入与页面事件都走 prompt）
 *   agent → client 通知：session/update（流式文本，喂状态行）
 *   agent → client 扩展请求：_vibetui/render { schema } —— 渲染/替换画板页面，
 *     校验失败时响应携带 errors，agent 可据此自修
 */
import { client, ndJsonStream, type ActiveSession } from "@agentclientprotocol/sdk"

export interface RenderResult {
  ok: boolean
  errors?: string[]
}

export interface AcpClientHandlers {
  /** agent 请求渲染页面；返回校验结果 */
  onRender: (schema: unknown) => RenderResult
  /** session/update 流式文本片段 */
  onUpdate: (text: string) => void
  /** agent 进程退出 */
  onExit: (code: number | null) => void
}

export class AcpClient {
  private proc: ReturnType<typeof Bun.spawn> | null = null
  private session: ActiveSession | null = null
  private stopped = false
  private readyResolve: (() => void) | null = null
  private readonly ready = new Promise<void>((resolve) => {
    this.readyResolve = resolve
  })

  constructor(
    private readonly cmd: string[],
    private readonly handlers: AcpClientHandlers,
  ) {}

  async start(): Promise<void> {
    this.proc = Bun.spawn(this.cmd, { stdin: "pipe", stdout: "pipe", stderr: "ignore" })
    const sink = this.proc.stdin as import("bun").FileSink
    const output = new WritableStream<Uint8Array>({
      write: (chunk) => {
        sink.write(chunk)
        void sink.flush()
      },
    })
    const stream = ndJsonStream(output, this.proc.stdout as ReadableStream<Uint8Array>)

    void this.proc.exited.then((code) => {
      if (!this.stopped) this.handlers.onExit(code)
    })

    const app = client().onRequest(
      "_vibetui/render",
      (params: unknown) => params as { schema: unknown },
      (cx) => this.handlers.onRender(cx.params.schema),
    )

    // 长驻连接：建会话后持续泵 session/update 到状态行，连接关闭时结束
    void app
      .connectWith(stream, async (ctx) => {
        await ctx.request("initialize", { protocolVersion: 1, clientCapabilities: {} })
        const session = await ctx.buildSession(process.cwd()).start()
        this.session = session
        this.readyResolve?.()
        for (;;) {
          const msg = await session.nextUpdate()
          if (msg.kind === "session_update") {
            const update = msg.update as { content?: { text?: string } }
            if (update.content?.text) this.handlers.onUpdate(update.content.text)
          }
          // stop 消息 = 一轮 prompt 结束，继续等下一轮
        }
      })
      .catch(() => {
        // 连接断开（agent 退出/被 stop）：onExit 已另行通知
      })

    await this.ready
  }

  /** 发送一轮 prompt（人类输入或页面事件回流）；不阻塞等待轮次结束 */
  prompt(text: string): void {
    void this.ready.then(() => {
      void this.session?.prompt(text).catch(() => {
        // 轮次失败不致命：agent 侧可经 session/update 反馈
      })
    })
  }

  stop(): void {
    this.stopped = true
    this.proc?.kill()
  }
}
