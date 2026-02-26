# Firebase セキュリティ設定手順

## 1. Realtime Database セキュリティルール

Firebase コンソール > Realtime Database > ルール タブで以下を設定してください。

### 現在の設定（パスワード認証方式）

ダッシュボードはパスワード認証（index.html 内ハードコード）を使用しています。
Firebase 側は認証なしで読み書き可能に設定してください。

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

> **注意**: このルールは誰でもデータを読み書きできます。
> URLを知られなければ実害は限られますが、
> セキュリティが重要な場合は別途対策を検討してください。

## 2. パスワードの変更方法

`index.html` の以下の行でパスワードを設定します:

```javascript
const DASHBOARD_PASSWORD = 'dlsite2024'; // ← ここを変更
```

変更後は GitHub に push すると反映されます。

## 3. APIキーについて

Firebase の `apiKey` はクライアントサイドで公開することが前提の設計です。
（Google 公式ドキュメントで明記されています）

セキュリティが気になる場合は Firebase App Check の導入を検討してください。

### 追加オプション: Firebase App Check

特定ドメインからのアクセスのみを許可したい場合:

1. Firebase コンソール > App Check を開く
2. reCAPTCHA v3 を登録
3. 「Realtime Database」を App Check で保護する
