import { useEffect, useRef } from 'react'
import type { WallpaperEntry, WallpaperProperty } from '../../env'
import { colorToHex, coercePropertyValue, hexToColor } from '../../features/wallpaper/pure'
import type { PropertyValue } from '../../features/wallpaper/pure'
import { Toggle } from './parts'

/**
 * 一张壁纸工程自带的可调项。
 *
 * Wallpaper Engine 的工程可以在 project.json 里声明 general.properties：滑块、
 * 开关、颜色、下拉。作者把这些值接进自己的着色器，所以在播放器里改它们，
 * 效果和在桌面 WE 里改是同一份——但**只改我们这边的显示**，不动用户磁盘上的
 * project.json（那是 WE 自己的配置，改了下次开 WE 会发现被外部篡改）。
 *
 * 控件形态只有四种，一一对应 WE 的类型；没有样式的项（作者写的 HTML 说明横幅、
 * 文件选择、文本框之类的）在主进程就丢掉了，这里不用再判。
 *
 * 这块面板进入视口时给 body 挂 `is-tuning-wallpaper`：正常浏览时玻璃把壁纸
 * 糊成一片色，站在这块面板上调「雾气」「粒子」是看不出区别的，用户会以为设置
 * 是假的。面板滚出画面就把玻璃恢复成用户设的模糊。
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
  const rootRef = useRef<HTMLDivElement | null>(null)
  /* 静音项（音频感应、自定义文字、帧率显示）不给入口，但仍然作为「关」传给引擎。 */
  const properties = (entry.properties ?? []).filter((property) => !property.muted)

  /*
   * 调薄玻璃的开关跟着这份面板的可见性走，不跟组件挂载走。
   *
   * 原来在挂载时给 body 挂 `is-tuning-wallpaper`，离开设置页才摘。可「外观与
   * 桌面」这一截一渲染就挂上，而属性面板在整页的最下面、人根本没看见它。于是
   * 这一页的玻璃一直停在 blur(2px)：用户在上面拖「模糊程度」，10px 和 40px
   * 看起来一模一样，报的就是「这一页背景模糊失效」。
   *
   * 现在只在面板真的进视口时调薄；滚回上面调滑块，看到的还是用户设的模糊。
   */
  useEffect(() => {
    const node = rootRef.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const item of entries) {
          document.body.classList.toggle('is-tuning-wallpaper', item.isIntersecting)
        }
      },
      { threshold: 0.35 }
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
      document.body.classList.remove('is-tuning-wallpaper')
    }
    /* 属性项是异步来的：从 0 变到 N 时节点才真正挂上，要重新观察。 */
  }, [properties.length])

  if (properties.length === 0) return null

  const changed = Boolean(values && Object.keys(values).length > 0)

  return (
    <div className="wp-props" ref={rootRef}>
      <div className="wp-props__head">
        <div className="settings__text">
          <div className="settings__label">这张壁纸的可调项</div>
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
        {property.type === 'textinput' ? (
          /*
           * 作者把字写在默认值里，场景一挂载就画上去；这个框是唯一能改它的地方。
           * 输入框改一下就立刻写回 store，Backdrop 会把它热推给正在跑的实例。
           */
          <input
            type="text"
            className="input wp-prop__text"
            aria-label={property.text || property.name}
            placeholder="改掉作者写的字；清空会回到默认"
            value={String(value)}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
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
