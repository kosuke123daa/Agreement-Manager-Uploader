import type { VercelRequest, VercelResponse } from "@vercel/node"
import { getDocusignConfig } from "../lib/env"

/**
 * Returns the one-time individual consent URL that must be visited (logged
 * in as the user identified by DOCUSIGN_USER_ID) before JWT Grant token
 * requests will succeed. Visit the returned URL once in a browser, log in,
 * and click "Allow" — after that, JWT Grant works without further consent
 * until scopes change.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  const config = getDocusignConfig()
  const redirectUri =
    (req.query.redirectUri as string) || "https://localhost"

  const url = new URL("/oauth/auth", config.authServer)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", config.scopes)
  url.searchParams.set("client_id", config.integrationKey)
  url.searchParams.set("redirect_uri", redirectUri)

  res.status(200).json({ consentUrl: url.toString() })
}
