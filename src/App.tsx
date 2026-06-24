import { useCallback, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { FileText, Loader2, UploadCloud, CheckCircle2, XCircle, ListChecks } from "lucide-react"

type UploadState = "idle" | "uploading" | "success" | "error"

interface AgreementListItem {
  id: string
  title?: string
  type?: string
  status?: string
  file_name?: string
  source_name?: string
  source_id?: string
  metadata?: {
    created_at?: string
  }
}

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [state, setState] = useState<UploadState>("idle")
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Optional Salesforce link applied at upload time via linked_data metadata.
  const [sfObjectName, setSfObjectName] = useState("Opportunity")
  const [sfRecordId, setSfRecordId] = useState("")

  const [agreements, setAgreements] = useState<AgreementListItem[] | null>(null)
  const [agreementsLoading, setAgreementsLoading] = useState(false)
  const [agreementsError, setAgreementsError] = useState<string | null>(null)

  const handleFile = useCallback((selected: File | null) => {
    setState("idle")
    setMessage(null)
    setJobId(null)
    if (selected && selected.type !== "application/pdf") {
      setMessage("PDFファイルのみアップロードできます。")
      setFile(null)
      return
    }
    setFile(selected)
  }, [])

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    handleFile(event.dataTransfer.files[0] ?? null)
  }

  const handleUpload = async () => {
    if (!file) return
    setState("uploading")
    setProgress(15)
    setMessage(null)

    try {
      setProgress(40)
      const headers: Record<string, string> = {
        "Content-Type": file.type || "application/pdf",
        // HTTP headers must be ISO-8859-1; percent-encode to safely carry
        // non-ASCII filenames (e.g. Japanese), decoded server-side.
        "X-Filename": encodeURIComponent(file.name),
      }
      // If a Salesforce record was specified, attach it as linked_data so the
      // document is associated with that record at ingest time.
      if (sfRecordId.trim() && sfObjectName.trim()) {
        headers["X-Linked-Data"] = encodeURIComponent(
          JSON.stringify([
            {
              application_name: "Salesforce",
              object_name: sfObjectName.trim(),
              record_id: sfRecordId.trim(),
            },
          ])
        )
      }
      const response = await fetch("/api/docusign/upload", {
        method: "POST",
        headers,
        body: file,
      })

      setProgress(80)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.detail || data.error || "アップロードに失敗しました。")
      }

      setProgress(100)
      setJobId(data.jobId)
      setState("success")
      setMessage("Agreement Manager への取り込みジョブを送信しました。")
    } catch (error) {
      setState("error")
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const handleFetchAgreements = async () => {
    setAgreementsLoading(true)
    setAgreementsError(null)
    try {
      const response = await fetch("/api/docusign/agreements")
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || data.error || "一覧の取得に失敗しました。")
      }
      setAgreements(data.data ?? [])
    } catch (error) {
      setAgreementsError(error instanceof Error ? error.message : String(error))
      setAgreements(null)
    } finally {
      setAgreementsLoading(false)
    }
  }

  const reset = () => {
    setFile(null)
    setState("idle")
    setProgress(0)
    setMessage(null)
    setJobId(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-muted/30 p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Agreement Manager アップロード</CardTitle>
          <CardDescription>
            PDFをDocusign Agreement Managerに取り込みます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-10 text-center cursor-pointer hover:border-primary/50 transition-colors"
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <>
                <FileText className="size-8 text-primary" />
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </>
            ) : (
              <>
                <UploadCloud className="size-8 text-muted-foreground" />
                <p className="text-sm">
                  クリックまたはドラッグ＆ドロップでPDFを選択
                </p>
              </>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Salesforceレコードとひも付け（任意・linked_dataとして取り込み時に付与）
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={sfObjectName}
                onChange={(e) => setSfObjectName(e.target.value)}
                placeholder="オブジェクト名 (例: Opportunity)"
                className="w-1/3 rounded-md border px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={sfRecordId}
                onChange={(e) => setSfRecordId(e.target.value)}
                placeholder="レコードID (例: 006al00000PmxicAAB)"
                className="flex-1 rounded-md border px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>

          {state === "uploading" && <Progress value={progress} />}

          {state === "success" && (
            <Alert>
              <CheckCircle2 />
              <AlertTitle>送信完了</AlertTitle>
              <AlertDescription>
                {message}
                {jobId && (
                  <Badge variant="secondary" className="mt-1">
                    Job ID: {jobId}
                  </Badge>
                )}
              </AlertDescription>
            </Alert>
          )}

          {state === "error" && (
            <Alert variant="destructive">
              <XCircle />
              <AlertTitle>エラー</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}

          {state === "idle" && message && (
            <Alert variant="destructive">
              <XCircle />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button
            onClick={handleUpload}
            disabled={!file || state === "uploading"}
            className="flex-1"
          >
            {state === "uploading" ? (
              <>
                <Loader2 className="animate-spin" /> アップロード中…
              </>
            ) : (
              "アップロード"
            )}
          </Button>
          {(file || state !== "idle") && (
            <Button variant="outline" onClick={reset}>
              リセット
            </Button>
          )}
        </CardFooter>
      </Card>

      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>最新の契約書一覧</CardTitle>
          <CardDescription>
            Agreement Managerに保存されている契約書を作成日の新しい順に10件取得します（GET動作確認用）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {agreementsError && (
            <Alert variant="destructive">
              <XCircle />
              <AlertTitle>エラー</AlertTitle>
              <AlertDescription>{agreementsError}</AlertDescription>
            </Alert>
          )}

          {agreements && agreements.length === 0 && !agreementsError && (
            <p className="text-sm text-muted-foreground">
              契約書が見つかりませんでした。
            </p>
          )}

          {agreements && agreements.length > 0 && (
            <ul className="space-y-2">
              {agreements.map((agreement) => (
                <li
                  key={agreement.id}
                  className="flex items-center justify-between gap-2 rounded-md border p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {agreement.title || agreement.file_name || agreement.id}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {agreement.id}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {agreement.metadata?.created_at ?? "作成日不明"}
                    </p>
                    {(agreement.source_name || agreement.source_id) && (
                      <p className="text-xs text-primary font-mono truncate">
                        🔗 {agreement.source_name}: {agreement.source_id}
                      </p>
                    )}
                  </div>
                  {agreement.status && (
                    <Badge variant="secondary">{agreement.status}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleFetchAgreements}
            disabled={agreementsLoading}
            variant="outline"
            className="w-full"
          >
            {agreementsLoading ? (
              <>
                <Loader2 className="animate-spin" /> 取得中…
              </>
            ) : (
              <>
                <ListChecks /> 最新10件を取得
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

export default App
