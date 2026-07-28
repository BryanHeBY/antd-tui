/**
 * 驱动器：--snapshot 单帧导出与 --drive 交互会话。
 *
 * --drive 协议（stdio NDJSON，Playwright 式）：
 *   → {"id":1,"op":"snapshot","format":"text|ansi|svg"}
 *   → {"id":2,"op":"click","text":"部署"}      // 或 {"x":5,"y":20}，屏幕列坐标
 *   → {"id":3,"op":"type","text":"user-api"}
 *   → {"id":4,"op":"press","key":"tab"}        // tab/enter/escape/up/down/left/right/backspace/home/end 或单字符
 *   → {"id":5,"op":"locate","text":"部署"}     // 返回屏幕坐标，不点击
 *   → {"id":6,"op":"values"}                   // 当前 form.values
 *   → {"id":7,"op":"quit"}
 *   ← {"id":N,"ok":true,...}；输入类操作自动 settle 并回 "frame"（"return":"none" 可省略）
 *   ← 页面完成时穿透 {"event":"submit"|"cancel"}，进程按协议退出码退出
 */
import { createInterface } from "node:readline"
import { writeFileSync } from "node:fs"
import { displayWidth } from "@antd-tui/components"
import { mountHeadless, parseSize, type HeadlessSession } from "./headless"
import { ansiFrame, svgFrame, type SnapshotFormat } from "./snapshot"
import type { PageSchema } from "./validate"

interface DriverArgs {
  format: string
  size?: string
  out?: string
}

const FORMATS = new Set<string>(["text", "ansi", "svg"])
const DEFAULT_SIZE = { width: 80, height: 24 }

function emit(event: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(event) + "\n")
}

function renderFrame(session: HeadlessSession, format: SnapshotFormat): string {
  if (format === "text") return session.setup.captureCharFrame()
  const spans = session.setup.captureSpans()
  return format === "ansi" ? ansiFrame(spans) : svgFrame(spans)
}

export async function runSnapshot(schema: PageSchema, args: DriverArgs): Promise<void> {
  if (!FORMATS.has(args.format)) {
    emit({ event: "error", message: `--format 必须是 text / ansi / svg 之一，收到 "${args.format}"` })
    process.exit(2)
  }
  const size = parseSize(args.size, DEFAULT_SIZE)
  if (!size) {
    emit({ event: "error", message: `--size 必须是 <宽>x<高>（如 100x30），收到 "${args.size}"` })
    process.exit(2)
  }

  const session = await mountHeadless(schema, size.width, size.height)
  const content = renderFrame(session, args.format as SnapshotFormat)
  session.destroy()

  if (args.out) {
    writeFileSync(args.out, content)
    emit({ event: "snapshot", format: args.format, path: args.out })
  } else {
    // snapshot 模式下 stdout 就是内容本身，便于重定向 / 管道
    process.stdout.write(content)
  }
  process.exit(0)
}

/** 命名键 → mockInput 按键序列（KeyCodes 名称）；单字符走 typeText */
const KEY_NAME_MAP: Record<string, string> = {
  tab: "TAB",
  enter: "RETURN",
  escape: "ESCAPE",
  up: "ARROW_UP",
  down: "ARROW_DOWN",
  left: "ARROW_LEFT",
  right: "ARROW_RIGHT",
  backspace: "BACKSPACE",
  delete: "DELETE",
  home: "HOME",
  end: "END",
}

interface DriveCommand {
  id?: number | string
  op?: string
  format?: string
  text?: string
  key?: string
  x?: number
  y?: number
  timeout?: number
  return?: string
}

/** 在字符帧里按可见文本定位，返回屏幕列坐标（宽字符占 2 列，需换算） */
function locateText(session: HeadlessSession, text: string): { x: number; y: number } | null {
  const lines = session.setup.captureCharFrame().split("\n")
  for (let y = 0; y < lines.length; y++) {
    const idx = lines[y]!.indexOf(text)
    if (idx >= 0) {
      const x = displayWidth(lines[y]!.slice(0, idx))
      // 点击目标中部，避免命中边缘装饰字符
      return { x: x + Math.floor(displayWidth(text) / 2), y }
    }
  }
  return null
}

