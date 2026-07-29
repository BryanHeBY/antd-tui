/**
 * vibe-tui 的会话级 JavaScript REPL。
 *
 * 每个 VibeApp 持有一个 REPL；每次 vibetui_eval 都在同一个 VM context 执行，
 * 因而顶层 const/let/var、函数和它们捕获的闭包会跨工具调用保留。
 *
 * 这不是安全沙箱：agent 被允许执行任意 JavaScript。vm.Context 在这里的职责
 * 只是提供可持续的 JavaScript 全局词法环境，并固定宿主注入的 $ui / $agent。
 */
import { createContext, Script, type Context } from "node:vm"

export interface EvalRepl {
  /** 在该会话的持久词法环境中执行一段 JavaScript。 */
  evaluate(code: string): unknown
}

/**
 * 创建一个会话级 REPL。
 *
 * 初始 scope 是只读全局绑定，和旧的 Function 参数语义一致：agent 可以操作
 * $ui/$agent 指向的对象，却不能意外把宿主入口重新赋值成别的值。自行声明的
 * 顶层变量则是正常的可持久 REPL 变量。
 */
export function createEvalRepl(scope: Record<string, unknown>): EvalRepl {
  // 保留旧版 new Function 可见的 Bun/Node 全局能力；此处不是隔离执行环境。
  // Context 只额外提供独立且持久的顶层词法环境。
  const sandbox = Object.create(globalThis) as Record<string, unknown>
  for (const [name, value] of Object.entries(scope)) {
    Object.defineProperty(sandbox, name, {
      value,
      enumerable: true,
      writable: false,
      configurable: false,
    })
  }
  const context: Context = createContext(sandbox)

  return {
    evaluate(code: string): unknown {
      // Script 直接执行完整 Program，既支持语句体也保留最后一个表达式的结果；
      // 同一 Context 让各次 Script 共享全局词法环境，语义等同于一个 REPL 会话。
      return new Script(code, { filename: "vibetui_eval" }).runInContext(context)
    },
  }
}

/**
 * 一次性兼容入口。新代码应创建一次 createEvalRepl() 后重复 evaluate()，
 * 才能获得跨调用变量持久化。
 */
export function evalInScope(code: string, scope: Record<string, unknown>): unknown {
  return createEvalRepl(scope).evaluate(code)
}
