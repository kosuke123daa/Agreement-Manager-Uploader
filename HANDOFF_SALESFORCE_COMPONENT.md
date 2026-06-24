# 引き継ぎ資料：Agreement Manager 連携の実装内容と、Salesforceコンポーネント開発の要件

このドキュメントは、別のClaude Code（または開発者）が **Salesforce上に「文書アップロード」＋「開いている商談レコードに紐づく文書一覧表示」コンポーネント** を新規開発するための引き継ぎ資料です。
これまでに `Agreement-Manager-Uploader`（React + Vercel Serverless）リポジトリで検証・実装した内容と、そこで得た重要な知見をまとめています。

---

## 0. 背景・ゴール

- **やりたいこと**：DocuSign Agreement Manager（旧Navigator）に文書をアップロードし、特定のSalesforceレコード（商談=Opportunityなど）に紐づけて、そのレコードページ上で関連文書を一覧表示したい。
- **既存の課題**：DocuSign標準の「Docusign Completed Agreements」コンポーネントは、**エンベロープ由来の文書しか表示しない**（理由は後述）。APIで直接アップロードした文書は表示されない。
- **本コンポーネントの目的**：標準コンポーネントに依存せず、自前のLWC（Lightning Web Component）で、
  1. 開いている商談（Opportunity）レコードページから文書をアップロードして商談に紐づける
  2. その商談に紐づく文書（エンベロープ由来・直接アップロード両方）を一覧表示する
  をSalesForce上で実現する。

---

## 1. 最重要の知見（ここが本質）

### 1-1. 「Docusign Completed Agreements」コンポーネントが直接アップロード文書を表示しない理由（確定済み）

標準コンポーネントは **Agreement Manager側の `linked_data` を参照していない**。
代わりに **Salesforce側のマネージドパッケージ（namespace `dfsle__`）のオブジェクト `dfsle__EnvelopeStatus__c`** を、`dfsle__Opportunity__c` 等のルックアップで紐づけて表示している。

- エンベロープ経由で締結完了した文書 → `dfsle__EnvelopeStatus__c` が自動生成される → 表示される
- APIで直接アップロードした文書 → エンベロープが存在しない → `dfsle__EnvelopeStatus__c` が作られない → **表示されない**

**実証データ**：
- Agreement Manager上のeSign由来 agreement の `source_id` = `c84c20a1-5e48-87b2-805d-8fa0dc621799`
- これが `dfsle__EnvelopeStatus__c` レコード「DSX-0000010」の `dfsle__DocuSignId__c` と完全一致
- そのレコードの `dfsle__Opportunity__c` = `006al00000PmxicAAB`

→ つまり標準コンポーネントは「エンベロープ→Salesforceレコード」の紐づけ（dfsleパッケージが管理）に依存しており、Agreement Managerの`linked_data`は別レイヤー。**自前コンポーネントを作るしかない**、というのが結論。

### 1-2. 一方で、Agreement Manager側の `linked_data` での紐づけは成功している（実証済み）

APIで直接アップロードした文書に、Salesforceのrecord idを `linked_data` として付与できることは**実機確認済み**。下記が実際に取得できたアップロード文書のGET結果（抜粋）：

```json
{
  "id": "f22d93b2-fa2a-44ec-96e3-b8b626df2a81",
  "file_name": "test.pdf",
  "source_name": "UploadApiJob",
  "linked_data": [
    { "application_name": "Salesforce", "object_name": "Opportunity", "record_id": "006al00000PmxicAAB" }
  ]
}
```

→ 自前コンポーネントは、この `linked_data` の `record_id` をキーにして「開いている商談に紐づく文書」をフィルタ表示すればよい。

---

## 2. DocuSign Agreement Manager API の使い方（実装で確定した仕様）

> ⚠️ 公式リファレンスには誤った例があり、ハマりどころが多い。以下は**実機で動作確認済みの正しい仕様**。

### 2-1. 認証：JWT Grant

- サーバー間連携。`signature impersonation` に加えて以下のスコープが必要：
  - `document_uploader_write` … Bulk Uploadジョブの作成・完了通知に必須
  - `document_uploader_read` … ジョブステータス取得に必須
  - `adm_store_unified_repo_write` … アップロード文書からAgreementデータを書き込む
  - `adm_store_unified_repo_read` … Agreementレコードの読み出し・検索
- 初回に一度だけ individual consent（同意URLをブラウザで承認）が必要。スコープ変更時は再同意が必要。
- 環境変数：`DOCUSIGN_ENVIRONMENT`(demo/production), `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_PRIVATE_KEY`(PEM, 改行は`\n`literalで1行化)。

