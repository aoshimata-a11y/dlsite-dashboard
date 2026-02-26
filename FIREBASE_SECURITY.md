# Firebase セキュリティ設定手順

## 1. Realtime Database セキュリティルール

Firebase コンソール > Realtime Database > ルール タブで以下を設定してください。

### 基本設定（認証ユーザーのみ読み書き可）

```json
{
  "rules": {
    "dashboard": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

### 複数ユーザーで共有する場合（推奨）

特定のGoogleアカウントのみ書き込みを許可したい場合:

```json
{
  "rules": {
    "dashboard": {
      ".read": "auth != null",
      ".write": "auth != null && (
        auth.token.email == 'your-email@gmail.com' ||
        auth.token.email == 'collaborator@gmail.com'
      )"
    }
  }
}
```

## 2. Firebase Authentication の有効化

Firebase コンソール > Authentication > Sign-in method で
**Google** を有効化してください。

承認済みドメインに以下を追加:
- `localhost` (ローカル開発用)
- GitHub Pages の場合: `aoshimata-a11y.github.io`

## 3. APIキーについて

Firebase の `apiKey` はクライアントサイドで公開することが前提の設計です。
（Google 公式ドキュメントで明記されています）

**本当の保護はセキュリティルールです。**
上記のルール設定により、未認証ユーザーはデータにアクセスできません。

### 追加オプション: Firebase App Check

特定ドメインからのアクセスのみを許可したい場合:

1. Firebase コンソール > App Check を開く
2. reCAPTCHA v3 を登録
3. 「Realtime Database」を App Check で保護する

## 4. Chrome拡張の認証について

`chrome.identity.getAuthToken` を使用して Google OAuth トークンを取得し、
Firebase Auth の `GoogleAuthProvider.credential` でサインインします。

拡張のインストール時に1回ログインすれば、以降は自動的に認証されます。

### manifest.json の identity 権限

```json
"permissions": ["identity"]
```
これにより Chrome に記録済みの Google アカウントで認証できます。
