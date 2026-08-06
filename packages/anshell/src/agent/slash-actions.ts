import type {
  AcpClient,
  AvailableCommand,
  SessionConfigOption,
  SessionModeState,
} from "@antd-tui/acp"
import type { CommandRow } from "../types"
import type { TranscriptApi } from "../ui/transcript"
import { compileAgentCommand, findModelOption, listCommands, type SlashContext } from "./commands"
import type { PermissionPolicy } from "./permissions"

/**
 * 斜杠命令执行的依赖。Anshell 在调用点用 ref/state 组装，把 React 细节挡在外面——
 * 这个模块只描述「命令 → ACP 方法 / prompt 文本」的映射，纯逻辑、无 hook。
 */
export interface SlashRunnerDeps {
  transcript: TranscriptApi
  /** 当前 ACP 客户端；未接 agent 时为 null（本地命令给出提示） */
  client: AcpClient | null
  slashContext: SlashContext
  /** 最近一次 usage_update 的展示串 */
  usage: string | null
  policy: PermissionPolicy
  cwd: string
  /** 会话切换后把 agent 的命令表/模式/配置同步回 React */
  setAgentCommands: (commands: AvailableCommand[]) => void
  setAgentModes: (modes: SessionModeState | null) => void
  setAgentConfig: (options: SessionConfigOption[]) => void
}

/**
 * 执行一条斜杠命令：本地命令映射到真正的 ACP 方法（会话/模式/模型/取消/用量/权限），
 * 其余名字按 agent 命令处理——ACP 没有 execute 方法，命令就是一段约定 prompt 文本。
 */
