import type { WallpaperEntry, WallpaperProperty } from '../../env'
import { colorToHex, coercePropertyValue, hexToColor } from '../../features/wallpaper/pure'
import type { PropertyValue } from '../../features/wallpaper/pure'
import { Toggle } from './parts'

/**
 * 一张壁纸工程自带的可调项。
 *
 * Wallpaper Engine 的工程可以在 project.json 里声明 general.properties：滑块、
 * 开关、颜色、文本框、下拉。作者把这些值接进自己的着色器，所以在播放器里改它们，
 * 效果和在桌面 WE 里改是同一份——但**只改我们这边的显示**，不动用户磁盘上的
 * project.json（那是 WE 自己的配置，改了下次开 WE 会发现被外部篡改）。
 *
 * 控件形态只有五种，一一对应 WE 的类型；没有样式的项（作者写的 HTML 说明横幅、
 * 文件选择之类的）在主进程就丢掉了，这里不用再判。
 */
export function WallpaperProps({
  entry,
  values,
  onChange,
  onReset
}: {
  entry: WallpaperEntry
  /** 用户改过的值；没有的项回落到工程默认值。 */
  values: Record<string, PropertyValue> | undefined
  onChange(name: string, value: PropertyValue): void
  onReset(): void
}) {
  const properties = entry.properties ?? []
  if (properties.length === 0) return null

  const changed = Boolean(values && Object.keys(values).length > 0)

  return (
    <div className="wp-props">
      <div className="wp-props__head">
        <div className="settings__text">
          <div className="settings__label">这张壁纸的可调项</div>
          <p className="settings__hint">
            工程自带的选项。只改播放器里的背景，不动 Wallpaper Engine 的工程。
          </p>
        </div>
        {changed ? (
          <button className="btn" onClick={onReset}>
            恢复默认
          </button>
        ) : null}
      </div>
      <div className="wp-props__list">
        {properties.map((property) => (
          <PropertyRow
            key={property.name}
            property={property}
            value={current(property, values)}
            onChange={(value) => onChange(property.name, value)}
          />
        ))}
      </div>
    </div>
  )
}

function current(property: WallpaperProperty, values: Record<string, PropertyValue> | undefined): PropertyValue {
  const saved = values ? values[property.name] : undefined
  return coercePropertyValue(property, saved) ?? property.value
}

function PropertyRow({
  property,
  value,
  onChange
}: {
  property: WallpaperProperty
  value: PropertyValue
  onChange(value: PropertyValue): void
}) {
  return (
    <div className="wp-prop">
      <span className="wp-prop__label" title={property.name}>
        {property.text || property.name}
      </span>
      <div className="wp-prop__control">
        {property.type === 'slider' ? (
          <Slider property={property} value={Number(value)} onChange={onChange} />
        ) : null}
        {property.type === 'bool' ? (
          <Toggle
            checked={Boolean(value)}
            label={property.text || property.name}
            onChange={(next) => onChange(next)}
          />
        ) : null}
        {property.type === 'color' ? (
          <input
            type="color"
            className="wp-prop__color"
            aria-label={property.text || property.name}
            value={colorToHex(value)}
            onChange={(event) => onChange(hexToColor(event.currentTarget.value))}
          />
        ) : null}
        {property.type === 'textinput' ? (
          <input
            type="text"
            className="input wp-prop__text"
            aria-label={property.text || property.name}
            value={String(value)}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        ) : null}
        {property.type === 'combo' ? (
          <select
            className="input wp-prop__select"
            aria-label={property.text || property.name}
            value={String(value)}
            onChange={(event) => onChange(event.currentTarget.value)}
          >
            {(property.options ?? []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  )
}

function Slider({
  property,
  value,
  onChange
}: {
  property: WallpaperProperty
  value: number
  onChange(value: PropertyValue): void
}) {
  const min = Number.isFinite(property.min) ? (property.min as number) : 0
  const max = Number.isFinite(property.max) ? (property.max as number) : 1
  const step = Number.isFinite(property.step) && (property.step as number) > 0 ? (property.step as number) : 0.01
  // 步长小于 1 的说明是连续量（亮度、速度），显示两位小数；整数步长就原样。
  const digits = step < 1 ? 2 : 0
  return (
    <>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : min}
        aria-label={property.text || property.name}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <span className="settings__number">{value.toFixed(digits)}</span>
    </>
  )
}
