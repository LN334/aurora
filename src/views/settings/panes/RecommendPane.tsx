import { SLOTS } from '../../../features/online/slots'
import { roamCandidates, setRoamPlatform, useRoamPlatforms } from '../../../features/player/roam-sources'
import { setPushSignedOnly, usePushSignedOnly } from '../../../features/settings/push-signed'
import { setOnboarded } from '../../../features/settings/onboarding'
import { Row, Rows, Sub, Toggle } from '../parts'

/**
 * 推荐来源。
 *
 * 以前这份勾选只在漫游页顶上，离开那一页就找不到了；首页「今天听什么」又不受它
 * 管，等于同一件事有两个答案。现在统一搬到这里：这一页是唯一能改的地方，漫游轨
 * 上那排只照这里显示——能点的时候，用户会以为漫游另有第二套配置。
 *
 * 上半张表是「每块收多少」。这些数以前没地方看，于是关掉一家平台、首页少了一截，
 * 看起来像是坏了；现在摊开写：总数是定好的，勾选只决定由谁凑够。
 */
const SHELVES: { name: string; hint: string; count: number }[] = [
  { name: '今天听什么', hint: '一天一批，第二天换', count: SLOTS.daily },
  { name: '推荐歌单', hint: '四行六列', count: SLOTS.playlist },
  { name: '推荐专辑', hint: '一行横条、左右可翻；取三家新碟与新歌里的专辑，可按批翻页', count: SLOTS.album },
  { name: '新歌', hint: '左边一张主推，右边九行一屏往下滚；网易云走缓存，QQ 与酷狗现取新歌榜', count: SLOTS.fresh },
  { name: '漫游', hint: '一次要这么多，再从中挑一批出来', count: SLOTS.roam }
]

export function RecommendPane() {
  const chosen = useRoamPlatforms()
  const signedOnly = usePushSignedOnly()
  const candidates = roamCandidates()
  /* 全关就等于把推荐整块关掉，首页会只剩空壳。留最后一家，它那一档开关是灰的。 */
  const lastOne = chosen.length <= 1

  return (
    <>
      <Sub title="每块收多少" hint="总数是定好的，不随下面的勾选变。">
        <Rows>
          {SHELVES.map((shelf) => (
            <Row key={shelf.name} label={shelf.name} hint={shelf.hint}>
              <span className="set-count">{shelf.count}</span>
            </Row>
          ))}
        </Rows>
      </Sub>

      {candidates.length === 0 ? (
        <p className="settings__hint">还没有能推荐曲目的平台。去「我」登录一个，这里就会出现。</p>
      ) : (
        <Sub title="从哪几家要" hint="勾掉的平台不再发请求，缺的位置由还开着的平台补上。至少留一家：全关就没有推荐可看了。">
          <Rows>
            <Row
              label="只用我登录了的平台"
              hint="关掉后，没登录的平台也会推，但推的是公开榜单，不是给你的推荐。"
            >
              <Toggle checked={signedOnly} onChange={setPushSignedOnly} label="只用我登录了的平台" />
            </Row>
            {candidates.map((item) => (
              <Row key={item.id} label={item.name}>
                <Toggle
                  checked={chosen.includes(item.id)}
                  disabled={lastOne && chosen.includes(item.id)}
                  label={item.name}
                  onChange={(next) => setRoamPlatform(item.id, next)}
                />
              </Row>
            ))}
          </Rows>
        </Sub>
      )}

      <Sub title="第一次启动的那一遍" hint="引导里挑的也是这一份推流来源，可以再看一遍。">
        <Rows>
          <Row label="新手引导" hint="重新显示第一次启动时的设置层。">
            <button className="btn btn--small" type="button" onClick={() => setOnboarded(false)}>
              重看一遍
            </button>
          </Row>
        </Rows>
      </Sub>
    </>
  )
}
