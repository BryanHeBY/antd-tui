/**
 * antd-tui 的 agent 配置文件（JSON）：一个文件承载模型、effort、凭据与自定义
 * OpenAI 兼容端点，经 `--config <path>` 显式传入——宿主不隐式扫描任何全局目录。
 *
 * 与 pi 的关系是「同构而非依赖」：
 * - auth 段的每条凭据就是 pi-ai 的 Credential 判别式（与 pi 的 auth.json 条目同构），
 *   可直接从 pi 的凭据抄过来；
 * - `authFile` 字段可显式引用 pi 原生 `auth.json`（如 ~/.pi/agent/auth.json），
 *   复用 pi `/login` 的成果；该文件里的凭据刷新会写回原文件，与 pi 共享。
 * - 不读 ~/.pi 的任何其它内容；不装 pi 也完全可用。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import {
  createProvider,
  createModels,
  envApiKeyAuth,
  type Credential,
  type CredentialInfo,
  type CredentialStore,
  type Models,
  type MutableModels,
} from "@earendil-works/pi-ai"
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy"
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy"
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic"
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek"
import { googleProvider } from "@earendil-works/pi-ai/providers/google"
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai"
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter"
import { xaiProvider } from "@earendil-works/pi-ai/providers/xai"
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai"

/** 自定义 OpenAI 兼容端点（wireApi: "chat" = completions，"responses" = OpenAI Responses） */
export interface CustomProviderConfig {
  baseUrl: string
  wireApi?: "chat" | "responses"
  /** 解析 API key 的环境变量名；缺省不鉴权（本地推理服务常见） */
  keyEnv?: string
}

export interface AgentConfigFile {
  /** 默认模型 `provider/model`；优先级：--model / PI_MODEL > 此处 */
  model?: string
  /** 推理力度 → pi thinkingLevel；优先级：--effort / PI_EFFORT > 此处 */
  effort?: PiEffort
  /** per-provider 凭据（pi-ai Credential 判别式）；同 provider 覆盖 authFile */
  auth?: Record<string, Credential>
  /** 显式引用 pi 原生 auth.json（如 ~/.pi/agent/auth.json）；不隐式扫描 */
  authFile?: string
  /** 自定义 OpenAI 兼容端点，键为 provider id（spec 的 provider 段） */
  providers?: Record<string, CustomProviderConfig>
}

export const PI_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const
export type PiEffort = (typeof PI_EFFORTS)[number]

export interface PiRuntime {
  models: Models
  /** 解析后的 `provider/model` */
  spec: string
  thinkingLevel?: PiEffort
}

/** pi auth.json / config 的同构校验：与 pi 自身的读取逻辑一致，坏条目立刻报错 */
function assertCredential(providerId: string, credential: unknown): asserts credential is Credential {
  if (typeof credential !== "object" || credential === null || Array.isArray(credential)) {
    throw new Error(`配置文件里 ${providerId} 的凭据不是对象`)
  }
  const value = credential as Record<string, unknown>
  if (value.type === "api_key") {
    const keyOk = value.key === undefined || typeof value.key === "string"
    const envOk =
      value.env === undefined ||
      (typeof value.env === "object" &&
        value.env !== null &&
        !Array.isArray(value.env) &&
        Object.values(value.env).every((entry) => typeof entry === "string"))
    if (keyOk && envOk) return
  } else if (
    value.type === "oauth" &&
    typeof value.access === "string" &&
    typeof value.refresh === "string" &&
    typeof value.expires === "number" &&
    Number.isFinite(value.expires)
  ) {
    return
  }
  throw new Error(`配置文件里 ${providerId} 的凭据格式不合法（api_key 或 oauth 判别式）`)
}

function expandTilde(path: string): string {
  if (path === "~") return homedir()
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2))
  return path
}

