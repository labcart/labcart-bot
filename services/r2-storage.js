/**
 * Cloudflare R2 Storage Service
 * S3-compatible object storage for workflow assets
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://assets.labcart.io';

/**
 * Get the public URL for an R2 object
 * @param {string} key - Object key
 * @returns {string}
 */
export function getPublicUrl(key) {
  return `${PUBLIC_URL}/${key}`;
}

/**
 * Upload a file to R2
 * @param {Buffer|string} content - File content
 * @param {string} key - Object key (path in bucket)
 * @param {string} contentType - MIME type
 * @returns {Promise<{key: string, url: string}>}
 */
export async function uploadFile(content, key, contentType = 'application/octet-stream') {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: content,
    ContentType: contentType,
  });

  await s3Client.send(command);

  return {
    key,
    url: `${process.env.R2_ENDPOINT}/${BUCKET}/${key}`,
  };
}

/**
 * Upload a workflow asset (auto-generates key)
 * @param {Buffer|string} content - File content
 * @param {string} workflowId - Workflow ID (can be a path like "users/123/workflows/abc")
 * @param {string} filename - Original filename
 * @param {string} contentType - MIME type
 * @returns {Promise<{key: string, publicUrl: string}>}
 */
export async function uploadWorkflowAsset(content, workflowId, filename, contentType) {
  const ext = filename.split('.').pop() || '';
  // workflowId can be a full path like "users/123/workflows/abc" or just "workflow-123"
  const key = workflowId.includes('/')
    ? `${workflowId}/${randomUUID()}.${ext}`
    : `workflows/${workflowId}/${randomUUID()}.${ext}`;

  await uploadFile(content, key, contentType);

  return {
    key,
    publicUrl: getPublicUrl(key),
  };
}

/**
 * Get a signed URL for downloading a file
 * @param {string} key - Object key
 * @param {number} expiresIn - URL expiration in seconds (default 1 hour)
 * @returns {Promise<string>}
 */
export async function getSignedDownloadUrl(key, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Get a signed URL for uploading a file
 * @param {string} key - Object key
 * @param {string} contentType - MIME type
 * @param {number} expiresIn - URL expiration in seconds (default 1 hour)
 * @returns {Promise<string>}
 */
export async function getSignedUploadUrl(key, contentType, expiresIn = 3600) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Delete a file from R2
 * @param {string} key - Object key
 */
export async function deleteFile(key) {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  await s3Client.send(command);
}

/**
 * Download a file from R2
 * @param {string} key - Object key
 * @returns {Promise<Buffer>}
 */
export async function downloadFile(key) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  const response = await s3Client.send(command);
  const chunks = [];

  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

export default {
  uploadFile,
  uploadWorkflowAsset,
  getPublicUrl,
  getSignedDownloadUrl,
  getSignedUploadUrl,
  deleteFile,
  downloadFile,
};
