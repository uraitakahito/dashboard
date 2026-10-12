# dashboard

crawler の開発用の画面。**1 本のクロールを 1 行で見る。**
起こす（[capture-ledger](https://github.com/uraitakahito/capture-ledger)）・走らせる（[capture-scheduler](https://github.com/uraitakahito/capture-scheduler) の Windmill）・置く（[seaweedfs](https://github.com/uraitakahito/seaweedfs)）・読む（[replay](https://github.com/uraitakahito/replay)）の 4 枚に割れていた画面を、台帳の API から 1 枚に組み立てる。
依存を持たず、秘密も持たない。loopback（既定は `127.0.0.1:7080`）でだけ待ち受ける。

## Documentation

起こし方・画面の読み方・設定などは、docs サイトに:

- **English** — <https://uraitakahito.github.io/dashboard/>
- **日本語** — <https://uraitakahito.github.io/dashboard/ja/>

## Related Projects

- [capture-ledger](https://github.com/uraitakahito/capture-ledger) — 読む台帳の API。`dev:up` がこの画面を起こす
- [wacz-validator](https://github.com/uraitakahito/wacz-validator) — 「検証」と「中身」に答える daemon
- [capture-scheduler](https://github.com/uraitakahito/capture-scheduler) — クロールの run（Windmill）への行き先
- [replay](https://github.com/uraitakahito/replay) — アーカイブを開く行き先

## License

Unlicense