function readCredentialFile(path: string): Record<string, Credential> {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"))
  } catch (err) {
    throw new Error(`读取凭据文件 ${path} 失败：${(err as Error).message}`)
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`凭据文件 ${path} 应为 { providerId: credential } 对象`)
  }
  for (const [providerId, credential] of Object.entries(parsed)) {
    assertCredential(providerId, credential)
  }
  return parsed as Record<string, Credential>
}

/**
 * 读入并解析配置文件。文件不存在 / JSON 损坏 / 格式不合法都立即抛错——
 * 配置错误不该静默降级。
 */
export function loadAgentConfig(configPath: string): AgentConfigFile {
  const path = expandTilde(configPath)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"))
  } catch (err) {
    throw new Error(`读取配置文件 ${path} 失败：${(err as Error).message}`)
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`配置文件 ${path} 应为 JSON 对象`)
  }
  const config = parsed as AgentConfigFile
  if (config.model !== undefined && typeof config.model !== "string") {
    throw new Error('配置文件 model 应为 "provider/model" 字符串')
  }
  if (config.auth !== undefined) {
    for (const [providerId, credential] of Object.entries(config.auth)) {
      assertCredential(providerId, credential)
    }
  }
  for (const [id, provider] of Object.entries(config.providers ?? {})) {
    if (!provider || typeof provider.baseUrl !== "string") {
      throw new Error(`自定义 provider ${id} 缺少 baseUrl`)
    }
  }
  return config
}

/**
 * 凭据存储：内存为主；来自 authFile 的条目在 modify/delete 时写回原文件
 * （OAuth 刷新后的 token 与 pi 共享），内嵌 auth 段只在本次进程内生效。
 */
class ConfigCredentialStore implements CredentialStore {
  private readonly credentials: Map<string, Credential>
  private readonly persisted: Set<string>

  constructor(
    credentials: Record<string, Credential>,
    private readonly authFilePath: string | null,
    persistedIds: Iterable<string>,
  ) {
    this.credentials = new Map(Object.entries(credentials))
    this.persisted = new Set(persistedIds)
  }

  async read(providerId: string): Promise<Credential | undefined> {
    const credential = this.credentials.get(providerId)
    return credential ? structuredClone(credential) : undefined
  }

  async list(): Promise<readonly CredentialInfo[]> {
    return [...this.credentials].map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }))
  }

  async modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    const current = this.credentials.get(providerId)
    const next = await fn(current ? structuredClone(current) : undefined)
    if (next === undefined) return current
    assertCredential(providerId, next)
    this.credentials.set(providerId, next)
    this.persistIfSourced(providerId)
    return structuredClone(next)
  }

  async delete(providerId: string): Promise<void> {
    this.credentials.delete(providerId)
    this.persistIfSourced(providerId)
  }

  /** 只把「本来就来自 authFile 的 provider」写回文件；内嵌凭据绝不落盘 */
  private persistIfSourced(providerId: string): void {
    if (!this.authFilePath || !this.persisted.has(providerId)) return
    const file: Record<string, Credential> = existsSync(this.authFilePath)
      ? readCredentialFile(this.authFilePath)
      : {}
    const credential = this.credentials.get(providerId)
    if (credential) file[providerId] = credential
    else delete file[providerId]
    mkdirSync(dirname(this.authFilePath), { recursive: true })
    writeFileSync(this.authFilePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8")
  }
}

function credentialStoreOf(config: AgentConfigFile): CredentialStore | undefined {
  const authFilePath = config.authFile ? expandTilde(config.authFile) : null
  const hasInline = config.auth !== undefined && Object.keys(config.auth).length > 0
  if (!authFilePath && !hasInline) return undefined
  let merged: Record<string, Credential> = {}
  let persisted: string[] = []
  if (authFilePath && existsSync(authFilePath)) {
    merged = readCredentialFile(authFilePath)
    persisted = Object.keys(merged)
  }
  // 内嵌 auth 段更具体，同 provider 覆盖 authFile
  if (config.auth) merged = { ...merged, ...config.auth }
  return new ConfigCredentialStore(merged, authFilePath, persisted)
}