### 2-2. Bulk Upload（アップロード）フロー：3ステップ

#### ステップ1：ジョブ作成
```
POST /v1/accounts/{accountId}/upload/jobs
Content-Type: application/json

{ "expected_number_of_docs": 1, "job_name": "ファイル名など", "language": "en-US" }
```
- ⚠️ **`{ "body": {...} }` でラップしてはいけない**。公式リファレンスのcurl例は `--data-raw '{ "body": {} }'` になっているが**これは誤りで、500エラーになる**（レスポンスの`path`が`/jobs/bulk`になる）。フィールドはトップレベルに置く。
- ⚠️ `expected_number_of_docs` が**必須**。
- レスポンスの `_embedded.documents[]._actions.upload_document`（文字列URL）が、次のステップでファイルをPUTするAzure Blob StorageのプリサインドURL。

#### ステップ2：ファイル本体をBlob StorageへPUT（★ここで linked_data を付与する）
```
PUT <ステップ1で得たプリサインドURL>
x-ms-blob-type: BlockBlob
x-ms-meta-filename: <percent-encodeしたファイル名>
x-ms-meta-metadata: {"linked_data":[{"application_name":"Salesforce","object_name":"Opportunity","record_id":"006al..."}]}
Content-Type: application/pdf

<ファイルのバイナリ>
```
- DocuSignの認証ヘッダーは**不要**（Azureへの直PUT）。
- ⚠️ **HTTPヘッダー値はISO-8859-1。日本語ファイル名は `encodeURIComponent` でpercent-encodeしないと「Cannot convert argument to a ByteString」エラーになる**。
- ★ **Salesforceレコードとの紐づけは、この `x-ms-meta-metadata` ヘッダーで取り込み時に渡す**。値は `linked_data` を含む1つのJSONを文字列化したもの。
  - record_id / object_name はASCIIなので生のJSON文字列でOK（percent-encode不要）。
  - **アップロード後のPATCHでは linked_data は永続化されない**（204が返るが反映されない）。必ずこのアップロード時メタデータで渡すこと。

#### ステップ3：アップロード完了通知
```
POST /v1/accounts/{accountId}/upload/jobs/{jobId}/actions/complete
```
- これでDocuSign側の取り込み・AI抽出が始まる。

#### （任意）ジョブステータス確認
```
GET /v1/accounts/{accountId}/upload/jobs/{jobId}
```
- `_embedded.documents[].agreement_id` から、作成された agreement のIDが取れる。

### 2-3. Agreements（読み取り）API

#### 単一取得（linked_data含む）
```
GET /v1/accounts/{accountId}/agreements/{agreementId}?include_linked_data=true
```
- ⚠️ **`include_linked_data=true` を付けないと `linked_data` がレスポンスに展開されない**。
- レスポンスの `linked_data[].record_id` に付与したSalesforce record idが入る。
- `source_name` … `ESign`（エンベロープ由来）/ `UploadApiJob`（直接アップロード）の区別がつく。

#### 一覧取得
```
GET /v1/accounts/{accountId}/agreements?limit=10&sort=metadata.created_at&direction=desc
```
- 公開リファレンス上、Agreementsに対する操作は GET(list) / GET(detail) / DELETE / summarize の4つのみ。**フィールド更新用のPATCHは公開されていない**（`_actions`に出るのは`change_type`のみ）。
- ⚠️ 「特定のSalesforce record idに紐づくagreement一覧を直接フィルタするクエリパラメータ」が公式にあるかは**未確認**。一覧取得して `linked_data` でクライアント側フィルタする方法が確実。専用フィルタ（例：`?document_id=` など）が使えるかは要検証。

---

## 3. 既存リポジトリの実装（参考になるコード）

リポジトリ：`Agreement-Manager-Uploader`（React + Vite + Vercel Serverless Functions）

| ファイル | 役割 |
|---|---|
| `api/lib/agreementManager.ts` | Bulk Upload APIクライアント本体。`createBulkUploadJob` / `uploadDocumentToBlobStorage`（linked_data付与） / `completeBulkUploadJob` / `getBulkUploadJobStatus` / `listRecentAgreements` / `getAgreement`(include_linked_data=true) |
| `api/lib/docusignAuth.ts` | JWT Grantでアクセストークン取得（プロセス内キャッシュ） |
| `api/docusign/upload.ts` | POST: PDFを受け取りBulk Uploadを実行。`X-Linked-Data`ヘッダー（percent-encodeされたJSON配列）でSalesforce紐づけを受け取る |
| `api/docusign/agreements.ts` | GET: agreement一覧 |
| `api/docusign/agreement.ts` | GET: agreement単一（linked_data確認用） |
| `api/docusign/consent-url.ts` | 初回同意URL生成 |
| `src/App.tsx` | アップロードUI / 一覧 / 「紐付け確認」（linked_data表示）UI |

