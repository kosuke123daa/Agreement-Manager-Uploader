import type { VercelRequest, VercelResponse } from "@vercel/node"
import { listRecentAgreements } from "../lib/agreementManager.js"

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" })
    return
  }

  try {
    const result = await listRecentAgreements(10)
    res.status(200).json(result)
  } catch (error) {
    console.error("Failed to fetch agreements list:", error)
    res.status(502).json({
      error: "Failed to fetch agreements list",
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}
