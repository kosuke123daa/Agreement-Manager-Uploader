import { getDocusignConfig } from "./env"
import { getAccessToken } from "./docusignAuth"

/**
 * Client for the Docusign Agreement Manager API (formerly "Navigator API")
 * bulk ingestion flow: create a job, upload document(s) to the returned
 * cloud storage location, then mark the job complete.
 *
 * IMPORTANT: At the time this was written, Docusign's public docs for the
 * Agreement Manager bulk-ingestion endpoints were not reachable to verify
 * exact paths/payloads. The paths below are best-effort and ARE LIKELY TO
 * NEED ADJUSTMENT — confirm them against your account's API Explorer /
 * the current Agreement Manager API reference at
 * https://developers.docusign.com/docs/agreement-manager-api/ before
 * relying on this in production. All paths are centralized here so a fix
 * only needs to happen in one file.
 */

interface CreateJobResponse {
  jobId: string
  uploadUrl: string
  uploadMethod?: string
  uploadHeaders?: Record<string, string>
}

interface JobStatusResponse {
  jobId: string
  status: string
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

export async function createIngestionJob(filename: string) {
  const config = getDocusignConfig()

  const response = await docusignFetch(
    `/v1/accounts/${config.accountId}/agreements/bulk`,
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

export async function uploadDocumentToJob(
  job: CreateJobResponse,
  fileBuffer: Buffer,
  contentType: string
) {
  const response = await fetch(job.uploadUrl, {
    method: job.uploadMethod || "PUT",
    headers: {
      "Content-Type": contentType,
      ...job.uploadHeaders,
    },
    body: fileBuffer as BodyInit,
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Document upload to cloud storage failed: ${body}`)
  }
}

export async function completeIngestionJob(jobId: string) {
  const config = getDocusignConfig()

  await docusignFetch(
    `/v1/accounts/${config.accountId}/agreements/bulk/${jobId}/complete`,
    { method: "POST" }
  )
}

export async function getIngestionJobStatus(jobId: string) {
  const config = getDocusignConfig()

  const response = await docusignFetch(
    `/v1/accounts/${config.accountId}/agreements/bulk/${jobId}`,
    { method: "GET" }
  )

  return (await response.json()) as JobStatusResponse
}
