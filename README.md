# messageEasySender

GitHub Pages で配信する静的フロントエンドと、Google Apps Script を保存先にした 1 対 1 メッセージ Web アプリです。老人向けの `simple` モードを初期表示にしつつ、通常の `normal` モードも同じ画面で切り替えて使えます。

## 構成

- フロントエンド: [index.html](/Users/Project/messageEseyer/messageEasySender/index.html), [styles.css](/Users/Project/messageEseyer/messageEasySender/styles.css), [app.js](/Users/Project/messageEseyer/messageEasySender/app.js)
- 設定: [config.js](/Users/Project/messageEseyer/messageEasySender/config.js)
- Apps Script: [apps-script/Code.gs](/Users/Project/messageEseyer/messageEasySender/apps-script/Code.gs)

## GitHub Pages 側のセットアップ

1. このフォルダを GitHub リポジトリに置く
2. `Settings > Pages` でデプロイ元をこのブランチの `/root` に設定する
3. [config.js](/Users/Project/messageEseyer/messageEasySender/config.js) の以下を埋める

```js
window.APP_CONFIG = {
  apiBaseUrl: "YOUR_APPS_SCRIPT_WEB_APP_URL",
  roomId: "family-room-1",
  secret: "十分長い共有秘密値",
  role: "simple",
  pollIntervalMs: 7000,
};
```

4. URL 末尾のクエリで役割別 URL を作る

```text
老人向け: https://YOUR_ACCOUNT.github.io/YOUR_REPO/?role=simple
あなた向け: https://YOUR_ACCOUNT.github.io/YOUR_REPO/?role=normal
```

`roomId` や `secret` もクエリで上書きできますが、まずは `config.js` 固定で十分です。

## Google Apps Script 側のセットアップ

1. Google Spreadsheet を 1 つ作る
2. `拡張機能 > Apps Script` を開く
3. [apps-script/Code.gs](/Users/Project/messageEseyer/messageEasySender/apps-script/Code.gs) の内容を貼る
4. `プロジェクトの設定 > スクリプト プロパティ` に以下を設定する
   - `APP_SECRET`: `config.js` の `secret` と同じ値
   - `DRIVE_FOLDER_ID`: 画像保存用 Google Drive フォルダ ID
5. `デプロイ > 新しいデプロイ > ウェブアプリ`
   - 実行ユーザー: 自分
   - アクセスできるユーザー: 全員
6. 発行された URL を `config.js` の `apiBaseUrl` に入れる
7. すでに一度デプロイ済みなら、今回の更新後に Apps Script を再デプロイする

## API 仕様

### `GET {apiBaseUrl}?roomId=...&since=...&secret=...`

- 指定した `roomId` のメッセージを返す
- `since` を省略すると全件、指定するとその時刻より後だけ返す

### `POST {apiBaseUrl}`

```json
{
  "roomId": "family-room-1",
  "secret": "shared-secret",
  "clientTimestamp": "2026-05-21T10:00:00.000Z",
  "senderRole": "normal",
  "senderId": "browser-local-device-id",
  "type": "text",
  "text": "こんにちは"
}
```

画像送信時は `type: "image"` にして `imageData`, `fileName`, `mimeType` を送ります。削除時は `action: "delete"` と `messageId` を送ります。

## 使い方

- `simple` モード
  - 開いた瞬間に老人向け画面が出る
  - 大きな `メッセージ送信` ボタンで音声入力開始
  - `録音完了` 後に文字起こし確認
  - `この内容を送信` を押した時だけ送信
- `normal` モード
  - テキスト送信
  - 画像選択と送信
  - メッセージ長押しで削除
  - 上部の小さなリンクで `simple` と切替

## 補足

- 送信者の判定は IP ではなく、各ブラウザの `localStorage` に保存する `deviceId` で行う
- 同じ人でも別ブラウザ・別端末で開くと別の送信者として扱われる
- 既存メッセージは `senderId` を持たないので、追加後しばらくは古い表示判定が混ざることがある

## 注意

- この構成は認証を省略しているので、URL と `secret` を知っている人は読み書きできます
- `config.js` に秘密値を置く以上、本格的な秘匿にはなりません
- v1 は自動更新のみで、プッシュ通知はありません
- 音声入力は Android Chrome を主対象にしています
