/**
 * 驱动器：--snapshot 单帧导出。
 */
import { writeFileSync } from "node:fs"
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
