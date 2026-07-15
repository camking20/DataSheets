# @datasheets/storage

S3-compatible object storage client for DataSheets (MinIO in local/dev).

## Env vars

| Variable | Default |
|---|---|
| `S3_ENDPOINT` | `http://localhost:9000` |
| `S3_REGION` | `us-east-1` |
| `S3_BUCKET` | `datasheets` |
| `S3_ACCESS_KEY_ID` | `minio` |
| `S3_SECRET_ACCESS_KEY` | `minio12345` |
| `S3_FORCE_PATH_STYLE` | `true` |

## Run MinIO

From the repo root (with the MinIO service in `docker-compose.yml`):

```bash
docker compose up -d minio minio-init
```

- API: http://localhost:9000
- Console: http://localhost:9001 (login `minio` / `minio12345`)
- Bucket `datasheets` is created by the `minio-init` one-shot service

If compose does not yet include MinIO, see `docker-minio.snippet.yml`.

## Usage

```ts
import { createStorage, buildStorageKey } from "@datasheets/storage";

const storage = createStorage();
const key = buildStorageKey(companyId, "drawing.pdf");
const stored = await storage.putObject({
  key,
  body: buffer,
  contentType: "application/pdf",
});
// stored: { storageKey, sha256, sizeBytes, mimeType }
```

Object keys are tenant-safe: `{companyId}/{yyyy}/{mm}/{uuid}-{safeFileName}`.
