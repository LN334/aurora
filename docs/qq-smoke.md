# QQ 音乐主进程探针（qq-smoke）

> 由 `electron/qq/smoke.cjs` 生成，运行于 2026-11-17T05:11:23.852Z。
> 复现：`npm run build:electron && node electron/qq/smoke.cjs`。
> 探针驱动**编译产物** `dist-electron/qq/client.js` 与
> `dist-electron/remote-protocol.js`，并另起一段直接问上游服务要原始 `result` 码，
> 所以下面的数字既来自真正参与构建的代码，也能与 `reasons.ts` 的判定对照。
> 本机**没有 QQ 音乐账号**：所以 320k / FLAC 需要登录这一档无法在真机上验证，
> 探针只记录实测到的部分。

**结果：全部通过。**

```json
{
  "when": "2026-11-17T05:11:23.852Z",
  "repo": "D:\\Aurora",
  "status": {
    "ready": true,
    "loggedIn": false
  },
  "search": {
    "keywords": "告白气球",
    "songs": 10,
    "albums": 0,
    "artists": 0,
    "first": [
      {
        "id": 107192078,
        "songmid": "003OUlho2HcRHC",
        "mediaMid": "003gbY6c0g1L4Q",
        "name": "告白气球",
        "artists": [
          "周杰伦"
        ],
        "album": "周杰伦的床边故事",
        "hasCover": true,
        "duration": 215,
        "fee": 1
      },
      {
        "id": 107785182,
        "songmid": "0037GMG74LpROP",
        "mediaMid": "004AD9WG2KSvC0",
        "name": "告白气球",
        "artists": [
          "二珂"
        ],
        "album": "",
        "hasCover": false,
        "duration": 213,
        "fee": 0
      },
      {
        "id": 97773,
        "songmid": "0039MnYb0qxYhV",
        "mediaMid": "003Qui1q2u1Zho",
        "name": "晴天",
        "artists": [
          "周杰伦"
        ],
        "album": "叶惠美",
        "hasCover": true,
        "duration": 269,
        "fee": 1
      }
    ],
    "albumSample": null,
    "artistSample": null
  },
  "picked": {
    "free": "0037GMG74LpROP",
    "paid": "003OUlho2HcRHC"
  },
  "stream": {
    "ok": true,
    "url": "http://aqqmusic.tc.qq.com/M500004AD9W...(189 chars masked)",
    "quality": "exhigh",
    "level": "standard",
    "br": 128,
    "lossless": false,
    "trial": false
  },
  "upstreamRange": {
    "status": 206,
    "contentType": "audio/mpeg",
    "contentRange": "bytes 0-4095/3413244",
    "acceptRanges": null,
    "cors": "*",
    "bytes": 4096,
    "magic": "49443303"
  },
  "proxyRange": {
    "status": 206,
    "contentType": "audio/mpeg",
    "contentRange": "bytes 0-4095/3413244",
    "acceptRanges": "bytes",
    "cors": "*",
    "bytes": 4096
  },
  "lyrics": {
    "chars": 1209,
    "head": "[ti:告白气球]\n[ar:周二珂]\n[al:   ]\n[by:]"
  },
  "cover": {
    "songmid": "003OUlho2HcRHC",
    "url": "https://y.gtimg.cn/music/photo_new/T002R300x300M000003RMaRI1iFoYd.jpg",
    "proxy": {
      "status": 200,
      "contentType": "image/jpeg",
      "cors": "*",
      "bytes": 66463
    }
  },
  "refusal": {
    "ok": false,
    "reason": "login-required",
    "message": "这首歌需要登录 QQ 音乐账号后才能播放"
  },
  "rawUpstream": {
    "0037GMG74LpROP/128": {
      "result": 0,
      "hasPurl": true
    },
    "0037GMG74LpROP/320": {
      "result": 104003,
      "hasPurl": false
    },
    "0037GMG74LpROP/flac": {
      "result": 104003,
      "hasPurl": false
    },
    "003OUlho2HcRHC/128": {
      "result": 104003,
      "hasPurl": false
    },
    "003OUlho2HcRHC/320": {
      "result": 104003,
      "hasPurl": false
    },
    "003OUlho2HcRHC/flac": {
      "result": 104003,
      "hasPurl": false
    },
    "numericIdAsSongmid": {
      "result": 101404,
      "hasPurl": false
    }
  }
}
```
