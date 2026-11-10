import { HOME_SECTIONS, setHomeSection, useHomeSections } from '../../../features/settings/home-sections'
import { Part, Row, Rows, Sub, Toggle } from '../parts'

/**
 * 首页摆什么。
 *
 * 这一页只放四块推荐的开关：每日推荐（今天听什么）、上面的快捷入口与「上次听到」
 * 不属于可关的推荐，留它们常在——首页没有起点就没法用。
 */
export function HomePane() {
  const sections = useHomeSections()
  return (
    <Part zh="首页">
      <Sub title="首页上摆哪些" hint="关掉的区块不出现在首页；每日推荐与上面的快捷入口一直都在。">
        <Rows>
          {HOME_SECTIONS.map((item) => (
            <Row key={item.id} label={item.name} hint={item.hint}>
              <Toggle
                checked={sections[item.id]}
                label={item.name}
                onChange={(next) => setHomeSection(item.id, next)}
              />
            </Row>
          ))}
        </Rows>
      </Sub>
    </Part>
  )
}
