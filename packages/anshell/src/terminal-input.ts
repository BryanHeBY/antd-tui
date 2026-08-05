import type { ParsedKey } from "@opentui/core"
import { encodeKey, encodePaste } from "@antd-tui/anterm"

/** 输入桥只依赖 PTY 会话的最小写接口，便于脱离 React 独立测试。 */
export interface TerminalInputSession {
  write(data: string): void
  readonly applicationCursorKeys: boolean
  readonly bracketedPaste: boolean
}

/**
 * 管理 DraftCard 提交到 PTY session 就绪之间的输入交接。
 *
 * 提交命令后 React 需要一帧才能挂载 TerminalCard 并创建 session；这段窗口内的按键
 * 不能落回旧草稿，也不能丢失，因此先排队，attach 后按原顺序冲刷。
 */
export class TerminalInputHandoff {
  private launching = false
  private session: TerminalInputSession | null = null
  private queue: string[] = []

  get active(): boolean {
    return this.launching || this.session !== null
  }

  begin(): void {
    this.launching = true
    this.session = null
    this.queue = []
  }

  attach(session: TerminalInputSession): void {
    this.session = session
    this.launching = false
    for (const bytes of this.queue) session.write(bytes)
    this.queue = []
  }

  release(session: TerminalInputSession): boolean {
    if (this.session !== session) return false
    this.session = null
    this.launching = false
    this.queue = []
    return true
  }

  writeKey(key: ParsedKey): void {
    if (!this.active) return
    const bytes = encodeKey(key, {
      applicationCursorKeys: this.session?.applicationCursorKeys ?? false,
    })
    if (bytes !== null) this.writeOrQueue(bytes)
  }

  writePaste(text: string): void {
    if (!this.active) return
    const bytes = this.session ? encodePaste(text, this.session.bracketedPaste) : text
    this.writeOrQueue(bytes)
  }

  private writeOrQueue(bytes: string): void {
    if (this.session) this.session.write(bytes)
    else if (this.launching) this.queue.push(bytes)
  }
}
