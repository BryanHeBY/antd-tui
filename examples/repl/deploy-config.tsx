/**
 * REPL 版服务部署配置：与 examples/schema/deploy-config.json 功能一致。
 * schema 版靠 x-validator / x-reactions 声明；REPL 版全部是真函数——
 * 校验直接写回 FormItem 的 help/validateStatus，联动显隐是 watch + 动态插删节点。
 *
 * 运行：bun run examples:deploy:repl（需要 TTY）；Esc = 取消（form 模式默认行为）
 */
import type { LiveUi } from "@antd-tui/live"
import type { ExampleActions } from "./host"

export function buildDeployConfig($ui: LiveUi, actions: ExampleActions): void {
  $ui.page({
    title: "服务部署配置（REPL 版）",
    description: "Tab/方向键移动焦点，填写后点击「部署」提交，Esc 取消",
    mode: "form",
  })

  // —— 基础信息 ——
  const basic = $ui.add("Card", { id: "basic", props: { title: "基础信息" } })
  basic
    .add("FormItem", { id: "fiName", props: { label: "服务名称", required: true } })
    .add("Input", { name: "name", props: { placeholder: "如 user-api" } })

  const rowEnvPort = basic.add("Row", { props: { gutter: 2 } })
  rowEnvPort
    .add("Col", { props: { flex: 1 } })
    .add("FormItem", { props: { label: "部署环境" } })
    .add("Select", {
      name: "env",
      default: "dev",
      props: {
        options: [
          { label: "开发", value: "dev" },
          { label: "测试", value: "test" },
          { label: "生产", value: "prod" },
        ],
      },
    })
  rowEnvPort
    .add("Col", { props: { flex: 1 } })
    .add("FormItem", { id: "fiPort", props: { label: "服务端口" } })
    .add("InputNumber", { name: "port", default: 8080, props: { placeholder: "1-65535" } })

  basic
    .add("FormItem", { props: { label: "部署地域" } })
    .add("Radio.Group", {
      name: "region",
      default: "cn-north",
      props: {
        optionType: "button",
        options: [
          { label: "华北", value: "cn-north" },
          { label: "华东", value: "cn-east" },
          { label: "华南", value: "cn-south" },
        ],
      },
    })
  basic
    .add("FormItem", { props: { label: "附加能力" } })
    .add("Checkbox.Group", {
      name: "features",
      default: ["log"],
      props: {
        tuiDirection: "horizontal",
        options: [
          { label: "日志采集", value: "log" },
          { label: "链路追踪", value: "trace" },
          { label: "自动扩缩容", value: "autoscale" },
        ],
      },
    })

  // —— 高级选项：schema 版是 x-reactions 声明显隐，REPL 版直接动态插删节点 ——
  $ui.add("Divider", { content: "高级选项", props: { orientation: "left" } })
  $ui
    .add("FormItem", { props: { label: "启用高级配置" } })
    .add("Switch", {
      name: "advanced",
      default: false,
      props: { checkedChildren: "开", unCheckedChildren: "关" },
    })

  const buildAdvancedCard = () => {
    // 插在操作行之前，位置与 schema 版一致
    const card = $ui.insert($ui.get("actions").index, "Card", {
      id: "advCard",
      props: { title: "高级配置" },
    })
    card
      .add("FormItem", { props: { label: "CPU 上限 (%)" } })
      .add("Slider", { name: "cpuLimit", default: 50, props: { min: 10, max: 100, step: 5 } })
    card
      .add("FormItem", { props: { label: "启动脚本" } })
      .add("TextArea", {
        name: "startupScript",
        props: { rows: 3, placeholder: "#!/bin/sh\n每行一条命令" },
      })
    card.add("Checkbox", { name: "autoRestart", default: true, content: "崩溃后自动重启" })
  }
  $ui.watch(
    () => $ui.data.advanced,
    (on) => {
      if (on && !$ui.has("advCard")) buildAdvancedCard()
      else if (!on && $ui.has("advCard")) $ui.get("advCard").remove()
    },
  )

  // —— 校验 + 提交：真函数，错误直接写回 FormItem ——
  const setError = (formItemId: string, message: string | null) => {
    const props = $ui.get(formItemId).props
    if (message === null) {
      delete props.help
      delete props.validateStatus
    } else {
      props.help = message
      props.validateStatus = "error"
    }
  }
  const validate = (): boolean => {
    let ok = true
    const name = String($ui.data.name ?? "")
    if (name === "") {
      setError("fiName", "服务名称必填")
      ok = false
    } else if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      setError("fiName", "仅允许小写字母、数字与中划线，且以字母开头")
      ok = false
    } else setError("fiName", null)

    const port = Number($ui.data.port ?? 0)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError("fiPort", "端口范围 1-65535")
      ok = false
    } else setError("fiPort", null)
    return ok
  }
  const submit = () => {
    if (!validate()) return
    const { name, env, port, region, features, advanced, cpuLimit, startupScript, autoRestart } =
      $ui.data
    actions.submit(
      JSON.parse(
        JSON.stringify({
          name,
          env,
          port,
          region,
          features,
          advanced,
          ...(advanced ? { cpuLimit, startupScript, autoRestart } : {}),
        }),
      ) as Record<string, unknown>,
    )
  }

  // —— 操作行：live 无内置 actions 栏，页内自绘（与 schema 版 actions 等价） ——
  const actionRow = $ui.add("Space", { id: "actions", props: { size: 2 } })
  actionRow.add("Button", { content: "部署", props: { type: "primary", tuiOnClick: submit } })
  actionRow.add("Button", { content: "取消", props: { tuiOnClick: () => actions.cancel() } })
}

if (import.meta.main) {
  const { runLiveExample } = await import("./host")
  await runLiveExample(($ui, actions) => buildDeployConfig($ui, actions))
}