/** 供 PiAgent 默认路径与配置路径共用：六个内置 provider */
export function registerBuiltinProviders(models: MutableModels): void {
  models.setProvider(anthropicProvider())
  models.setProvider(openaiProvider())
  models.setProvider(openaiCodexProvider())
  models.setProvider(googleProvider())
  models.setProvider(openrouterProvider())
  models.setProvider(deepseekProvider())
  models.setProvider(xaiProvider())
  models.setProvider(zaiProvider())
}

export const BUILTIN_PROVIDER_IDS =
  "anthropic/openai/openai-codex/google/openrouter/deepseek/xai/zai"

export interface PiRuntimeOptions {
  /** --config 的路径；不传则自动采用当前目录的 agent.json（存在才用），再退到 env / 内置 provider */
  configPath?: string
  /** --model 的显式模型 */
  model?: string
  /** --effort 的显式推理力度 */
  effort?: PiEffort
}

/** 工作区本地配置的约定位置：与 .env 同哲学，存在即用，不向全局目录扫描 */
export const WORKSPACE_CONFIG = "agent.json"

/** 配置解析顺序：--config 显式路径 > 当前目录 agent.json（存在才用） */
export function resolveConfigPath(explicit?: string): string | undefined {
  if (explicit) return explicit
  return existsSync(WORKSPACE_CONFIG) ? WORKSPACE_CONFIG : undefined
}

/**
 * 解析 pi 后端运行时：模型优先级 --model / --agent pi: > PI_MODEL > 配置文件 model；
 * effort 同理（--effort > PI_EFFORT > 配置 effort）。凭据来自配置文件（auth/authFile），
 * 缺省回退各 provider 的环境变量。一个模型都解析不出来时抛错并给出指引。
 */
export function buildPiRuntime(options: PiRuntimeOptions = {}): PiRuntime {
  const configPath = resolveConfigPath(options.configPath)
  const config = configPath ? loadAgentConfig(configPath) : {}
  const spec = options.model ?? process.env.PI_MODEL ?? config.model
  if (!spec) {
    throw new Error(
      "pi 后端没有可用的模型：用 --model provider/model、环境变量 PI_MODEL，或在 --config 文件里设 model",
    )
  }
  const thinkingLevel = options.effort ?? (process.env.PI_EFFORT as PiEffort | undefined) ?? config.effort
  const slash = spec.indexOf("/")
  const modelId = slash > 0 ? spec.slice(slash + 1) : ""
  const providerId = slash > 0 ? spec.slice(0, slash) : ""
  if (!providerId || !modelId) {
    throw new Error(`pi 模型规格应为 provider/model，收到 "${spec}"`)
  }

  const models = createModels({ credentials: credentialStoreOf(config) })
  registerBuiltinProviders(models)

  const custom = config.providers?.[providerId]
  if (custom) {
    models.setProvider(
      createProvider({
        id: providerId,
        name: providerId,
        baseUrl: custom.baseUrl,
        auth: custom.keyEnv
          ? { apiKey: envApiKeyAuth(providerId, [custom.keyEnv]) }
          : { apiKey: { name: providerId, resolve: async () => ({ auth: {} }) } },
        api: custom.wireApi === "chat" ? openAICompletionsApi() : openAIResponsesApi(),
        models: [
          {
            id: modelId,
            name: modelId,
            api: custom.wireApi === "chat" ? "openai-completions" : "openai-responses",
            provider: providerId,
            baseUrl: custom.baseUrl,
            reasoning: true,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200000,
            maxTokens: 64000,
          },
        ],
      }),
    )
  }
  if (!models.getModel(providerId, modelId)) {
    throw new Error(
      `pi 后端找不到模型 "${spec}"；内置 provider：${BUILTIN_PROVIDER_IDS}，自定义端点请在 --config 的 providers 里定义 "${providerId}"`,
    )
  }
  return { models, spec, thinkingLevel }
}
