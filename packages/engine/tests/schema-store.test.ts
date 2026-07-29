import { describe, expect, test } from "bun:test"
import { SchemaStore } from "../src/schema-store"

/**
 * Schema REPL 存储：$schema 深代理的「每次操作即校验即生效、非法回滚」契约。
 * （eval 注入侧的集成由 vibe-tui 的 e2e 覆盖，这里直接操作代理。）
 */

function makeStore() {
  const changes: unknown[] = []
  const store = new SchemaStore({
    validate: (schema) => {
      const s = schema as { form?: { type?: string; properties?: Record<string, unknown> } }
      if (s.form?.type !== "object") return { ok: false, errors: ["/form/type 必须为 object"] }
      const bad = Object.entries(s.form.properties ?? {}).find(
        ([, node]) => (node as { "x-component"?: string })["x-component"] === "Evil",
      )
      if (bad) return { ok: false, errors: [`/form/properties/${bad[0]} 组件不在白名单`] }
      return { ok: true }
    },
    onChange: (schema) => changes.push(structuredClone(schema)),
  })
  return { store, changes }
}

type Draft = {
  page?: { title?: string }
  form: { type?: string; properties: Record<string, Record<string, unknown>> }
}

describe("SchemaStore × $schema 代理", () => {
  test("逐步赋值：每次操作立即生效并触发 onChange", () => {
    const { store, changes } = makeStore()
    const $schema = store.proxy() as unknown as Draft

    $schema.page!.title = "监控台"
    $schema.form.properties.btn = { type: "void", "x-component": "Button", "x-content": "运行" }
    expect(changes.length).toBe(2)
    const current = store.current() as unknown as Draft
    expect(current.page?.title).toBe("监控台")
    expect(Object.keys(current.form.properties)).toEqual(["btn"])
  })

  test("非法修改抛错且回滚：草稿不变、onChange 不触发", () => {
    const { store, changes } = makeStore()
    const $schema = store.proxy() as unknown as Draft

    expect(() => {
      $schema.form.properties.x = { "x-component": "Evil" }
    }).toThrow("白名单")
    expect(changes.length).toBe(0)
    const current = store.current() as unknown as Draft
    expect(Object.keys(current.form.properties)).toEqual([])
  })

  test("delete 与深层读写；读到的是草稿实时值", () => {
    const { store } = makeStore()
    const $schema = store.proxy() as unknown as Draft

    $schema.form.properties.a = { type: "void", "x-component": "Divider" }
    $schema.form.properties.a["x-content"] = "分隔"
    expect($schema.form.properties.a["x-content"]).toBe("分隔")

    delete $schema.form.properties.a
    expect(Object.keys($schema.form.properties).length).toBe(0)
    void store
  })

  test("replace 全量替换同样过校验", () => {
    const { store } = makeStore()
    expect(store.replace({ form: { type: "array" } }).ok).toBe(false)
    expect(store.replace({ version: "0.1", form: { type: "object", properties: {} } }).ok).toBe(
      true,
    )
  })
})
