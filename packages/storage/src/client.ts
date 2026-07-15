import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as s3GetSignedUrl } from "@aws-sdk/s3-request-presigner";
import { sha256 } from "./hash.js";
import { buildStorageKey } from "./keys.js";

export type StoredFile = {
  storageKey: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
};

export type StorageConfig = {
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
};

export type PutObjectInput = {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
};

export type GetObjectResult = {
  body: Buffer;
  contentType?: string;
  contentLength?: number;
};

export type StorageClient = {
  putObject(input: PutObjectInput): Promise<StoredFile>;
  getObject(key: string): Promise<GetObjectResult>;
  deleteObject(key: string): Promise<void>;
  getSignedUrl(key: string, expiresSec?: number): Promise<string>;
  buildKey(companyId: string, fileName: string, at?: Date): string;
  readonly bucket: string;
};

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function resolveConfig(config: StorageConfig = {}): Required<StorageConfig> {
  return {
    endpoint: config.endpoint ?? process.env.S3_ENDPOINT ?? "http://localhost:9000",
    region: config.region ?? process.env.S3_REGION ?? "us-east-1",
    bucket: config.bucket ?? process.env.S3_BUCKET ?? "datasheets",
    accessKeyId:
      config.accessKeyId ?? process.env.S3_ACCESS_KEY_ID ?? "minio",
    secretAccessKey:
      config.secretAccessKey ?? process.env.S3_SECRET_ACCESS_KEY ?? "minio12345",
    forcePathStyle:
      config.forcePathStyle ??
      envBool(process.env.S3_FORCE_PATH_STYLE, true),
  };
}

async function streamToBuffer(
  body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | Blob | undefined,
): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (body instanceof Blob) {
    return Buffer.from(await body.arrayBuffer());
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function createStorage(config?: StorageConfig): StorageClient {
  const resolved = resolveConfig(config);
  const client = new S3Client({
    endpoint: resolved.endpoint,
    region: resolved.region,
    forcePathStyle: resolved.forcePathStyle,
    credentials: {
      accessKeyId: resolved.accessKeyId,
      secretAccessKey: resolved.secretAccessKey,
    },
  });

  return {
    bucket: resolved.bucket,

    buildKey(companyId, fileName, at) {
      return buildStorageKey(companyId, fileName, at);
    },

    async putObject({ key, body, contentType }) {
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
      await client.send(
        new PutObjectCommand({
          Bucket: resolved.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          ContentLength: bytes.byteLength,
        }),
      );
      return {
        storageKey: key,
        sha256: sha256(bytes),
        sizeBytes: bytes.byteLength,
        mimeType: contentType,
      };
    },

    async getObject(key) {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: resolved.bucket,
          Key: key,
        }),
      );
      const buffer = await streamToBuffer(result.Body as AsyncIterable<Uint8Array>);
      return {
        body: buffer,
        contentType: result.ContentType,
        contentLength: result.ContentLength,
      };
    },

    async deleteObject(key) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: resolved.bucket,
          Key: key,
        }),
      );
    },

    async getSignedUrl(key, expiresSec = 3600) {
      const command = new GetObjectCommand({
        Bucket: resolved.bucket,
        Key: key,
      });
      return s3GetSignedUrl(client, command, { expiresIn: expiresSec });
    },
  };
}
