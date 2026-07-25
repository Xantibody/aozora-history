// AWS Signature Version 4 (R2のS3互換APIで使用)
// https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html

const encoder = new TextEncoder();

const HEX_RADIX = 16;
/** 1バイトを16進で表したときの文字数 */
const HEX_CHARS_PER_BYTE = 2;
/** amzDate先頭の日付部分(YYYYMMDD)の文字数 */
const DATE_STAMP_LENGTH = 8;

function hex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(HEX_RADIX).padStart(HEX_CHARS_PER_BYTE, "0"))
    .join("");
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
  return encodeURIComponent(value).replaceAll(/[!'()*]/gu, (char) => {
    const codePoint = char.codePointAt(0);
    return codePoint === undefined ? char : `%${codePoint.toString(HEX_RADIX).toUpperCase()}`;
  });
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
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)])
    .toSorted((left, right) =>
      left[0] === right[0] ? left[1].localeCompare(right[1]) : left[0].localeCompare(right[0]),
    )
    .map((pair) => pair.join("="))
    .join("&");
}

function toAmzDate(date: Date): string {
  return date
    .toISOString()
    .replaceAll(/[-:]/gu, "")
    .replace(/\.\d{3}/u, "");
}

function canonicalizeHeaders(
  headers: Record<string, string>,
  host: string,
  amzDate: string,
): { canonicalHeaders: string; signedHeaders: string } {
  const entries = Object.entries({ ...headers, host, "x-amz-date": amzDate })
    .map(([name, value]) => [name.toLowerCase(), value.trim()] as const)
    .toSorted((left, right) => left[0].localeCompare(right[0]));
  return {
    canonicalHeaders: entries.map(([name, value]) => `${name}:${value}\n`).join(""),
    signedHeaders: entries.map(([name]) => name).join(";"),
  };
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

async function deriveSigningKey(input: SignRequestInput, dateStamp: string): Promise<ArrayBuffer> {
  let signingKey = await hmac(encoder.encode(`AWS4${input.secretAccessKey}`), dateStamp);
  signingKey = await hmac(signingKey, input.region);
  signingKey = await hmac(signingKey, input.service);
  return hmac(signingKey, "aws4_request");
}

/**
 * 署名済みリクエストヘッダーを返す。
 * hostは署名の計算にのみ使い、fetchが自動で付与するため戻り値には含めない。
 */
export async function signRequest(input: SignRequestInput): Promise<Record<string, string>> {
  const amzDate = toAmzDate(input.date);
  const dateStamp = amzDate.slice(0, DATE_STAMP_LENGTH);

  const { canonicalHeaders, signedHeaders } = canonicalizeHeaders(
    input.headers,
    input.url.host,
    amzDate,
  );
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

  const signingKey = await deriveSigningKey(input, dateStamp);
  const signature = hex(new Uint8Array(await hmac(signingKey, stringToSign)));

  return {
    ...input.headers,
    "x-amz-date": amzDate,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
