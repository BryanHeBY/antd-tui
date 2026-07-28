/**
 * antd-tui engine CLI
 *
 * 用法：
 *   engine --schema <path>          从文件读取页面 Schema
 *   engine --schema-json '<json>'   从参数读取页面 Schema
 *   engine --stdin                  从 stdin 读取页面 Schema（管道场景）
 *   engine ... --dry-run            仅校验页面 Schema，不渲染
 *
 * 输出协议（NDJSON，stdout；TUI 渲染期间不写 stdout，结果在退出前输出）：
 *   {"event":"valid"}                          --dry-run 校验通过
 *   {"event":"submit","values":{...}}          用户提交
 *   {"event":"cancel"}                         用户取消（Esc / 取消按钮）
 *   {"event":"invalid","errors":[...]}         页面 Schema 校验失败
 *   {"event":"error","message":"..."}          运行错误
 *
 * 退出码：0=submit/valid  1=cancel  2=页面 Schema 无效  3=环境不满足
 */
import { readFileSync } from "node:fs"
import { componentWhitelist } from "@antd-tui/formily"
import { validatePageSchema, type PageSchema } from "./validate"

interface CliArgs {
  schemaPath?: string
  schemaJson?: string
  useStdin: boolean
  dryRun: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { useStdin: false, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--schema":
        args.schemaPath = argv[++i]
        break
      case "--schema-json":
        args.schemaJson = argv[++i]
        break
      case "--stdin":
        args.useStdin = true
        break
      case "--dry-run":
        args.dryRun = true
        break
    }
  }
  return args
}

function emit(event: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(event) + "\n")
}

async function readStdinToEnd(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf-8")
}

async function loadSchemaText(args: CliArgs): Promise<string> {
  if (args.schemaJson !== undefined) return args.schemaJson
  if (args.schemaPath !== undefined) return readFileSync(args.schemaPath, "utf-8")
  if (args.useStdin) return readStdinToEnd()
  throw new Error("必须提供 --schema <path>、--schema-json <json> 或 --stdin 之一")
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  let schemaText: string
  try {
    schemaText = await loadSchemaText(args)
  } catch (err) {
    emit({ event: "error", message: (err as Error).message })
    process.exit(2)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(schemaText)
  } catch (err) {
    emit({ event: "invalid", errors: [`JSON 解析失败: ${(err as Error).message}`] })
    process.exit(2)
  }

  const result = validatePageSchema(parsed, componentWhitelist)
  if (!result.ok) {
    emit({ event: "invalid", errors: result.errors })
    process.exit(2)
  }

  if (args.dryRun) {
    emit({ event: "valid" })
    process.exit(0)
  }

  if (!process.stdout.isTTY) {
    emit({ event: "error", message: "stdout 不是 TTY，无法渲染 TUI（可用 --dry-run 仅校验）" })
    process.exit(3)
  }

  // 渲染依赖延迟加载：--dry-run / 校验失败路径不加载 native renderer
  const [{ createCliRenderer }, { createRoot }, React, { App }] = await Promise.all([
    import("@opentui/core"),
    import("@opentui/react"),
    import("react"),
    import("./App"),
  ])

  const schema = parsed as unknown as PageSchema
  const renderer = await createCliRenderer({ exitOnCtrlC: true })

  const teardown = () => {
    try {
      const r = renderer as unknown as { destroy?: () => void; stop?: () => void }
      r.destroy?.()
      r.stop?.()
    } catch {
      // 忽略销毁阶段错误，保证结果能输出
    }
  }

  createRoot(renderer).render(
    React.createElement(App, {
      schema,
      onFinish: (values: Record<string, unknown>) => {
        teardown()
        emit({ event: "submit", values })
        process.exit(0)
      },
      onCancel: () => {
        teardown()
        emit({ event: "cancel" })
        process.exit(1)
      },
    }),
  )
}

main().catch((err) => {
  emit({ event: "error", message: (err as Error).stack ?? String(err) })
  process.exit(3)
})
