/**
 * antd 暗色色板派生（移植自 @ant-design/colors 的 generate 暗色算法）。
 *
 * seed 色（如 #1677ff）→ 10 阶暗色色板：先按 HSV 步进生成亮色 10 阶，
 * 再按固定透明度表向暗背景（#141414）掺混，得到低饱和、贴合黑底的暗色阶。
 * 索引约定与 antd 一致：palette[5] 为主色（填充），palette[6] 为 hover 档
 * （终端无 hover，本框架把它用于聚焦/前景高亮）。
 */

interface Hsv {
  h: number
  s: number
  v: number
}

interface Rgb {
  r: number
  g: number
  b: number
}

const HUE_STEP = 2
const SATURATION_STEP = 0.16
const SATURATION_STEP2 = 0.05
const BRIGHTNESS_STEP1 = 0.05
const BRIGHTNESS_STEP2 = 0.15
const LIGHT_COLOR_COUNT = 5
const DARK_COLOR_COUNT = 4

/** 暗色掺混表：{ 亮色阶下标, 前景占比 }，与 @ant-design/colors 完全一致 */
const DARK_COLOR_MAP = [
  { index: 7, opacity: 0.15 },
  { index: 6, opacity: 0.25 },
  { index: 5, opacity: 0.3 },
  { index: 5, opacity: 0.45 },
  { index: 5, opacity: 0.65 },
  { index: 5, opacity: 0.85 },
  { index: 4, opacity: 0.9 },
  { index: 3, opacity: 0.95 },
  { index: 2, opacity: 0.97 },
  { index: 1, opacity: 0.98 },
]

const DARK_BACKGROUND: Rgb = { r: 0x14, g: 0x14, b: 0x14 }

function hexToRgb(hex: string): Rgb {
  const raw = hex.replace("#", "")
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw
  const num = parseInt(full, 16)
  return { r: (num >> 16) & 0xff, g: (num >> 8) & 0xff, b: num & 0xff }
}

function rgbToHex({ r, g, b }: Rgb): string {
  const to2 = (n: number) => n.toString(16).padStart(2, "0")
  return `#${to2(r)}${to2(g)}${to2(b)}`
}

function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6
    else if (max === gg) h = (bb - rr) / d + 2
    else h = (rr - gg) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let rr = 0
  let gg = 0
  let bb = 0
  if (h < 60) [rr, gg, bb] = [c, x, 0]
  else if (h < 120) [rr, gg, bb] = [x, c, 0]
  else if (h < 180) [rr, gg, bb] = [0, c, x]
  else if (h < 240) [rr, gg, bb] = [0, x, c]
  else if (h < 300) [rr, gg, bb] = [x, 0, c]
  else [rr, gg, bb] = [c, 0, x]
  return {
    r: Math.round((rr + m) * 255),
    g: Math.round((gg + m) * 255),
    b: Math.round((bb + m) * 255),
  }
}

function getHue(hsv: Hsv, i: number, light: boolean): number {
  const hDeg = Math.round(hsv.h)
  // 冷暖色相反方向偏移（60-240 为冷色域）
  let hue: number
  if (hDeg >= 60 && hDeg <= 240) hue = light ? hDeg - HUE_STEP * i : hDeg + HUE_STEP * i
  else hue = light ? hDeg + HUE_STEP * i : hDeg - HUE_STEP * i
  if (hue < 0) hue += 360
  else if (hue >= 360) hue -= 360
  return hue
}

function getSaturation(hsv: Hsv, i: number, light: boolean): number {
  // 灰色不参与饱和度推导
  if (hsv.h === 0 && hsv.s === 0) return hsv.s
  let saturation: number
  if (light) saturation = hsv.s - SATURATION_STEP * i
  else if (i === DARK_COLOR_COUNT) saturation = hsv.s + SATURATION_STEP
  else saturation = hsv.s + SATURATION_STEP2 * i
  if (saturation > 1) saturation = 1
  if (light && i === LIGHT_COLOR_COUNT && saturation > 0.1) saturation = 0.1
  if (saturation < 0.06) saturation = 0.06
  return Math.round(saturation * 100) / 100
}

function getValue(hsv: Hsv, i: number, light: boolean): number {
  let value: number
  if (light) value = hsv.v + BRIGHTNESS_STEP1 * i
  else value = hsv.v - BRIGHTNESS_STEP2 * i
  if (value > 1) value = 1
  return Math.round(value * 100) / 100
}

function mix(bg: Rgb, fg: Rgb, amount: number): Rgb {
  return {
    r: Math.round(bg.r + (fg.r - bg.r) * amount),
    g: Math.round(bg.g + (fg.g - bg.g) * amount),
    b: Math.round(bg.b + (fg.b - bg.b) * amount),
  }
}

/** 生成 10 阶暗色色板。palette[5] 为主色（填充），palette[6] 为 hover/聚焦档 */
export function darkPalette(seed: string): string[] {
  const hsv = rgbToHsv(hexToRgb(seed))
  const light: Rgb[] = []
  for (let i = LIGHT_COLOR_COUNT; i > 0; i -= 1) {
    light.push(
      hsvToRgb({
        h: getHue(hsv, i, true),
        s: getSaturation(hsv, i, true),
        v: getValue(hsv, i, true),
      }),
    )
  }
  light.push(hexToRgb(seed))
  for (let i = 1; i <= DARK_COLOR_COUNT; i += 1) {
    light.push(
      hsvToRgb({
        h: getHue(hsv, i, false),
        s: getSaturation(hsv, i, false),
        v: getValue(hsv, i, false),
      }),
    )
  }
  return DARK_COLOR_MAP.map(({ index, opacity }) =>
    rgbToHex(mix(DARK_BACKGROUND, light[index]!, opacity)),
  )
}
