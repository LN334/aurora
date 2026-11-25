import { useState } from 'react'
import { readReduceMotion, writeReduceMotion } from '../../../features/settings/motion'
import { setStageParticles, useStageParticles } from '../../../features/settings/stage-particles'
import { Row, Rows, SettingsCard, Toggle } from '../parts'

/**
 * 动效。
 *
 * 两件事都会让「画面在动」：CSS 过渡/动画，以及舞台那层光尘。放在一起是因为
 * 它们属于同一类抱怨——卡顿、发晕、老机器过热。减少动效优先跟系统设置走，
 * 这里只提供手动覆盖。
 */
export function MotionPane() {
  const particles = useStageParticles()
  const [reduceMotion, setReduceMotion] = useState(readReduceMotion)
  /* 三个粒子滑块共用一个草稿：拖动时只改这一份，松手才落盘。 */
  const [draft, setDraft] = useState<{ density: number; speed: number; size: number } | null>(null)
  const mote = draft ?? {
    density: particles.density,
    speed: particles.speed,
    size: particles.size
  }

  const commit = (): void => {
    setStageParticles(mote)
    setDraft(null)
  }

  return (
    <>
      <SettingsCard
        title="动画"
        hint="关掉之后，切页、抽屉、列表都不再有过渡；只剩进度条这类必须动的东西。"
      >
        <Rows>
          <Row
            label="减少动效"
            desc="主要给晕动症与低配机器用。系统里开了「减少动画」时，这个开关也会自动打开。"
            id="motion-reduce"
          >
            <Toggle
              checked={reduceMotion}
              label="减少动效"
              onChange={(next) => {
                setReduceMotion(next)
                writeReduceMotion(next)
              }}
            />
          </Row>
        </Rows>
      </SettingsCard>

      <SettingsCard
        title="舞台粒子"
        hint="播放页舞台里那层上浮的光尘。纯装饰，关掉不影响任何声音。"
      >
        <Rows>
          <Row label="显示粒子" desc="默认开着。壁纸本身很热闹时可以关掉，画面会安静很多。" id="motion-particles">
            <Toggle
              checked={particles.enabled}
              label="舞台粒子"
              onChange={(next) => setStageParticles({ enabled: next })}
            />
          </Row>

          {particles.enabled ? (
            <>
              <Row label="多少" desc="从几颗到满屏；窗口越大，同样比例下颗粒越多。" stack>
                <div className="settings__slider">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(mote.density * 100)}
                    aria-label="粒子数量"
                    onChange={(event) => setDraft({ ...mote, density: Number(event.target.value) / 100 })}
                    onPointerUp={commit}
                    onKeyUp={commit}
                  />
                  <span className="settings__number">{Math.round(mote.density * 100)}%</span>
                </div>
              </Row>
              <Row label="快慢" desc="越慢越像浮尘，越快越像雨。" stack>
                <div className="settings__slider">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(mote.speed * 100)}
                    aria-label="粒子速度"
                    onChange={(event) => setDraft({ ...mote, speed: Number(event.target.value) / 100 })}
                    onPointerUp={commit}
                    onKeyUp={commit}
                  />
                  <span className="settings__number">{Math.round(mote.speed * 100)}%</span>
                </div>
              </Row>
              <Row label="大小" desc="颗粒的半径。大颗粒会折出更多光，也更吃显卡。" stack>
                <div className="settings__slider">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(mote.size * 100)}
                    aria-label="粒子大小"
                    onChange={(event) => setDraft({ ...mote, size: Number(event.target.value) / 100 })}
                    onPointerUp={commit}
                    onKeyUp={commit}
                  />
                  <span className="settings__number">{Math.round(mote.size * 100)}%</span>
                </div>
              </Row>
            </>
          ) : null}
        </Rows>
      </SettingsCard>
    </>
  )
}
