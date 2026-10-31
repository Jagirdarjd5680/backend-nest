import * as crypto from 'crypto';

/**
 * Minimal AWS Signature V4 for S3-compatible storage (Cloudflare R2, MinIO...).
 * Hand-rolled with node:crypto so this whole integration carries no npm dependency —
 * deleting src/r2/ removes it completely.
 *
 * Path-style addressing only: https://endpoint/<bucket>/<key>.
 */

export interface SigV4Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

const sha256Hex = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding as S3 expects it (encodeURIComponent leaves !'()* alone). */
export const rfc3986 = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** Encodes each path segment but keeps the slashes. */
export const encodeKeyPath = (key: string) => key.split('/').map(rfc3986).join('/');

const toAmzDate = (d: Date) => d.toISOString().replace(/[:-]|\.\d{3}/g, '');

function signingKey(secret: string, dateStamp: string, region: string) {
  const kDate = hmac('AWS4' + secret, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

function canonicalQuery(query: Record<string, string>) {
  return Object.keys(query)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(query[k])}`)
    .join('&');
}

/**
 * Signs a request with the Authorization header. Returns the headers to send
 * (caller's headers + host/x-amz-date/x-amz-content-sha256/authorization).
 */
export function signHeaders(opts: {
  creds: SigV4Credentials;
  method: string;
  url: URL; // pathname must already be encoded (encodeKeyPath)
  headers?: Record<string, string>;
  payloadHash?: string;
  now?: Date;
}): Record<string, string> {
  const { creds, method, url } = opts;
  const now = opts.now || new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = opts.payloadHash || UNSIGNED_PAYLOAD;

  const headers: Record<string, string> = {
    ...(opts.headers || {}),
    host: url.host,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = String(v).trim();
  const signedHeaders = Object.keys(lower).sort().join(';');
  const canonicalHeaders = Object.keys(lower).sort().map((k) => `${k}:${lower[k]}\n`).join('');

  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (query[k] = v));

  const canonicalRequest = [method, url.pathname, canonicalQuery(query), canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${creds.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(creds.secretAccessKey, dateStamp, creds.region)).update(stringToSign).digest('hex');

  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** Builds a presigned URL (GET unless `method` says otherwise) valid for `expiresSeconds` from `now`. */
export function presignUrl(opts: { creds: SigV4Credentials; url: URL; expiresSeconds: number; now?: Date; method?: string }): string {
  const { creds, url } = opts;
  const method = opts.method || 'GET';
  const amzDate = toAmzDate(opts.now || new Date());
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${creds.region}/s3/aws4_request`;

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${creds.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(Math.min(604800, Math.max(1, Math.floor(opts.expiresSeconds)))),
    'X-Amz-SignedHeaders': 'host',
  };
  const qs = canonicalQuery(query);
  const canonicalRequest = [method, url.pathname, qs, `host:${url.host}\n`, 'host', UNSIGNED_PAYLOAD].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(creds.secretAccessKey, dateStamp, creds.region)).update(stringToSign).digest('hex');

  return `${url.origin}${url.pathname}?${qs}&X-Amz-Signature=${signature}`;
}
