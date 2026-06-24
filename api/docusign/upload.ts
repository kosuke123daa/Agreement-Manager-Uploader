import type { VercelRequest, VercelResponse } from "@vercel/node"
import {
  createBulkUploadJob,
  uploadDocumentToBlobStorage,
  completeBulkUploadJob,
  type LinkedDataItem,
} from "../lib/agreementManager.js"

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

  // Optional: link the uploaded document to an external record (e.g. a
  // Salesforce Account/Opportunity). The client sends a percent-encoded,
  // stringified JSON array in the X-Linked-Data header so non-ASCII stays
  // header-safe; it maps to the `linked_data` ingest metadata.
  let linkedData: LinkedDataItem[] | undefined
  const rawLinkedData = req.headers["x-linked-data"]
  if (typeof rawLinkedData === "string" && rawLinkedData) {
    try {
      const parsed = JSON.parse(decodeURIComponent(rawLinkedData))
      if (Array.isArray(parsed) && parsed.length > 0) {
        linkedData = parsed as LinkedDataItem[]
      }
    } catch {
      res.status(400).json({ error: "Invalid X-Linked-Data header (must be JSON)" })
      return
    }
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
    const document = job._embedded.documents[0]
    const uploadUrl = document?._actions.upload_document
    if (!uploadUrl) {
      throw new Error(
        "Bulk upload job response did not include an upload URL for this file"
      )
    }

    await uploadDocumentToBlobStorage(
      uploadUrl,
      filename,
      fileBuffer,
      contentType,
      linkedData
    )
    await completeBulkUploadJob(job.id)

    res.status(200).json({ jobId: job.id, status: "submitted" })
  } catch (error) {
    console.error("Agreement Manager upload failed:", error)
    res.status(502).json({
      error: "Upload to Docusign Agreement Manager failed",
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}
