/**
 * $ui 活对象树：REPL 的真相源。
 *
 * 与 schema 通路（$schema/SchemaStore）的根本差异：节点是真 JS 对象、
 * 回调是真函数（不写 "{{ }}" 表达式字符串），组件插入/删除/移动、props 热换、
 * 监听（watch）全部动态即时生效。渲染由 @formily/reactive 自驱（LiveView）。
 *
 * 校验策略：写入前检查（组件白名单 / props 键白名单 / name 绑定合法性），
 * 非法操作抛错且不改树——单个操作天然原子，无需副本回滚。
 */
import { observable, reaction } from "@formily/reactive"
import { componentPropsWhitelist, componentWhitelist, containerComponents } from "@antd-tui/components"
import { DISPLAY_BINDING_COMPONENT, inputBindings } from "./registry"

export interface LivePageMeta {
  title?: string
  description?: string
  mode?: "interactive" | "form"
  /** 页面四周留白（终端格），缺省 1；App Shell 满幅布局设 0 */
  padding?: number
  /** 根级纵向间距（标题/内容等块之间），缺省 1；满幅布局设 0 */
  gap?: number
}

export interface LiveNodeInit {
  /** 显式 id；缺省自动生成（小写组件名去点号 + 序号，如 button0） */
  id?: string
  /** 数据绑定键：输入组件双向绑定 $ui.data[name]；Typography.Text 单向显示 */
  name?: string
  /** 文本内容（Button 文案 / Typography 文本）；容器上渲染为首行文本，与子节点共存 */
  content?: string
  /** name 绑定初值，写入 $ui.data[name]（键已存在则不覆盖） */
  default?: unknown
  props?: Record<string, unknown>
}

export interface LiveNode {
  readonly id: string
  readonly component: string
  /** 校验代理：set/delete 先查白名单，非法抛错且不改树；函数值可读回 */
  readonly props: Record<string, unknown>
  name: string | undefined
  content: string | undefined
  readonly children: readonly LiveNode[]
  readonly parent: LiveNode | null
  readonly index: number
  add(component: string, init?: LiveNodeInit): LiveNode
  insert(index: number, component: string, init?: LiveNodeInit): LiveNode
  remove(): void
  /** target=null 移到根；不得移入自身或后代 */
  moveTo(target: LiveNode | null, index?: number): void
  toJSON(): Record<string, unknown>
}

export interface LiveUi {
  page(meta: LivePageMeta): void
  add(component: string, init?: LiveNodeInit): LiveNode
  insert(index: number, component: string, init?: LiveNodeInit): LiveNode
  get(id: string): LiveNode
  has(id: string): boolean
  readonly children: readonly LiveNode[]
  /** 深 observable 数据域：输入组件经 name 绑定读写；handler/watch 直接访问 */
  readonly data: Record<string, unknown>
  /** 动态监听：getter 里读到的响应式数据变更时回调；返回 disposer */
  watch<T>(getter: () => T, callback: (value: T, oldValue: T | undefined) => void): () => void
  /**
   * Esc 行为（缺省与 PageView 完全一致：interactive 完成回传、form 取消）：
   * escape(null) 显式去除（提示行同步隐去 Esc 段）；escape(fn) 覆盖为自定义；escape() 恢复默认
   */
  escape(handler?: (() => void) | null): void
  /** 清空树 + 注销全部 watch + 清空 data（宿主切回 schema 通路时也会调用） */
  clear(): void
}

export interface LiveTreeOptions {
  /** 结构/props 合法变更后回调（宿主据此切画布模式）；渲染由 observable 自驱不依赖它 */
  onMutate?: () => void
  /**
   * agent 回调（事件 props / escape / watch）抛错时的兜底。这些函数由 UI 输入事件
   * 触发，异常若穿透进渲染器事件派发链会刷屏并打挂 stdin 解析。
   * 缺省不兜底（异常照常抛出，适合测试/示例宿主）。
   */
  onCallbackError?: (error: unknown, context: string) => void
}

interface NodeState {
  name: string | undefined
  content: string | undefined
  props: Record<string, unknown>
  childIds: string[]
}

export interface LiveNodeRecord {
  readonly id: string
  /**
   * 全局递增的记录代际号,专用作 React key。clear/删除后重建的节点可能撞上
   * 相同 id(自动 id 计数重置、agent 显式复用 id),若用 id 作 key,React 会
   * 复用仍订阅着旧记录 observable 的组件实例,旧内容永远滞留在屏上。
   */
  readonly seq: number
  readonly component: string
  parentId: string | null
  readonly state: NodeState
}

