/**
 * Schema REPL 存储：agent 经 $schema 代理"一点一点"搭页面的核心。
 *
 * 行为契约：
 * - $schema 是当前页面 Schema 草稿的深代理，任何 set / delete 立即：
 *   在草稿副本上应用 → 整体校验 → 合法则落盘并触发重渲染（不重挂载，
 *   表单值与 $state 保留）；非法则丢弃副本并抛错（带 JSON 路径），
 *   草稿保持原样——单步原子，改错一个组件只需修那一步。
 * - replace() 全量替换（vibetui_render 语义：换页/重置）。
 * - 空画布也可直接从 $schema 起步（内置最小骨架）。
 */

export interface SchemaStoreOptions {
  validate: (schema: unknown) => { ok: boolean; errors?: string[] }
  /** 草稿变更已生效（校验通过）时回调，宿主用它触发渲染 */
  onChange: (schema: Record<string, unknown>) => void
}

const EMPTY_SCHEMA: Record<string, unknown> = {
  version: "0.1",
  page: { title: "", mode: "interactive" },
  form: { type: "object", properties: {} },
}

export class SchemaStore {
  private draft: Record<string, unknown>

  constructor(private readonly options: SchemaStoreOptions) {
    this.draft = structuredClone(EMPTY_SCHEMA)
  }

  current(): Record<string, unknown> {
    return this.draft
  }

  /** 全量替换（render 工具）：校验通过才生效 */
  replace(schema: unknown): { ok: boolean; errors?: string[] } {
    const result = this.options.validate(schema)
    if (!result.ok) return result
    this.draft = structuredClone(schema) as Record<string, unknown>
    this.options.onChange(this.draft)
    return { ok: true }
  }

  /** 单步变更：在副本上执行 mutator → 校验 → 生效或抛错回滚 */
  private mutate(mutator: (draft: Record<string, unknown>) => void): void {
    const next = structuredClone(this.draft)
    mutator(next)
    const result = this.options.validate(next)
    if (!result.ok) {
      throw new Error(`schema 校验失败，本次修改未生效：\n${(result.errors ?? []).join("\n")}`)
    }
    this.draft = next
    this.options.onChange(this.draft)
  }

  /**
   * $schema 深代理：读到的是草稿当前值；对任意层级的赋值/删除都会
   * 走一次「副本修改 → 校验 → 生效/回滚」。每次操作独立原子。
   */
  proxy(): Record<string, unknown> {
    return this.wrap([])
  }

  private resolve(path: Array<string | number>): unknown {
    let node: unknown = this.draft
    for (const key of path) {
      if (node === null || typeof node !== "object") return undefined
      node = (node as Record<string | number, unknown>)[key]
    }
    return node
  }

  private wrap(path: Array<string | number>): Record<string, unknown> {
    const store = this
    // target 仅作代理载体；一切读写都按 path 实时解析到最新草稿
    return new Proxy({} as Record<string, unknown>, {
      get(_target, prop) {
        if (typeof prop === "symbol") {
          const node = store.resolve(path)
          return (node as never)?.[prop as never]
        }
        const node = store.resolve(path)
        if (node === null || typeof node !== "object") return undefined
        const value = (node as Record<string, unknown>)[prop]
        if (value !== null && typeof value === "object") {
          return store.wrap([...path, Array.isArray(node) ? Number(prop) : prop])
        }
        return value
      },
      set(_target, prop, value) {
        if (typeof prop === "symbol") return false
        store.mutate((draft) => {
          const parent = resolveIn(draft, path, true)
          ;(parent as Record<string, unknown>)[prop] = structuredClone(value)
        })
        return true
      },
      deleteProperty(_target, prop) {
        if (typeof prop === "symbol") return false
        store.mutate((draft) => {
          const parent = resolveIn(draft, path, false)
          if (parent !== null && typeof parent === "object") {
            delete (parent as Record<string, unknown>)[prop as string]
          }
        })
        return true
      },
      has(_target, prop) {
        const node = store.resolve(path)
        return node !== null && typeof node === "object" && prop in (node as object)
      },
      ownKeys() {
        const node = store.resolve(path)
        return node !== null && typeof node === "object" ? Reflect.ownKeys(node as object) : []
      },
      getOwnPropertyDescriptor(_target, prop) {
        const node = store.resolve(path)
        if (node === null || typeof node !== "object") return undefined
        const desc = Object.getOwnPropertyDescriptor(node as object, prop)
        if (desc) desc.configurable = true
        return desc
      },
    })
  }
}

/** 在草稿里按路径找到父节点；create 时补建缺失的中间对象 */
function resolveIn(
  draft: Record<string, unknown>,
  path: Array<string | number>,
  create: boolean,
): unknown {
  let node: unknown = draft
  for (const key of path) {
    if (node === null || typeof node !== "object") {
      throw new Error(`路径 /${path.join("/")} 不可达（中间节点不是对象）`)
    }
    const record = node as Record<string | number, unknown>
    if (record[key] === undefined || record[key] === null) {
      if (!create) return undefined
      record[key] = typeof key === "number" ? [] : {}
    }
    node = record[key]
  }
  return node
}
