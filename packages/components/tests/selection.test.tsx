import { describe, expect, test } from "bun:test"
import { useState, type ReactNode } from "react"
import { renderTui, KeyCodes } from "@antd-tui/test-utils"
import { Checkbox, ConfigProvider, FocusScope, Radio, Select, Switch } from "../src"

/**
 * 选择类控件：Checkbox / Checkbox.Group / Radio.Group / Switch / Select。
 * 交互：Enter 或 Space 切换，方向键在组内移动焦点。
 */

function wrap(node: ReactNode) {
  return (
    <ConfigProvider>
      <FocusScope>{node}</FocusScope>
    </ConfigProvider>
  )
}

describe("Checkbox", () => {
  test("Enter 与 Space 均可切换，选中态渲染 [x]", async () => {
    const seen: boolean[] = []
    function Demo() {
      const [checked, setChecked] = useState(false)
      return (
        <Checkbox
          checked={checked}
          tuiOnChange={(v) => {
            seen.push(v)
            setChecked(v)
          }}
        >
          同意条款
        </Checkbox>
      )
    }
    const t = await renderTui(wrap(<Demo />), { width: 40, height: 6 })

    expect(t.frame()).toContain("[ ] 同意条款")
    await t.enter()
    expect(t.frame()).toContain("[x] 同意条款")

    await t.type(" ")
    expect(t.frame()).toContain("[ ] 同意条款")
    expect(seen).toEqual([true, false])
    t.destroy()
  })

  test("disabled 时不触发回调", async () => {
    let called = false
    const t = await renderTui(
      wrap(
        <Checkbox disabled tuiOnChange={() => (called = true)}>
          禁用项
        </Checkbox>,
      ),
      { width: 40, height: 6 },
    )
    await t.enter()
    expect(called).toBe(false)
    t.destroy()
  })
})

describe("Checkbox.Group", () => {
  test("多选累加与取消，onChange 回传值数组", async () => {
    let latest: Array<string | number> = []
    function Demo() {
      const [value, setValue] = useState<Array<string | number>>([])
      return (
        <Checkbox.Group
          options={[
            { label: "苹果", value: "apple" },
            { label: "香蕉", value: "banana" },
          ]}
          value={value}
          onChange={(v) => {
            latest = v
            setValue(v)
          }}
        />
      )
    }
    const t = await renderTui(wrap(<Demo />), { width: 40, height: 8 })
    expect(t.frame()).toContain("苹果")
    expect(t.frame()).toContain("香蕉")

    // 焦点在首项，Enter 选中 apple
    await t.enter()
    expect(latest).toEqual(["apple"])

    // 方向键下移到第二项并选中
    await t.press(KeyCodes.ARROW_DOWN)
    await t.enter()
    expect(latest).toEqual(["apple", "banana"])

    // 再次 Enter 取消当前项
    await t.enter()
    expect(latest).toEqual(["apple"])
    t.destroy()
  })

  test("字符串数组选项：label 与 value 相同", async () => {
    let latest: Array<string | number> = []
    function Demo() {
      const [value, setValue] = useState<Array<string | number>>([])
      return (
        <Checkbox.Group
          options={["a", "b"]}
          value={value}
          onChange={(v) => {
            latest = v
            setValue(v)
          }}
        />
      )
    }
    const t = await renderTui(wrap(<Demo />), { width: 40, height: 8 })
    await t.enter()
    expect(latest).toEqual(["a"])
    t.destroy()
  })
})

describe("Radio.Group", () => {
  test("单选互斥，tuiOnChange 回传 value", async () => {
    function Demo() {
      const [value, setValue] = useState<string | number>()
      return (
        <Radio.Group
          options={[
            { label: "男", value: "m" },
            { label: "女", value: "f" },
          ]}
          value={value}
          tuiOnChange={setValue}
        />
      )
    }
    const t = await renderTui(wrap(<Demo />), { width: 40, height: 8 })

    expect(t.frame()).toContain("( ) 男")
    await t.enter()
    expect(t.frame()).toContain("(o) 男")

    await t.press(KeyCodes.ARROW_DOWN)
    await t.enter()
    // 单选互斥：选中女后男取消
    expect(t.frame()).toContain("(o) 女")
    expect(t.frame()).toContain("( ) 男")
    t.destroy()
  })

  test("optionType=button 渲染为横排按钮组", async () => {
    let latest: string | number | undefined
    function Demo() {
      const [value, setValue] = useState<string | number>()
      return (
        <Radio.Group
          optionType="button"
          options={["日", "周", "月"]}
          value={value}
          tuiOnChange={(v) => {
            latest = v
            setValue(v)
          }}
        />
      )
    }
    const t = await renderTui(wrap(<Demo />), { width: 40, height: 6 })
    const line = t
      .frame()
      .split("\n")
      .find((l) => l.includes("日"))
    // 横排：三个选项同一行，且无 (o) 标记
    expect(line!).toContain("周")
    expect(line!).toContain("月")
    expect(t.frame()).not.toContain("( )")

    await t.press(KeyCodes.ARROW_RIGHT)
    await t.enter()
    expect(latest).toBe("周")
    t.destroy()
  })
})

describe("Switch", () => {
  test("onChange 首参为 checked，checkedChildren 上屏", async () => {
    function Demo() {
      const [checked, setChecked] = useState(false)
      return (
        <Switch
          checked={checked}
          checkedChildren="开"
          unCheckedChildren="关"
          onChange={setChecked}
        />
      )
    }
    const t = await renderTui(wrap(<Demo />), { width: 40, height: 6 })

    expect(t.frame()).toContain("关")
    await t.enter()
    expect(t.frame()).toContain("开")
    t.destroy()
  })

  test("loading 时不可切换", async () => {
    let called = false
    const t = await renderTui(
      wrap(<Switch loading checked={false} onChange={() => (called = true)} />),
      { width: 40, height: 6 },
    )
    await t.enter()
    expect(called).toBe(false)
    t.destroy()
  })
})

describe("Select", () => {
  test("鼠标点击选项行直接选中，并把焦点转移过来", async () => {
    const seen: Array<string | number | boolean> = []
    function Demo() {
      const [value, setValue] = useState<string | number | boolean>("dev")
      return (
        <>
          <Checkbox>占位焦点</Checkbox>
          <Select
            value={value}
            onChange={(v) => {
              seen.push(v)
              setValue(v)
            }}
            options={[
              { label: "开发", value: "dev" },
              { label: "测试", value: "test" },
              { label: "生产", value: "prod" },
            ]}
          />
        </>
      )
    }
    const t = await renderTui(wrap(<Demo />), { width: 40, height: 10 })

    // 布局：Checkbox 占 y=0，Select 上边框 y=1，选项行 y=2/3/4；点第二行选中「测试」
    await t.raw.mockMouse.click(2, 3)
    await t.settle()
    expect(seen).toEqual(["test"])

    // 点击已转移焦点：↓ 由 Select 消费，移到「生产」
    await t.press(KeyCodes.ARROW_DOWN)
    expect(seen).toEqual(["test", "prod"])
    t.destroy()
  })

  test("disabled 时鼠标点击不生效", async () => {
    let called = false
    const t = await renderTui(
      wrap(
        <Select
          disabled
          value="a"
          onChange={() => (called = true)}
          options={[
            { label: "甲", value: "a" },
            { label: "乙", value: "b" },
          ]}
        />,
      ),
      { width: 40, height: 8 },
    )
    await t.raw.mockMouse.click(2, 2)
    await t.settle()
    expect(called).toBe(false)
    t.destroy()
  })
})
