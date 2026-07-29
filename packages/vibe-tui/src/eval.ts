/**
 * 在页面表达式作用域里执行 agent 提供的 JS(vibetui_eval 工具)。
 *
 * 作用域 = 编译后的 scope（$form/$state/$memo + scopeExtras + 具名函数）。
 * 与 Formily 表达式同一套上下文,因此 agent 写的代码与 schema 里的表达式行为一致。
 * 支持表达式（"$form.values"）与语句体（"$state.a = 1; $state.b = 2"）两种形态。
 */
export function evalInScope(code: string, scope: Record<string, unknown>): unknown {
  const names = Object.keys(scope)
  const values = names.map((n) => scope[n])
  // 先按表达式编译（可直接拿返回值）；失败再按语句体编译（需自带 return）
  let fn: (...args: unknown[]) => unknown
  try {
    fn = new Function(...names, `return (${code})`) as never
  } catch {
    fn = new Function(...names, code) as never
  }
  return fn(...values)
}
