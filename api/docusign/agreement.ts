import type { VercelRequest, VercelResponse } from "@vercel/node"
import { getAgreement } from "../lib/agreementManager.js"

// GET /api/docusign/agreement?id=<agreementId>
// Returns the full raw agreement JSON so linked_data etc. can be inspected.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" })
    return
  }

  const id = req.query.id
  if (typeof id !== "string" || !id) {
    res.status(400).json({ error: "Missing id query parameter" })
    return
  }

  try {
    const result = await getAgreement(id)
    res.status(200).json(result)
  } catch (error) {
    console.error("Failed to fetch agreement:", error)
    res.status(502).json({
      error: "Failed to fetch agreement",
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}