export function runSlashCommand(name: string, rest: string, deps: SlashRunnerDeps): void {
  const { transcript: t, client, cwd, policy } = deps
  const say = (text: string): CommandRow[] => [{ primary: text }]
  const requireAgent = (): boolean => {
    if (client) return true
    t.addCommand(name, rest, cwd, [
      { primary: "未配置 agent", detail: "用 ansh --agent \"<命令>\" 接入", tone: "error" },
    ])
    return false
  }
  const fail = (id: number) => (err: Error) =>
    t.setCommandRows(id, [{ primary: "失败", detail: err.message, tone: "error" }])
  const pending = (): CommandRow[] => [{ primary: "…" }]

  switch (name) {
    case "help": {
      t.addCommand(
        name,
        rest,
        cwd,
        listCommands(deps.slashContext).map((command) => ({
          primary: `/${command.name}`,
          hint: command.hint,
          detail: command.description,
          note: command.source === "agent" ? "· agent" : undefined,
          current: true,
        })),
      )
      return
    }
    case "session": {
      if (!requireAgent()) return
      const [verb, arg] = rest.split(/\s+/).filter(Boolean)
      const id = t.addCommand(name, rest, cwd, pending())
      if (verb === undefined) {
        void client!
          .listSessions()
          .then((sessions) =>
            t.setCommandRows(id, [
              { marker: "当前会话", primary: client!.sessionId ?? "—", current: true },
              ...sessions.map((session) => {
                const isCurrent = session.sessionId === client!.sessionId
                return {
                  marker: isCurrent ? "▸" : " ",
                  primary: session.sessionId,
                  current: isCurrent,
                  detail: [session.updatedAt, session.title].filter(Boolean).join("  "),
                }
              }),
              ...(sessions.length === 0 ? [{ primary: "（agent 未返回会话列表）" }] : []),
            ]),
          )
          .catch(fail(id))
        return
      }
      if (verb === "new") {
        void client!
          .newSession()
          .then((sessionId) => {
            deps.setAgentCommands(client!.availableCommands)
            deps.setAgentModes(client!.modes)
            deps.setAgentConfig(client!.configOptions)
            t.setCommandRows(id, [{ marker: "已新建会话", primary: sessionId, current: true }])
          })
          .catch(fail(id))
        return
      }
      if (verb === "load" && arg) {
        void client!
          .loadSession(arg)
          .then(() => {
            deps.setAgentModes(client!.modes)
            deps.setAgentConfig(client!.configOptions)
            t.setCommandRows(id, [
              { marker: "已切换到会话", primary: arg, detail: "历史经 session/update 回放", current: true },
            ])
          })
          .catch(fail(id))
        return
      }
      if (verb === "delete" && arg) {
        void client!
          .deleteSession(arg)
          .then(() => t.setCommandRows(id, [{ marker: "已删除会话", primary: arg }]))
          .catch(fail(id))
        return
      }
      t.setCommandRows(id, [{ primary: "用法", detail: "/session [new | load <id> | delete <id>]" }])
      return
    }
    case "mode": {
      if (!requireAgent()) return
      const modes = client!.modes
      if (!modes) {
        t.addCommand(name, rest, cwd, say("该 agent 未声明会话模式"))
        return
      }
      if (rest === "") {
        t.addCommand(
          name,
          rest,
          cwd,
          modes.availableModes.map((mode) => {
            const isCurrent = mode.id === modes.currentModeId
            return {
              marker: isCurrent ? "▸" : " ",
              primary: mode.id,
              current: isCurrent,
              detail: [mode.name === mode.id ? "" : mode.name, mode.description ?? ""]
                .filter(Boolean)
                .join("  "),
            }
          }),
        )
        return
      }
      const id = t.addCommand(name, rest, cwd, pending())
      void client!
        .setMode(rest)
        .then(() => {
          deps.setAgentModes(client!.modes)
          t.setCommandRows(id, [{ marker: "已切到模式", primary: rest, current: true }])
        })
        .catch(fail(id))
      return
    }
    case "model": {
      if (!requireAgent()) return
      const option = findModelOption(client!.configOptions)
      if (!option || option.type !== "select") {
        t.addCommand(name, rest, cwd, say("该 agent 未提供模型配置项"))
        return
      }
      const choices = option.options.flatMap((entry) => ("group" in entry ? entry.options : [entry]))
      if (rest === "") {
        t.addCommand(
          name,
          rest,
          cwd,
          choices.map((choice) => {
            const isCurrent = choice.value === option.currentValue
            return {
              marker: isCurrent ? "▸" : " ",
              primary: choice.value,
              current: isCurrent,
              detail: choice.name,
            }
          }),
        )
        return
      }
      const id = t.addCommand(name, rest, cwd, pending())
      void client!
        .setConfigOption(option.id, rest)
        .then((options) => {
          deps.setAgentConfig(options)
          t.setCommandRows(id, [{ marker: "已切到", primary: rest, current: true }])
        })
        .catch(fail(id))
      return
    }
    case "cancel": {
      if (!requireAgent()) return
      client!.cancel()
      t.addCommand(name, rest, cwd, say("已发送 session/cancel"))
      return
    }
    case "usage": {
      if (!requireAgent()) return
      t.addCommand(
        name,
        rest,
        cwd,
        deps.usage ? [{ marker: "上下文", primary: deps.usage, current: true }] : say("agent 未上报 usage"),
      )
      return
    }
    case "permissions": {
      if (rest === "reset") {
        const count = policy.forget()
        t.addCommand(name, rest, cwd, [{ primary: `已清空 ${count} 条权限记忆`, detail: "审计流水保留" }])
        return
      }
      const rows: CommandRow[] = [
        ...[...policy.memory.entries()].map(([tool, decision]) => ({
          marker: "记忆",
          primary: tool,
          detail: `→ ${decision.option}（${decision.kind}）`,
          current: true,
        })),
        ...policy.records.map((record) => ({
          marker: `#${record.seq}`,
          primary: record.tool,
          detail: `→ ${record.option}  ${record.outcome}${record.auto ? "（记忆）" : ""}`,
          tone: record.outcome === "rejected" ? ("error" as const) : undefined,
        })),
      ]
      t.addCommand(name, rest, cwd, rows.length > 0 ? rows : say("暂无权限记录"))
      return
    }
    default: {
      if (!requireAgent()) return
      t.addCommand(name, rest, cwd, say("已交给 agent"))
      client!.prompt(compileAgentCommand(name, rest))
    }
  }
}
