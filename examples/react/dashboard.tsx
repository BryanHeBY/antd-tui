/**
 * 原生 React 版运维控制台(dashboard):与 schema/repl 版同一页面,第三种形态——
 * 不经 engine(JSON 声明)也不经 $ui(命令式活树),组件库当普通 React 组件用:
 * 换页是条件渲染、联动是 useState、校验是普通函数、动态区域是 JSX 表达式。
 * 三版对照阅读,可以看清同一界面在三个抽象层上的表达差异。
 *
 * 运行:bun run examples:dash:react(需要 TTY);登录后 Esc = 完成回传设置表单
 */
import { useState } from "react"
import { useKeyboard } from "@opentui/react"
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Divider,
  Flex,
  FormItem,
  Input,
  InputNumber,
  List,
  Modal,
  Progress,
  Radio,
  Row,
  Select,
  Slider,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  useFocusScopeState,
} from "@antd-tui/components"
import type { ExampleActions } from "./host"

// —— 登录页:条件渲染换页(schema 版是 x-visible,repl 版是 $ui.clear 重建) ——
function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [user, setUser] = useState("")
  const [pass, setPass] = useState("")
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  const doLogin = () => {
    if (!user.trim() || !pass.trim()) {
      setError("用户名与密码不能为空")
      return
    }
    setLoading(true)
    setTimeout(onLoggedIn, 500)
  }

  return (
    <Flex vertical justify="center" align="center" style={{ width: "100%", height: "100%" }}>
      <Card title="运维控制台" style={{ width: 46 }}>
        <Typography.Title>登录</Typography.Title>
        <FormItem label="用户名">
          <Input placeholder="ops-admin" maxLength={24} value={user} tuiOnChange={setUser} />
        </FormItem>
        <FormItem label="密码">
          <Input placeholder="任意非空" value={pass} tuiOnChange={setPass} tuiOnPressEnter={doLogin} />
        </FormItem>
        <Flex justify="space-between" align="center">
          <Checkbox checked={remember} tuiOnChange={setRemember}>
            记住我
          </Checkbox>
          <Typography.Link type="secondary" tuiOnClick={() => setResetOpen(true)}>
            忘记密码
          </Typography.Link>
        </Flex>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        <Button type="primary" block loading={loading} tuiOnClick={doLogin}>
          登 录
        </Button>
      </Card>
      <Modal
        open={resetOpen}
        title="重置密码"
        footer={null}
        tuiWidth={40}
        tuiOnCancel={() => setResetOpen(false)}
      >
        <Typography.Text>请联系平台组 @ops 重置密码(Esc 关闭)</Typography.Text>
      </Modal>
    </Flex>
  )
}

// —— 各分区 ——
function Overview({ spinning }: { spinning: boolean }) {
  const [cpu, setCpu] = useState(42)
  const bump = (d: number) => setCpu((v) => Math.min(100, Math.max(0, v + d)))
  return (
    <Spin spinning={spinning} tip="刷新中...">
      <Alert type="warning" showIcon message="cn-north 集群今晚 23:00 例行维护,新实例调度可能延迟" />
      <Row gutter={2}>
        <Col flex={1}>
          <Statistic title="请求量" value={12483} suffix="次/分" />
        </Col>
        <Col flex={1}>
          <Statistic title="错误率" value={0.42} precision={2} suffix="%" tuiValueType="danger" />
        </Col>
        <Col flex={1}>
          <Statistic title="持续运行" value={36} suffix="天" tuiValueType="success" />
        </Col>
      </Row>
      <Card title="节点负载">
        <Progress percent={cpu} status={cpu >= 90 ? "exception" : "active"} />
        <Space size={2}>
          <Button tuiSize="small" tuiHotkey="+" tuiOnClick={() => bump(10)}>
            负载 +10
          </Button>
          <Button tuiSize="small" tuiHotkey="-" tuiOnClick={() => bump(-10)}>
            负载 -10
          </Button>
        </Space>
      </Card>
      <Space size={2}>
        <Tag color="success">SLA 达标</Tag>
        <Tag color="processing">灰度中</Tag>
        <Tag bordered={false}>cn-north</Tag>
      </Space>
      <Divider orientation="left" dashed>
        最近事件
      </Divider>
      <List bordered>
        <List.Item extra={<Tag color="success">发布</Tag>}>10:24 gateway 滚动发布完成</List.Item>
        <List.Item extra={<Tag color="warning">自愈</Tag>}>09:58 billing 实例 i-03 重启</List.Item>
        <List.Item extra={<Tag color="processing">扩容</Tag>}>09:12 user-api 扩容 2 副本</List.Item>
      </List>
      <Card title="集群信息" extra="更新于 10:24">
        <Descriptions
          column={2}
          items={[
            { label: "区域", children: "cn-north" },
            { label: "节点数", children: "12" },
            { label: "K8s 版本", children: "v1.32.1" },
            { label: "网络插件", children: "cilium" },
          ]}
        />
      </Card>
    </Spin>
  )
}

