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
import { FileText, Loader2, UploadCloud, CheckCircle2, XCircle } from "lucide-react"

type UploadState = "idle" | "uploading" | "success" | "error"

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [state, setState] = useState<UploadState>("idle")
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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
      const response = await fetch("/api/docusign/upload", {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/pdf",
          "X-Filename": file.name,
        },
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

  const reset = () => {
    setFile(null)
    setState("idle")
    setProgress(0)
    setMessage(null)
    setJobId(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
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
    </div>
  )
}

export default App
