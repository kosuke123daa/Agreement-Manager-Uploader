import { getDocusignConfig } from "./env.js"
import { getAccessToken } from "./docusignAuth.js"

/**
 * Client for the Docusign Agreement Manager API "Bulk Upload" flow:
 * 1. POST /v1/accounts/{accountId}/upload/jobs           — create a job,
 *    get back a presigned Azure Blob Storage URL per document.
 * 2. PUT  <presigned URL>                                — upload the raw
 *    file bytes directly to Azure Blob Storage (no Docusign auth header).
 * 3. POST /v1/accounts/{accountId}/upload/jobs/{jobId}/actions/complete
 *                                                          — tell Docusign
 *    all files were uploaded so ingestion/AI extraction can start.
 * 4. GET  /v1/accounts/{accountId}/upload/jobs/{jobId}    — poll job status
 *    (OPEN / IN_PROGRESS / COMPLETE / FAILED).
 */

interface CreateJobResponse {
  jobId: string
  _actions: {
    upload_document: Array<{
      name: string
      url: string
    }>
  }
}

interface JobStatusResponse {
  jobId: string
  status: "OPEN" | "IN_PROGRESS" | "COMPLETE" | "FAILED" | string
  documents?: Array<{ name: string; status: string; agreementId?: string }>
}

async function docusignFetch(path: string, init: RequestInit) {
  const config = getDocusignConfig()
  const token = await getAccessToken()

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(
      `Agreement Manager API request failed (${response.status}) for ${path}: ${body}`
    )
  }

  return response
}

export async function createBulkUploadJob(filename: string) {
  const config = getDocusignConfig()

  const response = await docusignFetch(
    `/v1/accounts/${config.accountId}/upload/jobs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documents: [{ name: filename }],
      }),
    }
  )

  return (await response.json()) as CreateJobResponse
}

export async function uploadDocumentToBlobStorage(
  uploadUrl: string,
  filename: string,
  fileBuffer: Buffer,
  contentType: string
) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "x-ms-blob-type": "BlockBlob",
      "x-ms-meta-filename": filename,
      "Content-Type": contentType,
    },
    body: fileBuffer as BodyInit,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Document upload to blob storage failed: ${body}`)
  }
}

export async function completeBulkUploadJob(jobId: string) {
  const config = getDocusignConfig()

  await docusignFetch(
    `/v1/accounts/${config.accountId}/upload/jobs/${jobId}/actions/complete`,
    { method: "POST" }
  )
}

export async function getBulkUploadJobStatus(jobId: string) {
  const config = getDocusignConfig()

  const response = await docusignFetch(
    `/v1/accounts/${config.accountId}/upload/jobs/${jobId}`,
    { method: "GET" }
  )

  return (await response.json()) as JobStatusResponse
}