const SVC = [
  { name: "gateway", ver: "v2.4.1", node: "node-01", owner: "平台组", qps: "3.2k" },
  { name: "user-api", ver: "v1.9.0", node: "node-02", owner: "账号组", qps: "1.1k" },
  { name: "billing", ver: "v3.1.7", node: "node-03", owner: "交易组", qps: "640" },
]

function Services({ spinning }: { spinning: boolean }) {
  const [current, setCurrent] = useState(0)
  const d = SVC[current]!
  return (
    <Spin spinning={spinning} tip="刷新中...">
      <Table
        rowKey="id"
        columns={[
          { title: "实例", dataIndex: "id", width: 8 },
          { title: "服务", dataIndex: "service", width: 10 },
          { title: "状态", dataIndex: "status", width: 8, align: "center" },
          { title: "CPU", dataIndex: "cpu", width: 6, align: "right" },
          { title: "内存", dataIndex: "mem", width: 8, align: "right" },
        ]}
        dataSource={[
          { id: "i-01", service: "gateway", status: "运行中", cpu: "41%", mem: "512Mi" },
          { id: "i-02", service: "user-api", status: "运行中", cpu: "23%", mem: "384Mi" },
          { id: "i-03", service: "billing", status: "重启中", cpu: "87%", mem: "896Mi" },
        ]}
      />
      <Card title="服务详情">
        <Button.Group>
          {SVC.map((svc, i) => (
            <Button key={svc.name} tuiOnClick={() => setCurrent(i)}>
              {` ${svc.name} `}
            </Button>
          ))}
        </Button.Group>
        <Descriptions
          title={`${d.name} 详情`}
          column={3}
          items={[
            { label: "服务名", children: d.name },
            { label: "版本", children: d.ver },
            { label: "所在节点", children: d.node },
            { label: "负责团队", children: d.owner },
            { label: "QPS", children: d.qps },
            { label: "健康检查", children: "通过" },
          ]}
        />
      </Card>
    </Spin>
  )
}

function Alerts({ spinning }: { spinning: boolean }) {
  const [cleared, setCleared] = useState(false)
  return (
    <Spin spinning={spinning} tip="刷新中...">
      <Alert
        type="error"
        showIcon
        message="billing 实例 i-03 连续 3 次健康检查失败"
        description="已触发自动重启;若 10 分钟内未恢复将升级为 P1"
      />
      <Card title="告警规则" bordered={false}>
        {cleared ? (
          <Typography.Text type="secondary">暂无未确认告警</Typography.Text>
        ) : (
          <List bordered>
            <List.Item extra={<Tag color="warning">P2</Tag>}>节点 node-07 磁盘使用率 &gt; 85%</List.Item>
            <List.Item extra={<Tag color="warning">P2</Tag>}>gateway P99 延迟 &gt; 800ms 持续 5 分钟</List.Item>
            <List.Item extra={<Tag color="processing">P3</Tag>}>cn-east 对象存储访问抖动</List.Item>
          </List>
        )}
      </Card>
      <Button tuiSize="small" danger tuiOnClick={() => setCleared(true)}>
        全部确认
      </Button>
    </Spin>
  )
}

export interface DeployForm {
  name: string
  env: string
  port: number | null
  region: string
  features: Array<string | number>
  advanced: boolean
  cpuLimit: number
  startupScript: string
  autoRestart: boolean
}

export const DEFAULT_FORM: DeployForm = {
  name: "",
  env: "dev",
  port: 8080,
  region: "cn-north",
  features: ["log"],
  advanced: false,
  cpuLimit: 50,
  startupScript: "",
  autoRestart: true,
}

