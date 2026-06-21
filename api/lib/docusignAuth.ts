import jwt from "jsonwebtoken"
import { getDocusignConfig } from "./env.js"

interface CachedToken {
  accessToken: string
  expiresAt: number
}

// Module-level cache. Serverless instances are reused between invocations
// while warm, so this avoids re-requesting a token on every call without
// needing an external store. A cold start simply re-authenticates.
let cachedToken: CachedToken | null = null

async function requestJwtToken(): Promise<CachedToken> {
  const config = getDocusignConfig()

  const assertion = jwt.sign(
    {
      iss: config.integrationKey,
      sub: config.userId,
      aud: new URL(config.authServer).host,
      scope: config.scopes,
    },
    config.privateKey,
    { algorithm: "RS256", expiresIn: "1h" }
  )

  const response = await fetch(`${config.authServer}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    // consent_required means the one-time admin/individual consent URL
    // (see api/docusign/consent-url.ts) has not been visited yet.
    throw new Error(
      `DocuSign token request failed (${response.status}): ${body}`
    )
  }

  const data = (await response.json()) as {
    access_token: string
    expires_in: number
  }

  return {
    accessToken: data.access_token,
    // Refresh a little early to avoid edge-of-expiry failures.
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  }
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken
  }
  cachedToken = await requestJwtToken()
  return cachedToken.accessToken
}
