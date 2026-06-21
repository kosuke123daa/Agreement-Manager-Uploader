import type { VercelRequest, VercelResponse } from "@vercel/node"
import {
  createIngestionJob,
  uploadDocumentToJob,
  completeIngestionJob,
} from "../lib/agreementManager"

export const config = {
  api: {
    bodyParser: false,
  },
}

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" })
    return
  }

  const filename = req.headers["x-filename"]
  const contentType = req.headers["content-type"] || "application/pdf"

  if (typeof filename !== "string" || !filename) {
    res.status(400).json({ error: "Missing X-Filename header" })
    return
  }

  if (!filename.toLowerCase().endsWith(".pdf")) {
    res.status(400).json({ error: "Only PDF files are supported" })
    return
  }

  try {
    const fileBuffer = await readRawBody(req)

    if (fileBuffer.length === 0) {
      res.status(400).json({ error: "Empty file" })
      return
    }
    if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
      res.status(413).json({ error: "File exceeds 25 MB limit" })
      return
    }

    const job = await createIngestionJob(filename)
    await uploadDocumentToJob(job, fileBuffer, contentType)
    await completeIngestionJob(job.jobId)

    res.status(200).json({ jobId: job.jobId, status: "submitted" })
  } catch (error) {
    console.error("Agreement Manager upload failed:", error)
    res.status(502).json({
      error: "Upload to Docusign Agreement Manager failed",
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}