function Settings({
  spinning,
  form,
  onChange,
  onDeploy,
}: {
  spinning: boolean
  form: DeployForm
  onChange: (patch: Partial<DeployForm>) => void
  onDeploy: () => void
}) {
  // 校验错误放本地 state,由「部署」触发(repl 版是写回 FormItem props,同一语义)
  const [errors, setErrors] = useState<{ name?: string; port?: string }>({})

  const deploy = () => {
    const next: { name?: string; port?: string } = {}
    if (form.name === "") next.name = "服务名称必填"
    else if (!/^[a-z][a-z0-9-]*$/.test(form.name))
      next.name = "仅允许小写字母、数字与中划线，且以字母开头"
    const port = Number(form.port ?? 0)
    if (!Number.isInteger(port) || port < 1 || port > 65535) next.port = "端口范围 1-65535"
    setErrors(next)
    if (!next.name && !next.port) onDeploy()
  }

  return (
    <Spin spinning={spinning} tip="刷新中...">
      <Card title="部署配置">
        <FormItem label="服务名称" required help={errors.name} validateStatus={errors.name ? "error" : undefined}>
          <Input
            placeholder="如 user-api"
            maxLength={24}
            value={form.name}
            tuiOnChange={(name) => onChange({ name })}
          />
        </FormItem>
        <Row gutter={2}>
          <Col flex={1}>
            <FormItem label="部署环境">
              <Select
                value={form.env}
                tuiOnChange={(env) => onChange({ env: String(env) })}
                options={[
                  { label: "开发", value: "dev" },
                  { label: "测试", value: "test" },
                  { label: "生产", value: "prod" },
                ]}
              />
            </FormItem>
          </Col>
          <Col flex={1}>
            <FormItem label="服务端口" help={errors.port} validateStatus={errors.port ? "error" : undefined}>
              <InputNumber placeholder="1-65535" value={form.port ?? undefined} onChange={(port) => onChange({ port })} />
            </FormItem>
          </Col>
        </Row>
        <FormItem label="部署地域">
          <Radio.Group
            optionType="button"
            value={form.region}
            tuiOnChange={(region) => onChange({ region: String(region) })}
            options={[
              { label: "华北", value: "cn-north" },
              { label: "华东", value: "cn-east" },
              { label: "华南", value: "cn-south" },
            ]}
          />
        </FormItem>
        <FormItem label="附加能力">
          <Checkbox.Group
            tuiDirection="horizontal"
            value={form.features}
            onChange={(features) => onChange({ features })}
            options={[
              { label: "日志采集", value: "log" },
              { label: "链路追踪", value: "trace" },
              { label: "自动扩缩容", value: "autoscale" },
            ]}
          />
        </FormItem>
        <FormItem label="启用高级配置">
          <Switch
            checked={form.advanced}
            checkedChildren="开"
            unCheckedChildren="关"
            tuiOnChange={(advanced) => onChange({ advanced })}
          />
        </FormItem>
        {/* 联动显隐就是条件渲染(schema 版 x-reactions / repl 版 watch 插删) */}
        {form.advanced ? (
          <Card title="高级配置">
            <FormItem label="CPU 上限 (%)">
              <Slider min={10} max={100} step={5} value={form.cpuLimit} onChange={(cpuLimit) => onChange({ cpuLimit: cpuLimit ?? 50 })} />
            </FormItem>
            <FormItem label="启动脚本">
              <Input.TextArea
                rows={3}
                placeholder={"#!/bin/sh\n每行一条命令"}
                value={form.startupScript}
                tuiOnChange={(startupScript) => onChange({ startupScript })}
              />
            </FormItem>
            <Checkbox checked={form.autoRestart} tuiOnChange={(autoRestart) => onChange({ autoRestart })}>
              崩溃后自动重启
            </Checkbox>
          </Card>
        ) : null}
        <Space size={2}>
          <Button type="primary" tuiOnClick={deploy}>
            部署
          </Button>
        </Space>
      </Card>
    </Spin>
  )
}

// —— App Shell:满幅顶栏 + 满高侧栏 + 内滚主区 ——
type SectionKey = "overview" | "services" | "alerts" | "settings"

