import type { VercelRequest, VercelResponse } from "@vercel/node"
import { getBulkUploadJobStatus } from "../lib/agreementManager"

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" })
    return
  }

  const jobId = req.query.jobId
  if (typeof jobId !== "string" || !jobId) {
    res.status(400).json({ error: "Missing jobId query parameter" })
    return
  }

  try {
    const status = await getBulkUploadJobStatus(jobId)
    res.status(200).json(status)
  } catch (error) {
    console.error("Failed to fetch job status:", error)
    res.status(502).json({
      error: "Failed to fetch job status",
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}
