import { HOME_SECTIONS, setHomeSection, useHomeSections } from '../../../features/settings/home-sections'
import { ROW_DENSITIES, useRowDensity, writeRowDensity } from '../../../features/settings/row-density'
import { Choice, Row, Rows, SettingsCard, Toggle } from '../parts'

/**
 * 首页与媒体库。
 *
 * 一张卡管「首页摆什么」，另一张管「列表排多密」。这两件事都是布局形状，
 * 主题与背景不在这里——那页只管颜色与玻璃。
 */
export function HomePane() {
  const sections = useHomeSections()
  const density = useRowDensity()

  return (
    <>
      <SettingsCard title="首页上摆哪些" hint="首页固定的几块推荐。关掉后那一块整段消失，不留空标题。">
        <Rows>
          {HOME_SECTIONS.map((item) => (
            <Row key={item.id} label={item.name} desc={item.hint} id={'home-' + item.id}>
              <Toggle
                checked={sections[item.id]}
                label={item.name}
                onChange={(next) => setHomeSection(item.id, next)}
              />
            </Row>
          ))}
        </Rows>
      </SettingsCard>

      <SettingsCard title="列表密度" hint="歌曲、专辑、歌单的列表行高；影响所有列表，不只首页。">
        <Rows>
          <Row
            label="行高"
            desc="紧凑一屏放更多歌，宽松点击区域更大；三种密度只改行高，不改字号。"
            id="home-density"
          >
            <Choice
              value={density.id}
              options={ROW_DENSITIES}
              label="列表行密度"
              onChange={(next) => writeRowDensity(next)}
            />
          </Row>
        </Rows>
      </SettingsCard>
    </>
  )
}
