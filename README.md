# Focus Guard - Site Blocker

仕事中に開きがちなSNS・動画サイトをブロックするシンプルなChrome拡張です。
初期状態では以下がブロック対象として登録されています。
設定画面から、これらを削除したり、任意のURLを追加したりできます。

- x.com
- twitter.com
- youtube.com
- youtu.be
- facebook.com

## インストール方法

1. このフォルダを任意の場所に置く
2. Chromeで `chrome://extensions/` を開く
3. 右上の「デベロッパーモード」をONにする
4. 「パッケージ化されていない拡張機能を読み込む」を押す
5. このフォルダを選択する

## 使い方

- ツールバーの拡張アイコンから、一時停止・再開できます。
- 「5分だけ解除」「1時間だけ解除」から、確認後にNGリストを一時的に無効化できます。時間が過ぎると自動で再開します。
- 「ブロック対象を編集」から、1行に1つずつ対象URLを追加・削除できます。
- 各行で「照合のしかた」を選べます。
  - **ドメイン（サブドメインも含む）**: `youtube.com` → youtube.com・www.youtube.com・music.youtube.com などすべて（従来の動き）
  - **ドメイン完全一致**: `youtube.com` → youtube.com と www.youtube.com だけ。music.youtube.com などは止めない
  - **部分一致**: URL（ドメイン＋パス）にその文字列を含めば止める。例: `shorts`
  - **正規表現**: URL全体に対する正規表現（大文字小文字は区別しない）。Chromeの仕様上、先読み・後読み・後方参照は使えません
  - **除外**: チェックを付けた行に当たるURLは、ほかの行に当たってもブロックしません
- 例: YouTubeは止めてYouTube Musicは開きたいときは、「ドメイン `youtube.com`」と「除外・ドメイン `music.youtube.com`」の2行にします（または `youtube.com` を「ドメイン完全一致」にします）。
- ブロックされたページでは、今日・直近7日・累計のアクセス試行回数を確認できます。
- `x.com` と `twitter.com`、`youtube.com` と `youtu.be` はそれぞれ同じサービスとして合算してカウントします。
- Facebookがブロックされた場合は、ブロック画面からMessengerへ移動できます。
- 初期登録されている `x.com` や `youtube.com` も、不要なら削除できます。
- 入力例: `example.com` / `https://youtube.com` / `facebook.com` / `youtube.com/shorts`
- 例: `youtube.com/shorts` と書くとYouTube Shortsだけを止める用途にも使えます。
- 全行を削除して保存すると、ブロック対象を空にできます。

## 注意

Chrome拡張の仕様上、ユーザーが自分で拡張を無効化したり削除したりすれば回避できます。強制力よりも「無意識に開く動作を一度止める」ための軽いガードとして使う想定です。