const CALLBACK_KEY = /^(tuiOn|on)[A-Z]/

/** LiveView 识别回调 props（与 LiveTree 的函数值校验同一约定） */
export function isCallbackProp(key: string): boolean {
  return CALLBACK_KEY.test(key)
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length
  return Math.max(0, Math.min(Math.trunc(index), length))
}

export class LiveTree {
  // 扁平 id 表：childIds 存 id 不存记录引用，避免深 observable 里的代理环与身份混淆
  private records = new Map<string, LiveNodeRecord>()
  private handles = new Map<string, LiveNode>()
  private propProxies = new Map<string, Record<string, unknown>>()
  private idCounters = new Map<string, number>()
  // 记录代际号跨 clear 单调递增,确保重建节点的 React key 必然更新
  private seqCounter = 0
  private watchers = new Set<() => void>()
  private rootState = observable({
    childIds: [] as string[],
    page: {} as LivePageMeta,
    escape: "default" as "default" | "custom" | "none",
  })
  // 自定义 Esc 处理器是函数，不进 observable；模式切换经 rootState.escape 驱动提示行重渲染
  private escapeHandler: (() => void) | null = null

  readonly data: Record<string, unknown> = observable({})
  readonly ui: LiveUi

  constructor(private readonly options: LiveTreeOptions = {}) {
    const tree = this
    this.ui = {
      page(meta: LivePageMeta) {
        if (meta.mode !== undefined && meta.mode !== "interactive" && meta.mode !== "form") {
          throw new Error(`$ui.page：mode 只能是 interactive / form，收到 "${String(meta.mode)}"`)
        }
        for (const key of ["padding", "gap"] as const) {
          const value = meta[key]
          if (value !== undefined && (typeof value !== "number" || value < 0)) {
            throw new Error(`$ui.page：${key} 必须是非负数字`)
          }
        }
        tree.rootState.page = { ...meta }
        tree.mutated()
      },
      add: (component, init) => tree.createNode(component, init ?? {}, null, Infinity),
      insert: (index, component, init) => tree.createNode(component, init ?? {}, null, index),
      get(id: string) {
        if (!tree.records.has(id)) {
          const existing = [...tree.records.keys()].join("、") || "（空树）"
          throw new Error(`$ui.get("${id}")：节点不存在；现有节点：${existing}`)
        }
        return tree.handle(id)
      },
      has: (id) => tree.records.has(id),
      get children() {
        return tree.rootState.childIds.map((cid) => tree.handle(cid))
      },
      data: tree.data,
      watch(getter, callback) {
        const dispose = reaction(getter, tree.guard(callback, "$ui.watch 回调"))
        const wrapped = () => {
          dispose()
          tree.watchers.delete(wrapped)
        }
        tree.watchers.add(wrapped)
        return wrapped
      },
      escape(handler?: (() => void) | null) {
        if (handler !== undefined && handler !== null && typeof handler !== "function") {
          throw new Error("$ui.escape：参数只能是 函数（覆盖）/ null（去除）/ 缺省（恢复默认）")
        }
        tree.escapeHandler = typeof handler === "function" ? handler : null
        tree.rootState.escape = handler === undefined ? "default" : handler === null ? "none" : "custom"
      },
      clear: () => tree.clear(),
    }
  }

  /** LiveView 内部消费；节点可能刚被删除，调用侧需空安全 */
  record(id: string): LiveNodeRecord | undefined {
    return this.records.get(id)
  }

  get rootChildIds(): string[] {
    return this.rootState.childIds
  }

  get pageMeta(): LivePageMeta {
    return this.rootState.page
  }

  /** LiveView 提示行联动用（observable 读取） */
  get escapeMode(): "default" | "custom" | "none" {
    return this.rootState.escape
  }

  /** Esc 按下：none 静默；custom 走覆盖处理器；default 走宿主缺省动作 */
  runEscape(defaultAction: () => void): void {
    if (this.rootState.escape === "none") return
    if (this.rootState.escape === "custom" && this.escapeHandler) {
      this.guard(this.escapeHandler, "$ui.escape 处理器")()
      return
    }
    defaultAction()
  }

  /**
   * agent 回调守卫：配置了 onCallbackError 则拦截异常交宿主处理，
   * 否则原样抛出（测试/示例宿主保持既有语义）
   */
  guard<A extends unknown[]>(fn: (...args: A) => unknown, context: string): (...args: A) => void {
    return (...args: A) => {
      try {
        fn(...args)
      } catch (err) {
        const handler = this.options.onCallbackError
        if (!handler) throw err
        handler(err, context)
      }
    }
  }

