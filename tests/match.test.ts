import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MIN_MATCH_SCORE,
  durationLevel,
  normalizeName,
  pickBest,
  scoreTrack,
  textSimilarity,
  type TrackFacts
} from '../electron/pure/lyrics-match.ts'

/**
 * The strings here are the shapes real music tags arrive in: rips of the same
 * recording tagged by different tools, and LRCLIB rows written by whoever
 * uploaded them. A matcher that only works on clean ASCII titles is worthless
 * for a Chinese-language library, so the cases are deliberately messy.
 */

const studio: TrackFacts = {
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  duration: 269
}

test('normalizeName folds full-width punctuation and spacing', () => {
  assert.equal(normalizeName('晴天（Live）'), '晴天(Live)')
  assert.equal(normalizeName('A，B'), 'A,B')
  assert.equal(normalizeName('  A   B  '), 'A B')
  // Case survives: the normalized string is also used for LRCLIB's exact
  // lookup, which is case-sensitive.
  assert.equal(normalizeName('Hello'), 'Hello')
})

test('normalizeName folds curly quotes and dashes', () => {
  assert.equal(normalizeName('Don’t Stop'), "Don't Stop")
  assert.equal(normalizeName('A — B'), 'A - B')
  assert.equal(normalizeName('A – B'), 'A - B')
})

test('normalizeName folds traditional characters to simplified', () => {
  assert.equal(normalizeName('愛人'), '爱人')
  assert.equal(normalizeName('後來'), '后来')
  assert.equal(normalizeName('夢醒時分'), '梦醒时分')
  // Names that are already simplified must not change.
  assert.equal(normalizeName('后来'), '后来')
})

test('textSimilarity treats spelling differences as equal', () => {
  assert.equal(textSimilarity('晴天', '晴天'), 1)
  assert.equal(textSimilarity('Don’t Stop', 'dont stop'), 1)
  assert.equal(textSimilarity('（晴天）', '晴天'), 1)
})

test('textSimilarity ranks containment above overlap', () => {
  const contained = textSimilarity('晴天', '晴天娃娃')
  const unrelated = textSimilarity('晴天', '稻香')
  assert.ok(contained > 0.6 && contained < 1, `contained=${contained}`)
  assert.ok(unrelated < contained, `unrelated=${unrelated}`)
})

test('durationLevel quantises to the documented five bands', () => {
  assert.equal(durationLevel(0), 0)
  assert.equal(durationLevel(0.2), 1)
  assert.equal(durationLevel(0.5), 2)
  assert.equal(durationLevel(1), 3)
  assert.equal(durationLevel(2), 4)
  assert.equal(durationLevel(5), 5)
  // Sign never matters: only the size of the gap does.
  assert.equal(durationLevel(-2), 4)
  assert.equal(durationLevel(Number.NaN), 5)
})

test('scoreTrack returns 1 for the same recording', () => {
  assert.equal(scoreTrack(studio, { ...studio }), 1)
})

test('scoreTrack ignores fields the query does not have', () => {
  const untagged: TrackFacts = { title: '晴天', artist: '周杰伦', duration: 269 }
  // No album on the query side: the candidate's album does not count for or
  // against it, so the score is still a perfect match.
  assert.equal(scoreTrack(untagged, studio), 1)
})

test('scoreTrack discounts a live take of the same song', () => {
  const live = scoreTrack(studio, { ...studio, title: '晴天 (Live)' })
  assert.ok(live < 1, `live=${live}`)
  // Same song, wrong recording: discounted, not rejected.
  assert.ok(live >= MIN_MATCH_SCORE, `live=${live}`)
})

test('scoreTrack rejects a different song with the same artist', () => {
  const other = scoreTrack(studio, { ...studio, title: '稻香' })
  assert.ok(other < MIN_MATCH_SCORE, `other=${other}`)
})

test('scoreTrack preference: same artist beats a cover', () => {
  const cover = scoreTrack(studio, {
    title: '晴天',
    artist: '某翻唱歌手',
    album: '翻唱合集',
    duration: 269
  })
  assert.ok(cover < scoreTrack(studio, { ...studio }), `cover=${cover}`)
  // Lyrics usually survive a cover, so a cover is still usable - just weaker.
  assert.ok(cover > 0.5, `cover=${cover}`)
})

test('scoreTrack treats traditional and simplified tags as equal', () => {
  const traditional: TrackFacts = {
    title: '愛人',
    artist: '鄧麗君',
    album: '愛人',
    duration: 200
  }
  const simplified: TrackFacts = {
    title: '爱人',
    artist: '邓丽君',
    album: '爱人',
    duration: 200
  }
  assert.equal(scoreTrack(traditional, simplified), 1)
})

test('scoreTrack punishes duration drift in bands', () => {
  const one = scoreTrack(studio, { ...studio, duration: 268 })
  const two = scoreTrack(studio, { ...studio, duration: 267 })
  const eight = scoreTrack(studio, { ...studio, duration: 261 })
  assert.ok(one > two, `one=${one} two=${two}`)
  assert.ok(two > eight, `two=${two} eight=${eight}`)
  // A title, artist and album match still identifies the song even when the
  // durations disagree; a different album file is a normal ripping difference.
  assert.ok(eight > MIN_MATCH_SCORE, `eight=${eight}`)
})

test('scoreTrack credits duet spellings', () => {
  const duet: TrackFacts = { title: '千里之外', artist: '周杰伦、费玉清', duration: 260 }
  const credited: TrackFacts = { title: '千里之外', artist: '周杰伦 feat. 费玉清', duration: 260 }
  const single: TrackFacts = { title: '千里之外', artist: '周杰伦', duration: 260 }
  assert.equal(scoreTrack(duet, credited), 1)
  assert.ok(scoreTrack(duet, single) >= 0.85, 'a partial credit is still a strong match')
})

test('pickBest picks the strongest candidate', () => {
  const candidates = [
    { label: 'cover', facts: { title: '晴天', artist: '翻唱歌手', duration: 300 } },
    { label: 'studio', facts: studio },
    { label: 'live', facts: { ...studio, title: '晴天 (Live)', duration: 275 } }
  ]
  const best = pickBest(candidates, studio, (candidate) => candidate.facts)
  assert.ok(best)
  assert.equal(best.item.label, 'studio')
  assert.ok(best.score > 0.99, `score=${best.score}`)
})

test('pickBest returns null when nothing is close enough', () => {
  const candidates = [
    { title: '稻香', artist: '周杰伦', duration: 223 },
    { title: '七里香', artist: '周杰伦', duration: 299 }
  ]
  assert.equal(pickBest(candidates, studio, (candidate) => candidate), null)
  assert.equal(pickBest([], studio, (candidate: TrackFacts) => candidate), null)
})

test('pickBest keeps the earlier candidate on a tie', () => {
  // The caller puts synchronised results first so a tie favours them.
  const candidates: TrackFacts[] = [
    { ...studio },
    { ...studio }
  ]
  const best = pickBest(candidates, studio, (candidate) => candidate)
  assert.ok(best)
  assert.equal(best.item, candidates[0])
})
