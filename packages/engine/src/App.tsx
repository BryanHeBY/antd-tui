import { useMemo } from "react"
import { useKeyboard } from "@opentui/react"
import { createForm } from "@formily/core"
import type { ISchema } from "@formily/react"
import {
  Button,
  ConfigProvider,
  FocusScope,
  Space,
  Typography,
} from "@antd-tui/components"
import { FormProvider, SchemaField, compileScope } from "@antd-tui/formily"
import type { PageAction, PageSchema } from "./validate"

export interface AppProps {
  schema: PageSchema
  onFinish: (values: Record<string, unknown>) => void
  onCancel: () => void
}

const DEFAULT_ACTIONS: PageAction[] = [{ type: "submit" }, { type: "cancel" }]

export function App({ schema, onFinish, onCancel }: AppProps) {
  const form = useMemo(() => createForm(), [])
  // $memo：页面级可变对象，供 scope 函数存放隐藏交互状态（不进 form.values、不回传）
  const scope = useMemo(
    () => compileScope(schema.scope, { $form: form, $memo: {} }),
    [schema.scope, form],
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
      .catch(() => {
        // 校验失败：错误已写入各 field.selfErrors，由 FormItem 展示
      })
  }

  return (
    <ConfigProvider>
      <FocusScope>
        <box style={{ flexDirection: "column", padding: 1, gap: 1, width: "100%", height: "100%" }}>
          {schema.page?.title ? <Typography.Title>{schema.page.title}</Typography.Title> : null}
          {schema.page?.description ? (
            <Typography.Text type="secondary">{schema.page.description}</Typography.Text>
          ) : null}

          {/* 表单区撑满剩余高度：可伸展组件（Row 等）自动均分空间 */}
          <box style={{ flexDirection: "column", flexGrow: 1, flexShrink: 1, gap: 1 }}>
            <FormProvider form={form}>
              <SchemaField schema={schema.form as ISchema} scope={scope} />
            </FormProvider>
          </box>

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
