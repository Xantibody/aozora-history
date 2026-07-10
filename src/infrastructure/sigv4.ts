// AWS Signature Version 4 (R2のS3互換APIで使用)
// https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html

const encoder = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return hex(new Uint8Array(digest));
}

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function canonicalPath(url: URL): string {
  const path = url.pathname
    .split("/")
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join("/");
  return path === "" ? "/" : path;
}

function canonicalQuery(url: URL): string {
  return [...url.searchParams]
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)])
    .toSorted((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    .map((pair) => pair.join("="))
    .join("&");
}

function toAmzDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

export interface SignRequestInput {
  method: string;
  url: URL;
  headers: Record<string, string>;
  /** ボディのSHA-256(16進)。ボディなしは空文字のハッシュ */
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  date: Date;
}

/**
 * 署名済みリクエストヘッダーを返す。
 * hostは署名の計算にのみ使い、fetchが自動で付与するため戻り値には含めない。
 */
export async function signRequest(input: SignRequestInput): Promise<Record<string, string>> {
  const amzDate = toAmzDate(input.date);
  const dateStamp = amzDate.slice(0, 8);

  const signedHeaderEntries = Object.entries({
    ...input.headers,
    host: input.url.host,
    "x-amz-date": amzDate,
  })
    .map(([k, v]) => [k.toLowerCase(), v.trim()] as const)
    .toSorted((a, b) => a[0].localeCompare(b[0]));

  const canonicalHeaders = signedHeaderEntries.map(([k, v]) => `${k}:${v}\n`).join("");
  const signedHeaders = signedHeaderEntries.map(([k]) => k).join(";");
  const canonicalRequest = [
    input.method,
    canonicalPath(input.url),
    canonicalQuery(input.url),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join(
    "\n",
  );

  let key = await hmac(encoder.encode(`AWS4${input.secretAccessKey}`), dateStamp);
  key = await hmac(key, input.region);
  key = await hmac(key, input.service);
  key = await hmac(key, "aws4_request");
  const signature = hex(new Uint8Array(await hmac(key, stringToSign)));

  return {
    ...input.headers,
    "x-amz-date": amzDate,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
