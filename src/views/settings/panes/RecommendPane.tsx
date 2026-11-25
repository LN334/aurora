import { SLOTS } from '../../../features/online/slots'
import { roamCandidates, setRoamPlatform, useRoamPlatforms } from '../../../features/player/roam-sources'
import { setPushSignedOnly, usePushSignedOnly } from '../../../features/settings/push-signed'
import { setOnboarded } from '../../../features/settings/onboarding'
import { Note, Row, Rows, SettingsCard, Toggle } from '../parts'

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
  { name: '今日推荐', hint: '一天一批，第二天换。', count: SLOTS.daily },
  { name: '推荐歌单', hint: '四行六列，按歌单语义取；不带排行榜条目。', count: SLOTS.playlist },
  {
    name: '推荐专辑',
    hint: '一行横条、左右可翻；取三家新碟与新歌里的专辑，可按批翻页。',
    count: SLOTS.album
  },
  {
    name: '新歌',
    hint: '左边一张主推，右边九行一屏往下滚；网易云走缓存，QQ 与酷狗现取新歌榜。',
    count: SLOTS.fresh
  },
  { name: '漫游', hint: '一次要这么多，再从中挑一批出来。', count: SLOTS.roam }
]

export function RecommendPane() {
  const chosen = useRoamPlatforms()
  const signedOnly = usePushSignedOnly()
  const candidates = roamCandidates()
  /* 全关就等于把推荐整块关掉，首页会只剩空壳。留最后一家，它那一档开关是灰的。 */
  const lastOne = chosen.length <= 1

  return (
    <>
      <SettingsCard
        title="每块收多少"
        hint="这里的数字是固定配额，界面不会因为平台少而缩小；勾选只决定由哪几家凑够。"
      >
        <Rows>
          {SHELVES.map((shelf, index) => (
            <Row
              key={shelf.name}
              label={shelf.name}
              desc={shelf.hint}
              id={index === 0 ? 'recommend-shelves' : undefined}
            >
              <span className="set-count">{shelf.count}</span>
            </Row>
          ))}
        </Rows>
      </SettingsCard>

      {candidates.length === 0 ? null : (
        <SettingsCard
          title="从哪几家要"
          hint="只决定推荐与漫游的取数来源；播放与搜索仍按音源顺序走。"
        >
          <Rows>
            <Row
              label="只用我登录了的平台"
              desc="没登录的平台取不到个人化结果，勾着也只会给通用榜；关掉则允许拿公开数据补量。"
              id="recommend-signed"
            >
              <Toggle
                checked={signedOnly}
                onChange={setPushSignedOnly}
                label="只用我登录了的平台"
              />
            </Row>
            {candidates.map((item, index) => (
              <Row
                key={item.id}
                label={item.name}
                desc={
                  lastOne && chosen.includes(item.id)
                    ? '至少留一家：全关掉推荐会整块空掉，所以这一档暂时不能关。'
                    : '勾上后才会参与推荐取数。'
                }
                id={index === 0 ? 'recommend-roam' : undefined}
              >
                <Toggle
                  checked={chosen.includes(item.id)}
                  disabled={lastOne && chosen.includes(item.id)}
                  label={item.name}
                  onChange={(next) => setRoamPlatform(item.id, next)}
                />
              </Row>
            ))}
          </Rows>
        </SettingsCard>
      )}

      <SettingsCard title="第一次启动的那一遍" hint="引导只教一次；重看不会清掉任何设置。">
        <Rows>
          <Row
            label="新手引导"
            desc="重新走一遍首次启动时的引导步骤，用来回忆入口在哪。"
            id="recommend-onboarding"
          >
            <button className="btn btn--small" type="button" onClick={() => setOnboarded(false)}>
              重看一遍
            </button>
          </Row>
        </Rows>
      </SettingsCard>

      <Note>推荐不改变任何账号里的数据；它只决定首页向平台要什么。</Note>
    </>
  )
}
