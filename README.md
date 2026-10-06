# blackhole-ray-marching

## 🕳️ Real-time Schwarzschild viewer (WebGL)

**https://sogebu.github.io/blackhole-ray-marching/**

ブラウザで動く 60 fps のシュワルツシルト・ブラックホール可視化 (`docs/`)。
事前計算した測地線 lookup table を GPU texture として参照する方式。
シェーダ内で積分するのは、table の外 (R > 30 r_S) の弱重力域の 1 次元求積だけ。

- 自由落下カメラ (FFO) / 静止カメラ、horizon 貫通 (内部視点対応)
- 重力崩壊型ブラックホールが default (永久 BH の「あの世」ビューは opt-in)
- ドップラー効果 (色 = 色温度 per-channel shift + 明るさ g⁴)
- **降着円盤** (Kepler 薄円盤、傾きスライダ、2 次像・影の手前の増光まで再現。
  カメラ半径に依存しない衝突径数基準の軌道 table で、落下中も 60 fps)
- 質量プリセット (太陽 / Sgr A* / M87*) と固有時間の秒換算 HUD
- **自由飛行**: W/S = 視線の前後、A/D = 左右への thrust、矢印または drag = 自分の周りを
  見回す。キーを離すと重力補償 hover に戻り、`C` は安定円軌道、`0` は静止。
  外部域 `R > 1.52 r_S` を上限なしに飛べる (遠くまで行くときは固有時間の倍率を上げる)。
  lookup table は `R = 30 r_S` までで、その外は光の曲がりを弱重力域の求積で継ぐ。
- **空**: 実写の天の川 (既定) と 15° 格子を切り替え。天の川は初期視点で銀河中心が
  ブラックホールの真後ろに来る向き。

### 画像のクレジット

天の川の全天画像 `docs/sky_milkyway.jpg` は、Kevin M. Loch が
[bsrender](https://github.com/kevinloch/bsrender) で ESA Gaia EDR3 から描いた
[Milkyway360-latlon-32kscaled8k-4200k-m14-s4-g1.png](https://commons.wikimedia.org/wiki/File:Milkyway360-latlon-32kscaled8k-4200k-m14-s4-g1.png)
(Wikimedia Commons) を縮小したもので、
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) で配布する (このファイルのみ)。
改変点は `docs/sky_milkyway.txt`。

## Rust ray marcher

リポジトリ本体 (`src/`) は Rust + ray marching による初期実装。
