import { describe, expect, it } from "vitest";
import { sha256Hex, signRequest } from "./sigv4.ts";

describe("sha256Hex", () => {
  it("空文字のハッシュを計算する", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("signRequest", () => {
  // AWS公式ドキュメントの署名例 (IAM ListUsers, AKIDEXAMPLE)
  // https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html
  it("AWS公式のテストベクトルと一致する署名を作る", async () => {
    const headers = await signRequest({
      method: "GET",
      url: new URL("https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08"),
      headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      service: "iam",
      date: new Date(Date.UTC(2015, 7, 30, 12, 36, 0)),
    });

    expect(headers["x-amz-date"]).toBe("20150830T123600Z");
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, " +
        "SignedHeaders=content-type;host;x-amz-date, " +
        "Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
    );
  });

  it("hostヘッダーは署名に使うがfetch用ヘッダーには含めない", async () => {
    const headers = await signRequest({
      method: "GET",
      url: new URL("https://example.r2.cloudflarestorage.com/bucket/key.json"),
      headers: {},
      payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "auto",
      service: "s3",
      date: new Date(Date.UTC(2026, 0, 1)),
    });

    expect(headers.host).toBeUndefined();
    expect(headers.authorization).toContain("SignedHeaders=host;x-amz-date");
  });
});