  /** clear 不触发 onMutate：宿主切 schema 前清场时不应又把画布切回 live */
  clear(): void {
    for (const dispose of [...this.watchers]) dispose()
    this.records.clear()
    this.handles.clear()
    this.propProxies.clear()
    this.idCounters.clear()
    this.rootState.childIds.splice(0)
    this.rootState.page = {}
    this.rootState.escape = "default"
    this.escapeHandler = null
    for (const key of Object.keys(this.data)) delete this.data[key]
  }

  dispose(): void {
    this.clear()
  }

  private mutated(): void {
    this.options.onMutate?.()
  }

  private requireRecord(id: string): LiveNodeRecord {
    const record = this.records.get(id)
    if (!record) throw new Error(`$ui：节点 "${id}" 不存在（可能已被删除）`)
    return record
  }

  private childIdsOf(parentId: string | null): string[] {
    return parentId === null ? this.rootState.childIds : this.requireRecord(parentId).state.childIds
  }

  private nextId(component: string): string {
    const base = component.toLowerCase().replace(/\./g, "")
    // 计数器只增不回收：id 复用会让 React 状态串台
    let n = this.idCounters.get(base) ?? 0
    let id = `${base}${n}`
    while (this.records.has(id)) {
      n += 1
      id = `${base}${n}`
    }
    this.idCounters.set(base, n + 1)
    return id
  }

  private assertProp(component: string, id: string, key: string, value: unknown): void {
    const allowed = componentPropsWhitelist[component] ?? []
    if (!allowed.includes(key)) {
      throw new Error(`$ui：${component}(${id}) 不接受 prop "${key}"；可用：${allowed.join("、")}`)
    }
    if (CALLBACK_KEY.test(key) && typeof value === "string") {
      throw new Error(
        `$ui：${component}(${id}) 的 "${key}" 需要真 JS 函数——活树不用 "{{ }}" 表达式字符串`,
      )
    }
  }

  private assertNameable(component: string, id: string): void {
    if (!(component in inputBindings) && component !== DISPLAY_BINDING_COMPONENT) {
      throw new Error(
        `$ui：${component}(${id}) 不支持 name 绑定（仅输入组件与 ${DISPLAY_BINDING_COMPONENT}）`,
      )
    }
  }

  private createNode(
    component: string,
    init: LiveNodeInit,
    parentId: string | null,
    index: number,
  ): LiveNode {
    if (!componentWhitelist.includes(component)) {
      throw new Error(`$ui：未知组件 "${component}"；可用：${componentWhitelist.join("、")}`)
    }
    const id = init.id ?? this.nextId(component)
    if (this.records.has(id)) throw new Error(`$ui：节点 id "${id}" 已存在`)
    if (parentId !== null) {
      const parent = this.requireRecord(parentId)
      if (!containerComponents.includes(parent.component)) {
        throw new Error(
          `$ui：${parent.component}(${parentId}) 是叶子组件，不接受子节点——` +
            `文案用 content。注意 node.add() 返回新建节点而非父节点；` +
            `给同一父节点挂多个子节点请先 var box = $ui.add("Space") 再分别 box.add(...)。` +
            `可容纳子节点的容器：${containerComponents.join("、")}`,
        )
      }
    }
    if (init.name !== undefined) this.assertNameable(component, id)
    if (init.content !== undefined && typeof init.content !== "string") {
      throw new Error(`$ui：${component}(${id}) 的 content 必须是字符串`)
    }
    const props = { ...(init.props ?? {}) }
    for (const [key, value] of Object.entries(props)) {
      this.assertProp(component, id, key, value)
    }
    const siblings = this.childIdsOf(parentId)
    const record: LiveNodeRecord = {
      id,
      seq: ++this.seqCounter,
      component,
      parentId,
      state: observable({
        name: init.name,
        content: init.content,
        props,
        childIds: [] as string[],
      }),
    }
    this.records.set(id, record)
    siblings.splice(clampIndex(index, siblings.length), 0, id)
    if (init.name !== undefined && init.default !== undefined && !(init.name in this.data)) {
      this.data[init.name] = init.default
    }
    this.mutated()
    return this.handle(id)
  }

  private removeNode(id: string): void {
    const record = this.requireRecord(id)
    const siblings = this.childIdsOf(record.parentId)
    const at = siblings.indexOf(id)
    if (at >= 0) siblings.splice(at, 1)
    this.deleteSubtree(id)
    this.mutated()
  }

