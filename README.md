# Agreement Manager Uploader

PDFをDocusign **Agreement Manager**（旧Navigator）に取り込む（ingest）ための、React (Vite) + TypeScript + Tailwind + shadcn/ui フロントエンドと、Vercel Serverless Functionsによるバックエンドのアプリです。

## 重要な前提（必読）

DocuSignには厳密には「Agreement Manager」という名前のAPI製品は元々存在せず、2026年に **Navigator → Agreement Manager** へ名称変更されたものを指しています。Navigator時代のAPIはGET/DELETE/summarizeのみのベータ版で、文書のアップロードAPIは存在しませんでした。リブランドに伴い **Bulk Ingestion API**（ジョブを作成 → クラウドストレージへ直接アップロード → ジョブを完了、という3段構成）が追加された、という情報を確認しています。

ただし、このセッションでは `developers.docusign.com` への直接アクセスが403で拒否されたため、**Bulk Ingestion APIの正確なパス・スコープ名は最終確認できていません**。`api/lib/agreementManager.ts` に実装したパスは妥当な推測ですが、**本番接続前に必ずDocuSignのAPI Explorer／最新の公式リファレンス（`https://developers.docusign.com/docs/agreement-manager-api/`）で実際のエンドポイントとスコープ名を確認してください**。ズレていた場合は `api/lib/agreementManager.ts` の1ファイルだけ直せば直ります。

## アーキテクチャ

```
src/                      React (Vite) フロントエンド — PDFアップロードUI
api/docusign/upload.ts    POST: PDFを受け取りAgreement Managerへ取り込みジョブを実行
api/docusign/job-status.ts GET: 取り込みジョブのステータス確認
api/docusign/consent-url.ts GET: 一度だけ必要な同意（コンセント）URLを生成
api/lib/docusignAuth.ts   JWT Grantでアクセストークンを取得（プロセス内キャッシュ）
api/lib/agreementManager.ts  Bulk Ingestion APIクライアント
```

認証方式は **JWT Grant**（サーバー間連携、特定の単一アカウントで自動実行する用途に適している。ユーザーがその場にいる必要がなく、トークンは1時間有効）を採用しています。

## 1. DocuSignでIntegration Keyを作る

1. https://admin.docusign.com （本番）または https://admindemo.docusign.com （サンドボックス）にログイン
2. **Apps and Keys** → **Add App / Integration Key**
3. アプリ名を入力し作成。表示される **Integration Key（Client ID）** を控える
4. **Authentication** セクションで **RSA Keypairs** → **Generate RSA** をクリックし、表示された秘密鍵（PEM形式）を保存（再表示不可なので必ずこの時点で保存）
5. **Redirect URIs** に `https://localhost` などを1つ追加（JWT Grantの同意フローで使うダミーURI。実際のリダイレクトは発生しない）
6. ユーザー管理画面で、トークンの発行対象とする実行用ユーザー（impersonateするユーザー）の **User ID（GUID）** を確認
7. アカウントの **Account ID（GUID）** も控える（API Account ID。アカウント番号ではない）

## 2. スコープと同意（コンセント）URL — ここが一番ミスりやすい場所

JWT Grantでは、初回に一度だけ**個別ユーザー同意（individual consent）**をブラウザで取得する必要があります。同意していないと `consent_required` エラーになります。

必要スコープ（暫定。上記の通り書き込み系スコープ名は要確認）：
```
signature impersonation adm_store_unified_repo_read adm_store_unified_repo_write
```

同意URLの形式（`account-d.docusign.com` はサンドボックス、本番は `account.docusign.com`）：
```
https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation%20adm_store_unified_repo_read%20adm_store_unified_repo_write&client_id=YOUR_INTEGRATION_KEY&redirect_uri=YOUR_REDIRECT_URI
```

このアプリをデプロイ後、`GET /api/docusign/consent-url` にアクセスすると、設定済みの環境変数から自動生成されたURLが返ります。**そのURLをブラウザで開き、`DOCUSIGN_USER_ID` に指定したユーザーでログインして「Allow」をクリック**してください。これを1回行えば、以降はJWT Grantが裏側で自動的にトークンを取得します。

スコープを変更した場合は、同意も再度必要になります（古い同意は新しいスコープをカバーしません）。

## 3. Vercelの環境変数設定

`.env.example` を参考に、Vercelダッシュボードの **Project → Settings → Environment Variables** で以下を設定してください（ローカル開発では `.env` ファイルに同じ内容を書いて `vercel dev` または `vite` 経由で読み込みます）。

| 変数名 | 説明 |
|---|---|
| `DOCUSIGN_ENVIRONMENT` | `demo` または `production` |
| `DOCUSIGN_INTEGRATION_KEY` | Integration Key（Client ID） |
| `DOCUSIGN_USER_ID` | impersonate対象ユーザーのGUID |
| `DOCUSIGN_ACCOUNT_ID` | DocuSignアカウントのGUID |
| `DOCUSIGN_PRIVATE_KEY` | RSA秘密鍵（PEM）。改行は `\n` のリテラル文字列としてそのまま1行で貼り付ける |
| `DOCUSIGN_SCOPES` | （省略可）スコープ文字列。デフォルトは上記の暫定値 |
| `DOCUSIGN_API_BASE_URL` | （省略可）アカウントが専用APIホストを持つ場合のみ指定 |

**秘密鍵の貼り方の注意**：Vercelの環境変数は複数行の値も入力できますが、改行がそのまま保存されない場合があるため、`DOCUSIGN_PRIVATE_KEY` には `-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----` のように **改行を `\n` という2文字に置き換えて1行で**保存するのが安全です（`api/lib/env.ts` で自動的に実際の改行へ復元しています）。

設定後は **Redeploy** が必要です（環境変数の変更は次回デプロイから反映されます）。

## 4. ローカル開発

```bash
npm install
cp .env.example .env   # 値を入力
npm run dev             # フロントエンドは http://localhost:5173
```

`api/` 配下のServerless Functionsをローカルで動かすには Vercel CLI が必要です：
```bash
npm i -g vercel
vercel dev
```
（`vite.config.ts` の `server.proxy` で `/api` を `http://localhost:3000` へ転送する設定になっているので、`vercel dev` をポート3000で別途起動し、`npm run dev` のVite側からアクセスする構成です。）

## 5. 制限事項・確認すべき点

- PDFは1ファイル最大25MBに制限（`api/docusign/upload.ts` の `MAX_FILE_SIZE_BYTES`、Agreement Manager側の実際の上限は要確認）
- Bulk Ingestion APIの正確なエンドポイント・スコープ名は未検証（上記参照）
- JWTトークンはサーバーレス関数のプロセス内メモリにキャッシュされるため、コールドスタート時は毎回再認証されます。高頻度利用する場合はVercel KV等での永続キャッシュ化を検討してください
