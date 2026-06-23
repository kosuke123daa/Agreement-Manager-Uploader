import type { VercelRequest, VercelResponse } from "@vercel/node"
import { updateAgreement } from "../lib/agreementManager.js"

/**
 * Experimental endpoint to test attaching an external (e.g. Salesforce)
 * reference to an agreement via PATCH /agreements/{agreementId}.
 *
 * POST body: { "agreementId": "<uuid>", "patch": { ...fields to PATCH... } }
 *
 * The `patch` object is forwarded verbatim as the PATCH request body so we can
 * experiment with different shapes without redeploying, e.g.:
 *   { "source_name": "Salesforce", "source_id": "006XXXXXXXXXXXX" }
 *   { "linked_data": [{ "application_name": "Salesforce",
 *                       "object_name": "Opportunity",
 *                       "record_id": "006XXXXXXXXXXXX" }] }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" })
    return
  }

  const { agreementId, patch } = (req.body ?? {}) as {
    agreementId?: string
    patch?: Record<string, unknown>
  }

  if (typeof agreementId !== "string" || !agreementId) {
    res.status(400).json({ error: "Missing agreementId" })
    return
  }
  if (!patch || typeof patch !== "object") {
    res.status(400).json({ error: "Missing patch body" })
    return
  }

  try {
    const result = await updateAgreement(agreementId, patch)
    res.status(200).json({ ok: true, result })
  } catch (error) {
    console.error("Agreement PATCH failed:", error)
    res.status(502).json({
      error: "Agreement PATCH failed",
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}
