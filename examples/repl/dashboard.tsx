/**
 * REPL 版运维控制台(dash):App Shell 布局示例——顶部满宽菜单条 + 左侧满高导航栏 + 可滚动主区。
 * 菜单/导航是背景色块区域(现代网页式,与计算器屏显条同款),不是带边框的独立小组件;
 * 左侧导航切换主区内容(真函数重建),主区 Flex tuiScroll 支持滚轮上下翻页。
 *
 * 运行:bun run examples:dash:repl(需要 TTY);Esc = 完成回传 $ui.data
 */
import type { LiveNode, LiveUi } from "@antd-tui/live"
import type { ExampleActions } from "./host"

type SectionKey = "overview" | "services" | "alerts" | "settings"

export function buildDashboard($ui: LiveUi, actions?: ExampleActions): void {
  // —— 登录页:覆盖 Typography.Title / Typography.Link / tuiOnPressEnter /
  //    Button loading / Modal footer:null;登录成功 $ui.clear() 整页重建进 shell ——
  const buildLogin = (): void => {
    $ui.page({ mode: "interactive", padding: 0, gap: 0 })
    const wrap = $ui.add("Flex", {
      props: {
        vertical: true,
        justify: "center",
        align: "center",
        style: { width: "100%", height: "100%" },
      },
    })
    const card = wrap.add("Card", { props: { title: "运维控制台", style: { width: 46 } } })
    card.add("Typography.Title", { content: "登录" })
    card
      .add("FormItem", { props: { label: "用户名" } })
      .add("Input", { name: "user", props: { placeholder: "ops-admin", maxLength: 24 } })
    card
      .add("FormItem", { props: { label: "密码" } })
      .add("Input", {
        name: "pass",
        props: { placeholder: "任意非空", tuiOnPressEnter: () => doLogin() },
      })
    const rowExtra = card.add("Flex", { props: { justify: "space-between", align: "center" } })
    rowExtra.add("Checkbox", { name: "remember", default: true, content: "记住我" })
    rowExtra.add("Typography.Link", {
      content: "忘记密码",
      props: { type: "secondary", tuiOnClick: () => ($ui.get("resetModal").props.open = true) },
    })
    card.add("Button", {
      id: "loginBtn",
      content: "登 录",
      props: { type: "primary", block: true, tuiOnClick: () => doLogin() },
    })
    const reset = wrap.add("Modal", {
      id: "resetModal",
      props: {
        open: false,
        title: "重置密码",
        footer: null,
        tuiWidth: 40,
        tuiOnCancel: () => ($ui.get("resetModal").props.open = false),
      },
    })
    reset.add("Typography.Text", { content: "请联系平台组 @ops 重置密码(Esc 关闭)" })

    const doLogin = (): void => {
      if (!String($ui.data.user ?? "").trim() || !String($ui.data.pass ?? "").trim()) {
        if (!$ui.has("loginError")) {
          card.insert($ui.get("loginBtn").index, "Alert", {
            id: "loginError",
            props: { type: "error", showIcon: true, message: "用户名与密码不能为空" },
          })
        }
        return
      }
      $ui.get("loginBtn").props.loading = true
      // 模拟鉴权后换页:clear 清空登录页(含 $ui.data),重建控制台 shell
      setTimeout(() => {
        $ui.clear()
        buildShell()
      }, 500)
    }
  }

  const buildShell = (): void => {
    // App Shell 满幅:品牌与提示都在菜单条里,页面级留白与间距归零
    $ui.page({ mode: "interactive", padding: 0, gap: 0 })

    // 壳:占满画布高度,内部不留缝——菜单/导航的连体边框自成节奏
    const shell = $ui.add("Flex", {
      id: "shell",
      props: { vertical: true, gap: 0, style: { width: "100%", height: "100%" } },
    })

    // —— 顶部菜单条:满宽背景色条,左品牌右操作(现代网页 header) ——
    const header = shell.add("Flex", {
      props: {
        justify: "space-between",
        align: "center",
        style: { width: "100%", backgroundColor: "#1f1f1f", padding: 1 },
      },
    })
    header.add("Typography.Text", {
      content: " ☰ 运维控制台 ",
      props: { strong: true, style: { color: "#e6e6e6" } },
    })
    const headerOps = header.add("Space", { props: { size: 1 } })
    headerOps.add("Button", {
      content: " 刷新 r ",
      props: { tuiSize: "small", tuiHotkey: "r", tuiOnClick: () => refresh() },
    })
    headerOps.add("Button", {
      content: " 帮助 h ",
      props: { tuiSize: "small", tuiHotkey: "h", tuiOnClick: () => ($ui.get("helpModal").props.open = true) },
    })
    headerOps.add("Button", {
      content: " 退出 q ",
      props: { tuiSize: "small", tuiHotkey: "q", tuiOnClick: () => actions?.cancel() },
    })

    // —— 主体:左侧满高导航栏(背景色块) + 右主区(撑满余宽,内部滚动) ——
    // 主体紧贴菜单条:侧栏(#171717)与顶栏(#1f1f1f)以不同底色相接,浑然一体
    const body = shell.add("Row", { props: { gutter: 0, wrap: false, style: { flex: 1 } } })
    const navCol = body.add("Col", { props: { style: { width: 16 } } })
    // 侧栏无内边距:导航按钮从边到边平铺,整列就是按钮的堆叠
    const nav = navCol.add("Flex", {
      props: { vertical: true, gap: 0, style: { height: "100%", backgroundColor: "#171717" } },
    })
    const NAV: Array<{ key: SectionKey; label: string; hotkey: string }> = [
      { key: "overview", label: "概览", hotkey: "1" },
      { key: "services", label: "服务", hotkey: "2" },
      { key: "alerts", label: "告警", hotkey: "3" },
      { key: "settings", label: "设置", hotkey: "4" },
    ]
    for (const item of NAV) {
      nav.add("Button", {
        id: `nav-${item.key}`,
        content: `${item.hotkey}  ${item.label}`,
        props: {
          tuiSize: "small",
          block: true,
          style: { padding: 1 },
          tuiHotkey: item.hotkey,
          tuiOnClick: () => goto(item.key),
        },
      })
    }
    // 主区自己留呼吸边距(侧栏与顶栏之间不留缝)
    body.add("Col", { props: { flex: 1 } }).add("Flex", {
      id: "main",
      props: { vertical: true, gap: 1, tuiScroll: true, style: { height: "100%", marginLeft: 1, marginTop: 1 } },
    })

    // —— 帮助浮层 ——
    const help = shell.add("Modal", {
      id: "helpModal",
      props: {
        open: false,
        title: "帮助",
        tuiWidth: 46,
        okText: "知道了",
        tuiOnOk: () => ($ui.get("helpModal").props.open = false),
        tuiOnCancel: () => ($ui.get("helpModal").props.open = false),
      },
    })
    help.add("Typography.Text", { content: "数字键 1-4 切换左侧导航;r 刷新当前页。" })
    help.add("Typography.Text", { content: "主区内容超高时用鼠标滚轮上下翻页。" })
    help.add("Typography.Text", { content: "设置页的表单值经 name 绑定存入 $ui.data,Esc 完成回传。" })

    // —— 主区各分区:真函数重建;$ui.data 跨重建保留(设置页的表单值不丢) ——
    let current: SectionKey | "" = ""
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    // 分区级清理:切走时注销本分区注册的 watch,避免跨分区重复监听
    let sectionCleanups: Array<() => void> = []

    const goto = (key: SectionKey): void => {
      if (current === key) return
      current = key
      for (const cleanup of sectionCleanups) cleanup()
      sectionCleanups = []
      for (const item of NAV) {
        const btn = $ui.get(`nav-${item.key}`)
        if (item.key === key) btn.props.type = "primary"
        else delete btn.props.type
      }
      const main = $ui.get("main")
      for (const child of [...main.children]) child.remove()
      SECTIONS[key](main)
    }

    const refresh = (): void => {
      if (!$ui.has("mainSpin")) return
      if (refreshTimer) clearTimeout(refreshTimer)
      $ui.get("mainSpin").props.spinning = true
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        if ($ui.has("mainSpin")) $ui.get("mainSpin").props.spinning = false
      }, 600)
    }

    const buildOverview = (main: LiveNode): void => {
      const spin = main.add("Spin", { id: "mainSpin", props: { spinning: false, tip: "刷新中..." } })
      spin.add("Alert", {
        props: {
          type: "warning",
          showIcon: true,
          message: "cn-north 集群今晚 23:00 例行维护,新实例调度可能延迟",
        },
      })
      const stats = spin.add("Row", { props: { gutter: 2 } })
      const stat = (title: string, value: number | string, extra: Record<string, unknown> = {}) =>
        stats
          .add("Col", { props: { flex: 1 } })
          .add("Statistic", { props: { title, value, ...extra } })
      stat("请求量", 12483, { suffix: "次/分" })
      stat("错误率", 0.42, { precision: 2, suffix: "%", tuiValueType: "danger" })
      stat("持续运行", 36, { suffix: "天", tuiValueType: "success" })

      const load = spin.add("Card", { props: { title: "节点负载" } })
      load.add("Progress", { id: "cpuBar", props: { percent: 42, status: "active" } })
      const loadBtns = load.add("Space", { props: { size: 2 } })
      const bumpLoad = (d: number) => {
        const bar = $ui.get("cpuBar")
        const next = Math.min(100, Math.max(0, Number(bar.props.percent ?? 0) + d))
        bar.props.percent = next
        bar.props.status = next >= 90 ? "exception" : "active"
      }
      loadBtns.add("Button", {
        content: "负载 +10",
        props: { tuiSize: "small", tuiHotkey: "+", tuiOnClick: () => bumpLoad(10) },
      })
      loadBtns.add("Button", {
        content: "负载 -10",
        props: { tuiSize: "small", tuiHotkey: "-", tuiOnClick: () => bumpLoad(-10) },
      })

      const tags = spin.add("Space", { props: { size: 2 } })
      tags.add("Tag", { content: "SLA 达标", props: { color: "success" } })
      tags.add("Tag", { content: "灰度中", props: { color: "processing" } })
      tags.add("Tag", { content: "cn-north", props: { bordered: false } })

      spin.add("Divider", { content: "最近事件", props: { orientation: "left", dashed: true } })
      const events = spin.add("List", { props: { bordered: true } })
      const event = (text: string, tag: string, color: string) => {
        // Space 横排:文本与状态 Tag 同行,贴近 antd List.Item extra 的观感
        const row = events.add("List.Item").add("Space", { props: { size: 2 } })
        row.add("Typography.Text", { content: text })
        row.add("Tag", { content: tag, props: { color } })
      }
      event("10:24 gateway 滚动发布完成", "发布", "success")
      event("09:58 billing 实例 i-03 重启", "自愈", "warning")
      event("09:12 user-api 扩容 2 副本", "扩容", "processing")

      spin
        .add("Card", { props: { title: "集群信息", extra: "更新于 10:24" } })
        .add("Descriptions", {
          props: {
            column: 2,
            items: [
              { label: "区域", children: "cn-north" },
              { label: "节点数", children: "12" },
              { label: "K8s 版本", children: "v1.32.1" },
              { label: "网络插件", children: "cilium" },
            ],
          },
        })
    }

    const buildServices = (main: LiveNode): void => {
      const spin = main.add("Spin", { id: "mainSpin", props: { spinning: false, tip: "刷新中..." } })
      spin.add("Table", {
        props: {
          rowKey: "id",
          columns: [
            { title: "实例", dataIndex: "id", width: 8 },
            { title: "服务", dataIndex: "service", width: 10 },
            { title: "状态", dataIndex: "status", width: 8, align: "center" },
            { title: "CPU", dataIndex: "cpu", width: 6, align: "right" },
            { title: "内存", dataIndex: "mem", width: 8, align: "right" },
          ],
          dataSource: [
            { id: "i-01", service: "gateway", status: "运行中", cpu: "41%", mem: "512Mi" },
            { id: "i-02", service: "user-api", status: "运行中", cpu: "23%", mem: "384Mi" },
            { id: "i-03", service: "billing", status: "重启中", cpu: "87%", mem: "896Mi" },
          ],
        },
      })

      // —— 服务详情(源自 service-dashboard):切换按钮驱动 Descriptions 整组重算 ——
      const SVC = [
        { name: "gateway", ver: "v2.4.1", node: "node-01", owner: "平台组", qps: "3.2k" },
        { name: "user-api", ver: "v1.9.0", node: "node-02", owner: "账号组", qps: "1.1k" },
        { name: "billing", ver: "v3.1.7", node: "node-03", owner: "交易组", qps: "640" },
      ]
      const svcItems = (i: number) => {
        const d = SVC[i]!
        return [
          { label: "服务名", children: d.name },
          { label: "版本", children: d.ver },
          { label: "所在节点", children: d.node },
          { label: "负责团队", children: d.owner },
          { label: "QPS", children: d.qps },
          { label: "健康检查", children: "通过" },
        ]
      }
      const detail = spin.add("Card", { props: { title: "服务详情" } })
      // Button.Group 紧凑组形态(非连体):切换按钮共处一框,竖线分隔
      const svcBtns = detail.add("Button.Group")
      const selectSvc = (i: number) => {
        const desc = $ui.get("svcDesc")
        desc.props.title = `${SVC[i]!.name} 详情`
        desc.props.items = svcItems(i)
      }
      for (const [i, d] of SVC.entries()) {
        svcBtns.add("Button", { content: ` ${d.name} `, props: { tuiOnClick: () => selectSvc(i) } })
      }
      detail.add("Descriptions", {
        id: "svcDesc",
        props: { title: "gateway 详情", column: 3, items: svcItems(0) },
      })
    }

    const buildAlerts = (main: LiveNode): void => {
      const spin = main.add("Spin", { id: "mainSpin", props: { spinning: false, tip: "刷新中..." } })
      spin.add("Alert", {
        props: {
          type: "error",
          showIcon: true,
          message: "billing 实例 i-03 连续 3 次健康检查失败",
          description: "已触发自动重启;若 10 分钟内未恢复将升级为 P1",
        },
      })
      const rules = spin.add("Card", { props: { title: "告警规则", bordered: false } })
      const list = rules.add("List", { id: "alertList", props: { bordered: true } })
      const rule = (text: string, level: string, color: string) => {
        const row = list.add("List.Item").add("Space", { props: { size: 2 } })
        row.add("Typography.Text", { content: text })
        row.add("Tag", { content: level, props: { color } })
      }
      rule("节点 node-07 磁盘使用率 > 85%", "P2", "warning")
      rule("gateway P99 延迟 > 800ms 持续 5 分钟", "P2", "warning")
      rule("cn-east 对象存储访问抖动", "P3", "processing")
      spin.add("Button", {
        content: "全部确认",
        props: {
          tuiSize: "small",
          danger: true,
          tuiOnClick: () => {
            const alerts = $ui.get("alertList")
            for (const child of [...alerts.children]) child.remove()
            alerts.add("List.Item").add("Typography.Text", {
              content: "暂无未确认告警",
              props: { type: "secondary" },
            })
          },
        },
      })
    }

    const buildSettings = (main: LiveNode): void => {
      const spin = main.add("Spin", { id: "mainSpin", props: { spinning: false, tip: "刷新中..." } })
      // —— 部署配置(源自 deploy-config):真函数校验写回 FormItem,watch 联动插删高级卡 ——
      const card = spin.add("Card", { props: { title: "部署配置" } })
      card
        .add("FormItem", { id: "fiName", props: { label: "服务名称", required: true } })
        .add("Input", { name: "name", props: { placeholder: "如 user-api", maxLength: 24 } })

      const rowEnvPort = card.add("Row", { props: { gutter: 2 } })
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

      card
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
      card
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
      card
        .add("FormItem", { props: { label: "启用高级配置" } })
        .add("Switch", {
          name: "advanced",
          default: false,
          props: { checkedChildren: "开", unCheckedChildren: "关" },
        })

      const actionRow = card.add("Space", { id: "deployActions", props: { size: 2 } })

      const buildAdvancedCard = () => {
        // 插在操作行之前
        const adv = card.insert($ui.get("deployActions").index, "Card", {
          id: "advCard",
          props: { title: "高级配置" },
        })
        adv
          .add("FormItem", { props: { label: "CPU 上限 (%)" } })
          .add("Slider", { name: "cpuLimit", default: 50, props: { min: 10, max: 100, step: 5 } })
        adv
          .add("FormItem", { props: { label: "启动脚本" } })
          .add("TextArea", {
            name: "startupScript",
            props: { rows: 3, placeholder: "#!/bin/sh\n每行一条命令" },
          })
        adv.add("Checkbox", { name: "autoRestart", default: true, content: "崩溃后自动重启" })
      }
      if ($ui.data.advanced === true) buildAdvancedCard()
      sectionCleanups.push(
        $ui.watch(
          () => $ui.data.advanced,
          (on) => {
            if (on && !$ui.has("advCard")) buildAdvancedCard()
            else if (!on && $ui.has("advCard")) $ui.get("advCard").remove()
          },
        ),
      )

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
      const deploy = () => {
        if (!validate()) return
        const { name, env, port, region, features, advanced, cpuLimit, startupScript, autoRestart } =
          $ui.data
        const payload = JSON.parse(
          JSON.stringify({
            name,
            env,
            port,
            region,
            features,
            advanced,
            ...(advanced ? { cpuLimit, startupScript, autoRestart } : {}),
          }),
        ) as Record<string, unknown>
        if (actions) actions.submit(payload)
      }
      actionRow.add("Button", { content: "部署", props: { type: "primary", tuiOnClick: deploy } })
    }

    const SECTIONS: Record<SectionKey, (main: LiveNode) => void> = {
      overview: buildOverview,
      services: buildServices,
      alerts: buildAlerts,
      settings: buildSettings,
    }

    goto("overview")
  }

  buildLogin()
}

if (import.meta.main) {
  const { runLiveExample } = await import("./host")
  await runLiveExample(($ui, actions) => buildDashboard($ui, actions), { hideHint: true })
}
