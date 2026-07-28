import { useMemo } from "react"
import { useKeyboard } from "@opentui/react"
import { createForm, setValidateLanguage } from "@formily/core"
import { observable } from "@formily/reactive"
import type { ISchema } from "@formily/react"
import {
  Button,
  ConfigProvider,
  FocusScope,
  Space,
  Typography,
  message,
  type ThemeTokens,
} from "@antd-tui/components"
import { FormProvider, SchemaField, compileScope } from "@antd-tui/formily"
import type { PageAction, PageSchema } from "./validate"

export interface AppProps {
  schema: PageSchema
  onFinish: (values: Record<string, unknown>) => void
  onCancel: () => void
}

const DEFAULT_ACTIONS: PageAction[] = [{ type: "submit" }, { type: "cancel" }]

// 校验消息用中文（formily 默认 en，会出现 "The field value is required"）
setValidateLanguage("zh-CN")

export function App({ schema, onFinish, onCancel }: AppProps) {
  const form = useMemo(() => createForm(), [])
  const [messageApi, messageHolder] = message.useMessage()
  // 三个状态通道的分工：
  // $state：响应式 UI 状态（schema.state 声明初值），表达式读取自动联动，不进 form.values、不回传
  // $memo：非渲染状态（timer/标记位），无响应性
  // form.values：只装用户输入，提交/Esc 时回传
  const scope = useMemo(
    () => compileScope(schema.scope, { $form: form, $state: observable({ ...schema.state }), $memo: {} }),
    [schema.scope, schema.state, form],
  )

  // interactive 模式：无操作栏的自包含交互页面，Esc 完成并回传当前值
  const interactive = schema.page?.mode === "interactive"
  const actions = interactive ? [] : schema.actions?.length ? schema.actions : DEFAULT_ACTIONS

  useKeyboard((key) => {
    if (key.name === "escape") {
      if (interactive) onFinish(form.values as Record<string, unknown>)
      else onCancel()
    }
  })

  const handleSubmit = () => {
    form
      .submit((values: Record<string, unknown>) => {
        onFinish(values)
      })
      .catch((feedbacks: Array<{ address?: string; messages?: unknown[] }>) => {
        // 校验失败：行内错误已由 FormItem 展示，这里再弹全局提示，
        // 防止错误字段滚出视口后用户误以为「点了没反应」
        const first = Array.isArray(feedbacks) ? feedbacks[0] : undefined
        const title = first?.address
          ? ((form.query(first.address).take()?.title as string | undefined) ?? first.address)
          : ""
        const detail = first?.messages?.filter(Boolean).join("；") ?? ""
        messageApi.error(`校验未通过${title ? `：${title}` : ""}${detail ? ` ${detail}` : ""}`)
      })
  }

  return (
    <ConfigProvider theme={schema.theme as { token?: Partial<ThemeTokens> } | undefined}>
      <FocusScope>
        {messageHolder}
        <box style={{ flexDirection: "column", padding: 1, gap: 1, width: "100%", height: "100%" }}>
          {schema.page?.title ? <Typography.Title>{schema.page.title}</Typography.Title> : null}
          {schema.page?.description ? (
            <Typography.Text type="secondary">{schema.page.description}</Typography.Text>
          ) : null}

          {/* 表单区可滚动：内容超出终端高度时滚动而非被 flex 压缩变形；
              content 最小高度撑满视口，计算器这类 flex 均分布局不受影响 */}
          <scrollbox
            style={{ flexGrow: 1, flexShrink: 1 }}
            scrollY
            scrollX={false}
            contentOptions={{ flexDirection: "column", gap: 1, minHeight: "100%" }}
          >
            <FormProvider form={form}>
              <SchemaField schema={schema.form as ISchema} scope={scope} />
            </FormProvider>
          </scrollbox>

          <box style={{ flexDirection: "column", gap: 1, flexShrink: 0 }}>
            {actions.length > 0 ? (
              <Space direction="horizontal" size={2}>
                {actions.map((action, i) =>
                  action.type === "submit" ? (
                    <Button key={i} type="primary" onClick={handleSubmit}>
                      {action.label ?? "提交"}
                    </Button>
                  ) : (
                    <Button key={i} onClick={onCancel}>
                      {action.label ?? "取消"}
                    </Button>
                  ),
                )}
              </Space>
            ) : null}

            <Typography.Text type="secondary">
              {interactive
                ? "方向键 移动 · Enter 确认 · Esc 退出"
                : "Tab 切换焦点 · Enter 确认 · Esc 取消"}
            </Typography.Text>
          </box>
        </box>
      </FocusScope>
    </ConfigProvider>
  )
}
