import { getDocusignConfig } from "./env.js"
import { getAccessToken } from "./docusignAuth.js"

/**
 * Client for the Docusign Agreement Manager API "Bulk Upload" flow:
 * 1. POST /v1/accounts/{accountId}/upload/jobs              — create a job,
 *    get back a presigned Azure Blob Storage URL per document.
 * 2. PUT  <presigned URL>                                — upload the raw
 *    file bytes directly to Azure Blob Storage (no Docusign auth header).
 * 3. POST /v1/accounts/{accountId}/upload/jobs/{jobId}/actions/complete
 *                                                          — tell Docusign
 *    all files were uploaded so ingestion/AI extraction can start.
 * 4. GET  /v1/accounts/{accountId}/upload/jobs/{jobId}      — poll job status
 *    (OPEN / IN_PROGRESS / COMPLETE / FAILED).
 *
 * Note: an earlier version of this client mistakenly switched to
 * `/jobs/bulk` after misreading a 500 error's echoed `"path"` field (which
 * was just the server's internal route, not the public API path). The
 * correct public path is `/upload/jobs`, confirmed against Docusign's
 * Bulk Upload reference docs.
 */

interface CreateJobResponse {
  id: string
  name?: string
  status: string
  _embedded: {
    documents: Array<{
      id: string
      sequence: number
      _actions: {
        upload_document: string
      }
    }>
  }
}

interface JobStatusResponse {
  id: string
  name?: string
  status: "OPEN" | "UPLOAD_COMPLETE" | "IN_PROGRESS" | "COMPLETE" | "FAILED" | "CANCELED" | string
  _embedded?: {
    documents: Array<{ id: string; sequence: number; status?: string }>
  }
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
    const correlationId = response.headers.get("x-ds-correlation-id")
    throw new Error(
      `Agreement Manager API request failed (${response.status}) for ${path}` +
        (correlationId ? ` [x-ds-correlation-id: ${correlationId}]` : "") +
        `: ${body}`
    )
  }

  return response
}

export async function createBulkUploadJob(jobName?: string) {
  const config = getDocusignConfig()

  // IMPORTANT: do NOT wrap the payload in a "body" key. Docusign's official
  // reference shows `--data-raw '{ "body": {} }'`, but that example is wrong
  // and causes a 500 Internal Server Error (the response echoes a path of
  // `/jobs/bulk`). The fields must be placed at the top level instead.
  // `expected_number_of_docs` is required; the filename itself is supplied
  // later via the x-ms-meta-filename header on the presigned blob PUT.
  const response = await docusignFetch(
    `/v1/accounts/${config.accountId}/upload/jobs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expected_number_of_docs: 1,
        ...(jobName ? { job_name: jobName } : {}),
        language: "en-US",
      }),
    }
  )

  return (await response.json()) as CreateJobResponse
}

export interface LinkedDataItem {
  application_name: string
  object_name: string
  record_id: string
}

export async function uploadDocumentToBlobStorage(
  uploadUrl: string,
  filename: string,
  fileBuffer: Buffer,
  contentType: string,
  linkedData?: LinkedDataItem[]
) {
  // HTTP header values must be ISO-8859-1; percent-encode the filename so
  // non-ASCII names (e.g. Japanese) don't throw a ByteString conversion error.
  const headers: Record<string, string> = {
    "x-ms-blob-type": "BlockBlob",
    "x-ms-meta-filename": encodeURIComponent(filename),
    "Content-Type": contentType,
  }

  // To link the uploaded document to external records (e.g. a Salesforce
  // Account/Opportunity) so it shows up against that record, the ingestion
  // metadata must be supplied AT UPLOAD TIME via the x-ms-meta-metadata
  // header — a single stringified JSON object holding `linked_data` (same
  // schema as an Agreement PATCH body). This is the ingest-time entry point;
  // a post-upload PATCH does not persist linked_data. The JSON stays ASCII
  // (Salesforce IDs / object names), so it is already ISO-8859-1 safe and is
  // sent verbatim, matching the documented header format.
  if (linkedData && linkedData.length > 0) {
    headers["x-ms-meta-metadata"] = JSON.stringify({ linked_data: linkedData })
  }

  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers,
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

interface AgreementListItem {
  id: string
  title?: string
  type?: string
  status?: string
  file_name?: string
  source_name?: string
  source_id?: string
  metadata?: {
    created_at?: string
  }
}

interface AgreementsListResponse {
  data?: AgreementListItem[]
  response_metadata?: {
    page?: {
      next_token?: string
    }
  }
}

// GET /v1/accounts/{accountId}/agreements (Agreement Manager "Agreements" API)
export async function listRecentAgreements(limit: number) {
  const config = getDocusignConfig()

  const params = new URLSearchParams({
    limit: String(limit),
    sort: "metadata.created_at",
    direction: "desc",
  })

  const response = await docusignFetch(
    `/v1/accounts/${config.accountId}/agreements?${params.toString()}`,
    { method: "GET" }
  )

  return (await response.json()) as AgreementsListResponse
}

// GET /v1/accounts/{accountId}/agreements/{agreementId}
// Returns the full raw agreement JSON so linked_data etc. can be inspected.
export async function getAgreement(agreementId: string) {
  const config = getDocusignConfig()

  // include_linked_data=true expands the linked_data array (Salesforce
  // record references) into the response; without it they are omitted.
  const response = await docusignFetch(
    `/v1/accounts/${config.accountId}/agreements/${agreementId}?include_linked_data=true`,
    { method: "GET" }
  )

  return (await response.json()) as Record<string, unknown>
}