`uploadDocumentToBlobStorage` の中核（linked_data付与部分）：
```ts
const headers: Record<string, string> = {
  "x-ms-blob-type": "BlockBlob",
  "x-ms-meta-filename": encodeURIComponent(filename),
  "Content-Type": contentType,
}
if (linkedData && linkedData.length > 0) {
  headers["x-ms-meta-metadata"] = JSON.stringify({ linked_data: linkedData })
}
```

---

## 4. 作りたいSalesforceコンポーネントの要件

開いているOpportunityレコードページに配置するLWCを想定。

### 機能A：アップロード
- レコードページからPDFを選択してアップロード。
- アップロード時に、**開いているレコードのId（`recordId`）を `linked_data` の `record_id`、`object_name`を`Opportunity`（または実際のオブジェクト名）として付与**する。
- 実装方式は2案：
  - **(推奨) Apexから外部API（上記Bulk Upload 3ステップ）を直接呼ぶ**。`Named Credential` でDocuSign認証（JWT）を構成。Azure BlobへのPUTはApex `HttpRequest`（認証ヘッダー無し、`x-ms-meta-metadata`に`linked_data`）。
  - もしくは、既存のVercelバックエンド（`/api/docusign/upload`、`X-Linked-Data`ヘッダー対応済み）を中継APIとして呼ぶ。

### 機能B：関連文書の一覧表示
- 開いているレコードの `recordId` をキーに、そのレコードに紐づくagreementを一覧表示。
- データ取得方針：
  - Agreement Manager の一覧API（`GET /agreements`）を叩き、各agreementの `linked_data[].record_id` が現在の `recordId` と一致するものを抽出。
  - これにより**エンベロープ由来（`source_name: ESign`）も直接アップロード（`UploadApiJob`）も両方**拾える（両者とも同じ `linked_data` スキーマを持つことを実証済み）。
  - 専用フィルタクエリが使えるか（§2-3）は要検証。使えなければ一覧取得＋クライアント側フィルタ。
- 表示項目候補：`title` / `file_name` / `type` / `status` / `provisions`（金額・締結日など） / `source_name`（由来）。
- 文書の実体DLは `_links.document.href`（要 `public_dms_document_read` スコープ）。

### 注意点
- Apexからの外部コールアウトには **Remote Site Settings または Named Credential** の登録が必要。
- DocuSign JWTのトークン取得をApexでやる場合、秘密鍵の保管（`Named Credential`のJWT機能 or Protected Custom Metadata）に注意。
- record_idのフォーマット：Salesforceの15桁/18桁ID。eSign由来の `linked_data` には Opportunity/Account/Contact/User など複数レコードが自動付与される（dfsleパッケージが関連レコードを全部紐づけるため）。自前アップロードでは必要なものだけ付与すればよい。

---

## 5. 検証で使った実データ（参考）

- Opportunity: `006al00000PmxicAAB`（"PlantEye Sシリーズ - PES-S100 1台"）
- アップロード文書 agreement id: `f22d93b2-fa2a-44ec-96e3-b8b626df2a81`（source_name: UploadApiJob, linked_data に上記Opportunity）
- eSign由来 agreement id: `689821fc-e3ea-4484-bef7-123c1c29345f`（source_name: ESign, linked_data 5件）
- DocuSign account id: `bf4f64a5-bda9-4ecb-9c6e-3d44abb54ac5`(demo環境)
- 対応する `dfsle__EnvelopeStatus__c`: "DSX-0000010"（DocuSignId=eSign agreementのsource_id）

---

## 6. まとめ（TL;DR）

1. Agreement Manager Bulk Upload APIで文書アップロード＋ `x-ms-meta-metadata` ヘッダーの `linked_data` でSalesforce record id紐づけは**できる**（実証済み）。
2. ただしDocuSign標準の「Docusign Completed Agreements」コンポーネントは `dfsle__EnvelopeStatus__c`（エンベロープ）依存で、直接アップロード文書は**表示しない**。
3. よって、**自前LWCで「アップロード」＋「`linked_data`を使った関連文書一覧」を実装する**のが本タスク。
4. 一覧は `linked_data[].record_id == recordId` でフィルタすれば、エンベロープ由来・直接アップロード両方を統合表示できる。
