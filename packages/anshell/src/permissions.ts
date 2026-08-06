/**
 * 权限记忆与审计。
 *
 * ACP 的 allow_always / reject_always 表示「以后别再问」，但协议不负责记住——
 * 客户端得自己存。这里按工具名（没有 name 时退回标题）记策略，并留一条审计流水，
 * 让 /permissions 能回答「谁在什么时候放行了什么」。
 */
export type PermissionOutcome = "allowed" | "rejected" | "cancelled"

/**
 * 策略只关心选项的三个字段。用结构类型而不是 SDK 的 PermissionOption：
 * 卡片存的是同款结构，kind 保持宽松的 string，未知 kind 也能原样审计。
 */
export interface PolicyOption {
  optionId: string
  name: string
  kind: string
}

export interface PermissionRecord {
  /** 单调递增序号，UI 用作 key */
  seq: number
  tool: string
  /** 展示用的选项名 */
  option: string
  kind: string
  outcome: PermissionOutcome
  /** true = 命中记忆策略自动决定，没有打断用户 */
  auto: boolean
}

export interface RememberedDecision {
  kind: "allow_always" | "reject_always"
  optionId: string
  option: string
}

export function outcomeOfKind(kind: string): PermissionOutcome {
  return kind.startsWith("allow") ? "allowed" : "rejected"
}

export class PermissionPolicy {
  private readonly remembered = new Map<string, RememberedDecision>()
  private readonly log: PermissionRecord[] = []
  private seq = 0

  /** 记忆命中：返回可直接回给 agent 的选项，没有则 null（需要问人）。 */
  lookup(tool: string, options: PolicyOption[]): RememberedDecision | null {
    const decision = this.remembered.get(tool)
    if (!decision) return null
    // agent 这次给的选项集可能变了；记忆的 optionId 不在其中就重新问人
    return options.some((option) => option.optionId === decision.optionId) ? decision : null
  }

  /** always 类决策写入记忆；once 类只留审计。 */
  record(tool: string, option: PolicyOption | null, outcome: PermissionOutcome, auto: boolean): PermissionRecord {
    if (option && (option.kind === "allow_always" || option.kind === "reject_always")) {
      this.remembered.set(tool, { kind: option.kind, optionId: option.optionId, option: option.name })
    }
    const record: PermissionRecord = {
      seq: ++this.seq,
      tool,
      option: option?.name ?? "（取消）",
      kind: option?.kind ?? "cancelled",
      outcome,
      auto,
    }
    this.log.push(record)
    return record
  }

  get records(): readonly PermissionRecord[] {
    return this.log
  }

  get memory(): ReadonlyMap<string, RememberedDecision> {
    return this.remembered
  }

  /** 清空记忆（审计流水保留，它是历史事实）。 */
  forget(): number {
    const count = this.remembered.size
    this.remembered.clear()
    return count
  }
}
