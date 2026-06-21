import type { VercelRequest, VercelResponse } from "@vercel/node"
import {
  createBulkUploadJob,
  uploadDocumentToBlobStorage,
  completeBulkUploadJob,
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

  const rawFilename = req.headers["x-filename"]
  const contentType = req.headers["content-type"] || "application/pdf"

  if (typeof rawFilename !== "string" || !rawFilename) {
    res.status(400).json({ error: "Missing X-Filename header" })
    return
  }

  // Header value is percent-encoded client-side to safely carry non-ASCII
  // filenames (e.g. Japanese) over an HTTP header.
  const filename = decodeURIComponent(rawFilename)

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

    const job = await createBulkUploadJob(filename)
    const uploadTarget = job._actions.upload_document.find(
      (doc) => doc.name === filename
    )
    if (!uploadTarget) {
      throw new Error(
        "Bulk upload job response did not include an upload URL for this file"
      )
    }

    await uploadDocumentToBlobStorage(
      uploadTarget.url,
      filename,
      fileBuffer,
      contentType
    )
    await completeBulkUploadJob(job.jobId)

    res.status(200).json({ jobId: job.jobId, status: "submitted" })
  } catch (error) {
    console.error("Agreement Manager upload failed:", error)
    res.status(502).json({
      error: "Upload to Docusign Agreement Manager failed",
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}
