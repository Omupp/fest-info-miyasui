#!/bin/bash
# 学祭まとめサイト（Omupp/fest-info-miyasui）の自動更新。管理者のサーバーの fest-info-refresh.timer が 30 分おきに動かす。
# 学祭ポータルを取り込み、data/fest.json が変わっていたら GitHub に送る（送れば Pages が作り直される）。
# 置き場所: /usr/local/bin/fest-info-refresh（原本はリポジトリの tools/trashcan-refresh.sh）
set -euo pipefail

REPO="$HOME/.local/share/fest-info-refresh/repo" # 自動更新専用の写し。手で直さない（毎回 GitHub に合わせる）

if [ "$(TZ=Asia/Tokyo date +%Y%m%d)" -gt 20261102 ]; then
  echo "学祭は終わったので何もしない"
  exit 0
fi

if [ ! -d "$REPO/.git" ]; then
  mkdir -p "$(dirname "$REPO")"
  git clone -q festinfo:Omupp/fest-info-miyasui.git "$REPO"
fi
cd "$REPO"
git fetch -q origin main
git reset -q --hard origin/main

# 読めない企画がある・企画が 3 件以上減ったときは scrape.py が失敗する → OnFailure で ntfy
python3 -I -B tools/scrape.py

if git diff --quiet -- data/fest.json; then
  exit 0
fi
git -c user.name=trashcan-bot -c user.email=trashcan-bot@trashcan.local \
  commit -q -m "学祭ポータルの更新を取り込む" -- data/fest.json
git push -q origin main
echo "更新を GitHub に送った"