const NAV: Array<{ key: SectionKey; label: string; hotkey: string }> = [
  { key: "overview", label: "概览", hotkey: "1" },
  { key: "services", label: "服务", hotkey: "2" },
  { key: "alerts", label: "告警", hotkey: "3" },
  { key: "settings", label: "设置", hotkey: "4" },
]

function Shell({ actions }: { actions?: ExampleActions }) {
  const [section, setSection] = useState<SectionKey>("overview")
  const [spinning, setSpinning] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [form, setForm] = useState<DeployForm>(DEFAULT_FORM)
  const { isActiveScope } = useFocusScopeState()

  const refresh = () => {
    setSpinning(true)
    setTimeout(() => setSpinning(false), 600)
  }
  const patch = (p: Partial<DeployForm>) => setForm((f) => ({ ...f, ...p }))

  // Esc = 完成回传设置表单(与 schema/repl 版 interactive 语义一致);浮层开着时让位给 Modal
  useKeyboard((key) => {
    if (key.name === "escape" && !helpOpen && isActiveScope()) {
      actions?.submit(JSON.parse(JSON.stringify(form)) as Record<string, unknown>)
    }
  })

  return (
    <Flex vertical gap={0} style={{ width: "100%", height: "100%" }}>
      <Flex justify="space-between" align="center" style={{ width: "100%", backgroundColor: "#1f1f1f", padding: 1 }}>
        <Typography.Text strong style={{ color: "#e6e6e6" }}>
          {" ☰ 运维控制台 "}
        </Typography.Text>
        <Space size={1}>
          <Button tuiSize="small" tuiHotkey="r" tuiOnClick={refresh}>
            {" 刷新 r "}
          </Button>
          <Button tuiSize="small" tuiHotkey="h" tuiOnClick={() => setHelpOpen(true)}>
            {" 帮助 h "}
          </Button>
          <Button tuiSize="small" tuiHotkey="q" tuiOnClick={() => actions?.cancel()}>
            {" 退出 q "}
          </Button>
        </Space>
      </Flex>
      <Row gutter={0} wrap={false} style={{ flex: 1 }}>
        <Col style={{ width: 16 }}>
          <Flex vertical gap={0} style={{ height: "100%", backgroundColor: "#171717" }}>
            {NAV.map((item) => (
              <Button
                key={item.key}
                tuiSize="small"
                block
                style={{ padding: 1 }}
                type={section === item.key ? "primary" : "default"}
                tuiHotkey={item.hotkey}
                tuiOnClick={() => setSection(item.key)}
              >
                {`${item.hotkey}  ${item.label}`}
              </Button>
            ))}
          </Flex>
        </Col>
        <Col flex={1}>
          <Flex vertical gap={1} tuiScroll style={{ height: "100%", marginLeft: 1, marginTop: 1 }}>
            {section === "overview" ? <Overview spinning={spinning} /> : null}
            {section === "services" ? <Services spinning={spinning} /> : null}
            {section === "alerts" ? <Alerts spinning={spinning} /> : null}
            {section === "settings" ? (
              <Settings
                spinning={spinning}
                form={form}
                onChange={patch}
                onDeploy={() => actions?.submit(JSON.parse(JSON.stringify(form)) as Record<string, unknown>)}
              />
            ) : null}
          </Flex>
        </Col>
      </Row>
      <Modal
        open={helpOpen}
        title="帮助"
        tuiWidth={46}
        okText="知道了"
        tuiOnOk={() => setHelpOpen(false)}
        tuiOnCancel={() => setHelpOpen(false)}
      >
        <Typography.Text>数字键 1-4 切换左侧导航;r 刷新当前页。</Typography.Text>
        <Typography.Text>主区内容超高时用鼠标滚轮上下翻页。</Typography.Text>
        <Typography.Text>设置页表单即组件 state,Esc 完成回传。</Typography.Text>
      </Modal>
    </Flex>
  )
}

export function Dashboard({ actions }: { actions?: ExampleActions }) {
  const [loggedIn, setLoggedIn] = useState(false)
  return loggedIn ? <Shell actions={actions} /> : <Login onLoggedIn={() => setLoggedIn(true)} />
}

if (import.meta.main) {
  const { runReactExample } = await import("./host")
  await runReactExample((actions) => <Dashboard actions={actions} />)
}