  private deleteSubtree(id: string): void {
    const record = this.records.get(id)
    if (!record) return
    for (const cid of record.state.childIds) this.deleteSubtree(cid)
    this.records.delete(id)
    this.handles.delete(id)
    this.propProxies.delete(id)
  }

  private moveNode(id: string, targetId: string | null, index: number | undefined): void {
    const record = this.requireRecord(id)
    if (targetId !== null) {
      const target = this.requireRecord(targetId)
      if (!containerComponents.includes(target.component)) {
        throw new Error(
          `$ui：${target.component}(${targetId}) 是叶子组件，不接受子节点；` +
            `可容纳子节点的容器：${containerComponents.join("、")}`,
        )
      }
      for (let cur: string | null = targetId; cur !== null; ) {
        if (cur === id) throw new Error(`$ui：不能把 ${id} 移入自身或其后代`)
        cur = this.records.get(cur)?.parentId ?? null
      }
    }
    const from = this.childIdsOf(record.parentId)
    from.splice(from.indexOf(id), 1)
    const to = this.childIdsOf(targetId)
    to.splice(clampIndex(index ?? Infinity, to.length), 0, id)
    record.parentId = targetId
    this.mutated()
  }

  private propsProxy(id: string): Record<string, unknown> {
    let proxy = this.propProxies.get(id)
    if (proxy) return proxy
    const tree = this
    proxy = new Proxy({} as Record<string, unknown>, {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined
        return tree.requireRecord(id).state.props[prop]
      },
      set(_target, prop, value) {
        if (typeof prop !== "string") return false
        const record = tree.requireRecord(id)
        tree.assertProp(record.component, id, prop, value)
        record.state.props[prop] = value
        tree.mutated()
        return true
      },
      deleteProperty(_target, prop) {
        if (typeof prop !== "string") return false
        const record = tree.requireRecord(id)
        delete record.state.props[prop]
        tree.mutated()
        return true
      },
      has(_target, prop) {
        return typeof prop === "string" && prop in tree.requireRecord(id).state.props
      },
      ownKeys() {
        return Object.keys(tree.requireRecord(id).state.props)
      },
      getOwnPropertyDescriptor(_target, prop) {
        if (typeof prop !== "string") return undefined
        const props = tree.requireRecord(id).state.props
        if (!(prop in props)) return undefined
        return { configurable: true, enumerable: true, writable: true, value: props[prop] }
      },
    })
    this.propProxies.set(id, proxy)
    return proxy
  }

  private handle(id: string): LiveNode {
    let cached = this.handles.get(id)
    if (cached) return cached
    const tree = this
    cached = {
      get id() {
        return id
      },
      get component() {
        return tree.requireRecord(id).component
      },
      get props() {
        tree.requireRecord(id)
        return tree.propsProxy(id)
      },
      get name() {
        return tree.requireRecord(id).state.name
      },
      set name(value: string | undefined) {
        const record = tree.requireRecord(id)
        if (value !== undefined) tree.assertNameable(record.component, id)
        record.state.name = value
        tree.mutated()
      },
      get content() {
        return tree.requireRecord(id).state.content
      },
      set content(value: string | undefined) {
        if (value !== undefined && typeof value !== "string") {
          throw new Error(`$ui：${id} 的 content 必须是字符串`)
        }
        tree.requireRecord(id).state.content = value
        tree.mutated()
      },
      get children() {
        return tree.requireRecord(id).state.childIds.map((cid) => tree.handle(cid))
      },
      get parent() {
        const parentId = tree.requireRecord(id).parentId
        return parentId === null ? null : tree.handle(parentId)
      },
      get index() {
        const record = tree.requireRecord(id)
        return tree.childIdsOf(record.parentId).indexOf(id)
      },
      add: (component, init) => tree.createNode(component, init ?? {}, id, Infinity),
      insert: (index, component, init) => tree.createNode(component, init ?? {}, id, index),
      remove: () => tree.removeNode(id),
      moveTo: (target, index) => tree.moveNode(id, target ? target.id : null, index),
      // eval 结果会被 MCP JSON.stringify 回显给 agent：给出有用摘要而非代理原样
      toJSON() {
        const record = tree.requireRecord(id)
        return {
          id,
          component: record.component,
          ...(record.state.name !== undefined ? { name: record.state.name } : {}),
          ...(record.state.content !== undefined ? { content: record.state.content } : {}),
          props: Object.fromEntries(
            Object.entries(record.state.props).map(([key, value]) => [
              key,
              typeof value === "function" ? "[function]" : value,
            ]),
          ),
          children: [...record.state.childIds],
        }
      },
    }
    this.handles.set(id, cached)
    return cached
  }
}
