# fest-info-miyasui

iTLFest.2026（中央大学 市ヶ谷田町キャンパス・2026/10/31〜11/1）の企画を、
**タイムテーブル**と**パンフ**の形で見られるようにした非公式のページです。

## 中身

| ファイル | 内容 |
|---|---|
| `index.html`・`style.css`・`app.js` | ページ本体（ビルド不要の静的サイト） |
| `data/fest.json` | 学祭ポータルから取り込んだ企画と団体（`tools/scrape.py` が書く。手で直さない） |
| `data/extra.json` | ポスターと公式サイトから補った時刻・注記、開催の概要（手で書く） |
| `img/posters/` | 企画のポスター（幅 960px に縮小） |
| `tools/scrape.py` | 学祭ポータルを読んで `data/fest.json` を作る（Python 標準ライブラリのみ） |
| `.github/workflows/refresh.yml` | 1 時間おきに読み直し、変わっていたら commit（11/2 まで） |

## 出典

- 企画・団体の情報：[学祭ポータル](https://gakusai-search.github.io/)（C3 | Creative Computing Club）
- 開催時間・テーマ・食品販売：[iTLFest. 公式サイト](https://itlfest.com/)
- 画像と文章は iTLFest.実行委員会と各団体のものです。

最新の情報は公式でご確認ください。
