function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export function getDocusignConfig() {
  const environment = (process.env.DOCUSIGN_ENVIRONMENT || "demo") as
    | "demo"
    | "production"

  return {
    environment,
    authServer:
      environment === "production"
        ? "https://account.docusign.com"
        : "https://account-d.docusign.com",
    apiBaseUrl:
      process.env.DOCUSIGN_API_BASE_URL ||
      (environment === "production"
        ? "https://api.docusign.com"
        : "https://api-d.docusign.com"),
    integrationKey: required("DOCUSIGN_INTEGRATION_KEY"),
    userId: required("DOCUSIGN_USER_ID"),
    accountId: required("DOCUSIGN_ACCOUNT_ID"),
    // PEM-formatted RSA private key. Store with literal "\n" line breaks in
    // the Vercel env var value; we unescape them here.
    privateKey: required("DOCUSIGN_PRIVATE_KEY").replace(/\\n/g, "\n"),
    // Bulk Upload + Agreement Manager scopes, plus the base eSignature/JWT
    // scopes Agreement Manager scopes are layered on top of. Includes
    // public_dms_document_read/search_read for downstream download/search,
    // which this app doesn't currently call but are safe to request now to
    // avoid a second consent round trip later.
    scopes:
      process.env.DOCUSIGN_SCOPES ||
      "signature impersonation document_uploader_read document_uploader_write adm_store_unified_repo_read adm_store_unified_repo_write public_dms_document_read search_read",
  }
}
