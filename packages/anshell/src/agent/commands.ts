import type { AcpSupport, AvailableCommand, SessionConfigOption, SessionModeState } from "@antd-tui/acp"

/**
 * 斜杠命令表：本地命令（映射到真正的 ACP 方法）与 agent 推来的命令
 * （available_commands_update，最终编译成 session/prompt 文本）合流成同一个命名空间。
 */
/** 内联菜单最多展示的候选数：两边（渲染与键盘导航）必须用同一个上限。 */
export const SLASH_MENU_LIMIT = 8

export interface SlashCommand {
  /** 不带斜杠的命令名，与 ACP 的 AvailableCommand.name 同构 */
  name: string
  description: string
  /** 参数提示；agent 命令取自 AvailableCommandInput.hint */
  hint?: string
  source: "local" | "agent"
}

export interface SlashContext {
  /** agent 已连上（未配置 --agent 时只剩 /help） */
  agentReady: boolean
  support: AcpSupport | null
  modes: SessionModeState | null
  configOptions: SessionConfigOption[]
  agentCommands: AvailableCommand[]
}

export interface ParsedSlash {
  name: string
  /** 命令名之后的原始文本（已 trim） */
  rest: string
}

/**
 * 是否把整行当斜杠命令解释。
 *
 * 只认「/ 开头且首词里没有第二个 /」：`/usr/bin/ls`、`/tmp/x.sh` 仍然是可执行路径，
 * 必须留给 shell 分诊，否则斜杠层会把绝对路径命令整片吃掉。
 */
export function parseSlash(input: string): ParsedSlash | null {
  const line = input.trimStart()
  if (!line.startsWith("/")) return null
  const spaceAt = line.search(/\s/)
  const head = spaceAt < 0 ? line : line.slice(0, spaceAt)
  const name = head.slice(1)
  if (name.includes("/")) return null
  return { name, rest: spaceAt < 0 ? "" : line.slice(spaceAt).trim() }
}

/** 模型选择在 ACP 里是 category:"model" 的 select 配置项，没有独立方法。 */
export function findModelOption(options: SessionConfigOption[]): SessionConfigOption | null {
  return options.find((option) => option.category === "model" && option.type === "select") ?? null
}

/** 当前可用命令：本地命令按 agent 声明的能力过滤，agent 命令原样并入。 */
export function listCommands(ctx: SlashContext): SlashCommand[] {
  const local: SlashCommand[] = [
    { name: "help", description: "列出可用命令", source: "local" },
  ]
  if (ctx.agentReady) {
    if (ctx.support?.listSessions || ctx.support?.loadSession) {
      local.push({
        name: "session",
        description: "会话：无参列出，new 新建，load <id> 切换，delete <id> 删除",
        hint: "new | load <id> | delete <id>",
        source: "local",
      })
    }
    if (ctx.support?.setMode) {
      local.push({ name: "mode", description: "会话模式：无参列出，带 id 切换", hint: "<modeId>", source: "local" })
    }
    if (findModelOption(ctx.configOptions)) {
      local.push({ name: "model", description: "模型：无参列出，带值切换", hint: "<value>", source: "local" })
    }
    local.push({ name: "cancel", description: "中断 agent 当前轮次（session/cancel）", source: "local" })
    local.push({ name: "usage", description: "上下文占用与费用", source: "local" })
    local.push({ name: "permissions", description: "权限记忆与审计；reset 清空", hint: "reset", source: "local" })
  }
  const agent: SlashCommand[] = ctx.agentCommands.map((command) => ({
    name: command.name,
    description: command.description,
    hint: command.input?.hint,
    source: "agent",
  }))
  // 本地命令优先：agent 若推来同名命令，本地语义仍然生效，避免 /session 被劫持
  const seen = new Set(local.map((command) => command.name))
  return [...local, ...agent.filter((command) => !seen.has(command.name))]
}

/** 按已敲入的前缀过滤候选（输入不是斜杠开头时无候选）。 */
export function matchCommands(input: string, ctx: SlashContext): SlashCommand[] {
  const parsed = parseSlash(input)
  if (!parsed) return []
  const all = listCommands(ctx)
  // 已经敲完命令名并带上参数后不再展示候选，避免菜单挡住参数输入
  if (parsed.rest !== "" || /\s$/.test(input)) {
    return all.filter((command) => command.name === parsed.name)
  }
  const prefix = parsed.name.toLowerCase()
  return all.filter((command) => command.name.toLowerCase().startsWith(prefix))
}

/** 把 agent 命令编译成 prompt 文本：ACP 没有 execute 方法，命令就是一段约定文本。 */
export function compileAgentCommand(name: string, rest: string): string {
  return rest === "" ? `/${name}` : `/${name} ${rest}`
}