export async function runDrive(schema: PageSchema, args: DriverArgs): Promise<void> {
  const size = parseSize(args.size, DEFAULT_SIZE)
  if (!size) {
    emit({ event: "error", message: `--size 必须是 <宽>x<高>（如 100x30），收到 "${args.size}"` })
    process.exit(2)
  }

  const session = await mountHeadless(schema, size.width, size.height)
  emit({ event: "ready", cols: size.width, rows: size.height })

  /** 页面完成（提交/取消）则穿透事件并按协议退出 */
  const exitIfFinished = () => {
    const finish = session.finished()
    if (!finish) return
    session.destroy()
    emit(finish)
    process.exit(finish.event === "submit" ? 0 : 1)
  }

  const respond = (cmd: DriveCommand, payload: Record<string, unknown>) => {
    emit({ id: cmd.id ?? null, ...payload })
  }

  /** 输入类操作的统一收尾：settle → 检查完成 → 按需回帧 */
  const afterInput = async (cmd: DriveCommand) => {
    await session.settle()
    exitIfFinished()
    if (cmd.return === "none") {
      respond(cmd, { ok: true })
    } else {
      const format = FORMATS.has(cmd.return ?? "") ? (cmd.return as SnapshotFormat) : "text"
      respond(cmd, { ok: true, frame: renderFrame(session, format) })
    }
  }

  const rl = createInterface({ input: process.stdin })
  for await (const line of rl) {
    const raw = line.trim()
    if (raw === "") continue
    let cmd: DriveCommand
    try {
      cmd = JSON.parse(raw) as DriveCommand
    } catch {
      emit({ id: null, ok: false, error: `指令不是合法 JSON：${raw.slice(0, 80)}` })
      continue
    }

    try {
      switch (cmd.op) {
        case "snapshot": {
          const format = FORMATS.has(cmd.format ?? "") ? (cmd.format as SnapshotFormat) : "text"
          respond(cmd, { ok: true, frame: renderFrame(session, format) })
          break
        }
        case "locate": {
          if (typeof cmd.text !== "string") {
            respond(cmd, { ok: false, error: "locate 需要 text 字段" })
            break
          }
          const pos = locateText(session, cmd.text)
          if (pos) respond(cmd, { ok: true, x: pos.x, y: pos.y })
          else respond(cmd, { ok: false, error: `帧中找不到文本 "${cmd.text}"` })
          break
        }
        case "wait": {
          // 轮询 settle 直到帧里出现目标文本：校验反馈 / Spin 消失等异步 UI 用它同步
          if (typeof cmd.text !== "string") {
            respond(cmd, { ok: false, error: "wait 需要 text 字段" })
            break
          }
          const deadline = Date.now() + (cmd.timeout ?? 2000)
          let found = session.setup.captureCharFrame().includes(cmd.text)
          while (!found && Date.now() < deadline) {
            await session.settle()
            exitIfFinished()
            found = session.setup.captureCharFrame().includes(cmd.text)
          }
          if (!found) {
            respond(cmd, { ok: false, error: `等待超时：帧中未出现 "${cmd.text}"` })
          } else if (cmd.return === "none") {
            respond(cmd, { ok: true })
          } else {
            const format = FORMATS.has(cmd.return ?? "") ? (cmd.return as SnapshotFormat) : "text"
            respond(cmd, { ok: true, frame: renderFrame(session, format) })
          }
          break
        }
        case "click": {
          let x = cmd.x
          let y = cmd.y
          if (typeof cmd.text === "string") {
            const pos = locateText(session, cmd.text)
            if (!pos) {
              respond(cmd, { ok: false, error: `帧中找不到文本 "${cmd.text}"` })
              break
            }
            x = pos.x
            y = pos.y
          }
          if (typeof x !== "number" || typeof y !== "number") {
            respond(cmd, { ok: false, error: "click 需要 text 或 x/y 坐标" })
            break
          }
          await session.setup.mockMouse.click(x, y)
          await afterInput(cmd)
          break
        }
        case "type": {
          if (typeof cmd.text !== "string") {
            respond(cmd, { ok: false, error: "type 需要 text 字段" })
            break
          }
          await session.setup.mockInput.typeText(cmd.text)
          await afterInput(cmd)
          break
        }
        case "press": {
          const key = cmd.key ?? ""
          const mapped = KEY_NAME_MAP[key.toLowerCase()]
          if (mapped) {
            session.setup.mockInput.pressKey(mapped as never)
            if (key.toLowerCase() === "escape") {
              // legacy 键盘协议下 ESC 是转义序列前缀，parser 歧义等待超时后才发事件
              await new Promise((resolve) => setTimeout(resolve, 80))
            }
          } else if (key.length === 1) {
            await session.setup.mockInput.typeText(key)
          } else {
            respond(cmd, {
              ok: false,
              error: `press 不认识按键 "${key}"（可用：${Object.keys(KEY_NAME_MAP).join("/")} 或单字符）`,
            })
            break
          }
          await afterInput(cmd)
          break
        }
        case "values": {
          respond(cmd, { ok: true, values: session.values() })
          break
        }
        case "quit": {
          respond(cmd, { ok: true })
          session.destroy()
          emit({ event: "cancel" })
          process.exit(1)
          break
        }
        default:
          respond(cmd, {
            ok: false,
            error: `未知操作 "${String(cmd.op)}"（可用：snapshot/locate/wait/click/type/press/values/quit）`,
          })
      }
    } catch (err) {
      respond(cmd, { ok: false, error: (err as Error).message })
    }
  }

  // stdin 关闭：视为放弃会话
  session.destroy()
  emit({ event: "cancel" })
  process.exit(1)
}
