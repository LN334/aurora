import { roamCandidates, setRoamPlatform, useRoamPlatforms } from '../../../features/player/roam-sources'
import { Row, Rows, Toggle } from '../parts'

/**
 * 推荐来源。
 *
 * 以前这份勾选只在漫游页顶上，离开那一页就找不到了；首页「今天听什么」又不受它
 * 管，等于同一件事有两个答案。现在统一搬到这里：这一页是真源，漫游页那排 chip
 * 只是同一份设置的快捷方式。
 */
export function RecommendPane() {
  const chosen = useRoamPlatforms()
  const candidates = roamCandidates()

  if (candidates.length === 0) {
    return <p className="settings__hint">还没有能推荐曲目的平台。去「我」登录一个，这里就会出现。</p>
  }

  return (
    <>
      <Rows>
        {candidates.map((item) => (
          <Row key={item.id} label={item.name}>
            <Toggle
              checked={chosen.includes(item.id)}
              label={item.name}
              onChange={(next) => setRoamPlatform(item.id, next)}
            />
          </Row>
        ))}
      </Rows>
      <p className="settings__hint">关掉的平台不再参与推荐。</p>
    </>
  )
}
