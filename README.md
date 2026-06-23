# Agreement Manager Uploader

PDFをDocusign **Agreement Manager**（旧Navigator）に取り込む（ingest）ための、React (Vite) + TypeScript + Tailwind + shadcn/ui フロントエンドと、Vercel Serverless Functionsによるバックエンドのアプリです。

## 重要な前提（必読）

DocuSignには厳密には「Agreement Manager」という名前のAPI製品は元々存在せず、2026年に **Navigator → Agreement Manager** へ名称変更されたものを指しています。Navigator時代のAPIはGET/DELETE/summarizeのみのベータ版で、文書のアップロードAPIは存在しませんでした。リブランドに伴い **Bulk Upload API**（ジョブを作成 → Azure Blob Storageへ直接PUT → ジョブ完了通知、という3段構成）が追加されています。

`developers.docusign.com` への直接アクセスが403で拒否されたため公式リファレンスでの完全な裏取りはできていませんが、社内で別途確認が取れた情報をもとに、エンドポイント・スコープを以下の内容で実装し直しました（`api/lib/agreementManager.ts`）。**それでも本番接続前には、DocuSignのAPI ExplorerまたはAgreement Manager APIの最新リファレンスで最終確認することを推奨します。**

## アーキテクチャ

```
src/                      React (Vite) フロントエンド — PDFアップロードUI
api/docusign/upload.ts    POST: PDFを受け取りBulk Uploadジョブを実行
api/docusign/job-status.ts GET: Bulk Uploadジョブのステータス確認
api/docusign/consent-url.ts GET: 一度だけ必要な同意（コンセント）URLを生成
api/lib/docusignAuth.ts   JWT Grantでアクセストークンを取得（プロセス内キャッシュ）
api/lib/agreementManager.ts  Bulk Upload APIクライアント
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

必要スコープ（Bulk Upload + Agreement Manager。eSignature用の `signature` `impersonation` の上に重ねる形で付与）：

| スコープ | 用途 |
|---|---|
| `signature` | eSignature REST APIの基本スコープ（必須） |
| `impersonation` | JWT Grantでのユーザー偽装（必須） |
| `document_uploader_write` | Bulk Uploadジョブの作成・完了通知（`createBulkUploadJob` / 完了アクション）に必須 |
| `document_uploader_read` | Bulk Uploadジョブのステータス取得（`getBulkUploadJobStatus`）に必須 |
| `adm_store_unified_repo_write` | アップロードした文書からAgreementデータを書き込むために必須 |
| `adm_store_unified_repo_read` | アップロード後のAgreementレコードの読み出し・検索のため、ほぼセットで付与 |
| `public_dms_document_read` | Agreementの `download_url` からPDF本体をダウンロードする場合に必要（このアプリでは未使用だが二度目の同意を避けるため事前付与） |
| `search_read` | Agreement一覧取得時に `$search` でテキスト検索する場合に必要（同上） |

同意URLの形式（`account-d.docusign.com` はサンドボックス、本番は `account.docusign.com`）：
```
https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation%20document_uploader_read%20document_uploader_write%20adm_store_unified_repo_read%20adm_store_unified_repo_write%20public_dms_document_read%20search_read&client_id=YOUR_INTEGRATION_KEY&redirect_uri=YOUR_REDIRECT_URI
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

## 5. Bulk Upload APIのエンドポイント詳細

| 処理 | メソッド・パス |
|---|---|
| ジョブ作成（アップロード先URL取得） | `POST /v1/accounts/{accountId}/upload/jobs`（リクエストボディは `{ "expected_number_of_docs": 1, "job_name": "...", "language": "en-US" }`。`expected_number_of_docs` が必須。ファイル名はこのリクエストでは送らず、後述のBlob StorageへのPUT時に `x-ms-meta-filename` ヘッダーで渡す） |
| ファイル本体のアップロード | `PUT <ジョブ作成レスポンスの _embedded.documents[]._actions.upload_document>`（Azure Blob Storageへ直接。`x-ms-blob-type: BlockBlob` ヘッダーが必須、Docusignの認証ヘッダーは不要） |
| アップロード完了通知 | `POST /v1/accounts/{accountId}/upload/jobs/{jobId}/actions/complete` |
| ジョブステータス確認 | `GET /v1/accounts/{accountId}/upload/jobs/{jobId}` |

（補足1: 一時的に `/jobs/bulk` というパスに変更していましたが、これは500エラーのレスポンスボディに含まれていた `"path"` フィールド（サーバー内部のルーティング情報で、公開APIパスではなかった）を誤って参照したための誤りでした。正しい公開APIパスは `/upload/jobs` です。）

（補足2: ジョブ作成リクエストのボディは `{ "expected_number_of_docs": 1, ... }` の形でトップレベルにフィールドを置きます。公式リファレンスのcurl例は `{ "body": {} }` のように `"body"` キーでラップしていますが、**これは誤りで、そのまま送ると500エラー（レスポンスの `path` が `/jobs/bulk` になる）になります**。ラッパーを外し、`expected_number_of_docs`（必須・アップロード予定ファイル数）をトップレベルに置くのが正解です。レスポンスの `_embedded.documents[]._actions.upload_document`（文字列のURL）にファイルをPUTする際、ファイル名は `x-ms-meta-filename` ヘッダーで渡します。）

## 6. 制限事項・確認すべき点

- PDFは1ファイル最大25MBに制限（`api/docusign/upload.ts` の `MAX_FILE_SIZE_BYTES`、Agreement Manager側の実際の上限は要確認）
- 上記エンドポイント・スコープは公式リファレンスへの直接アクセスができない環境で組んだため、本番接続前にDocuSign側で最終確認を推奨
- JWTトークンはサーバーレス関数のプロセス内メモリにキャッシュされるため、コールドスタート時は毎回再認証されます。高頻度利用する場合はVercel KV等での永続キャッシュ化を検討してください
