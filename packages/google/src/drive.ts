import { google, type drive_v3 } from "googleapis";
import type { GoogleOAuth2Client } from "./oauth.js";

export type DriveAuth = GoogleOAuth2Client;

export const QMS_FOLDER_CODES = ["DRW", "PRO", "WI", "FRM", "CO"] as const;
export type QmsFolderCode = (typeof QMS_FOLDER_CODES)[number];

export type ProvisionedCompanyDrive = {
  rootFolderId: string;
  folders: Record<QmsFolderCode, string>;
};

const FOLDER_MIME = "application/vnd.google-apps.folder";
const DOC_MIME = "application/vnd.google-apps.document";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const PDF_MIME = "application/pdf";

function driveClient(auth: DriveAuth): drive_v3.Drive {
  // googleapis nests a second google-auth-library; InstanceType from google.auth.OAuth2
  // is runtime-compatible but not structurally assignable across the duplicate packages.
  return google.drive({ version: "v3", auth: auth as never });
}

async function createFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId?: string,
): Promise<string> {
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: "id",
    supportsAllDrives: true,
  });

  const id = res.data.id;
  if (!id) {
    throw new Error(`Failed to create Drive folder "${name}"`);
  }
  return id;
}

/**
 * Create the company QMS Drive tree:
 *   DataSheets QMS – {companyName}/
 *     DRW, PRO, WI, FRM, CO
 */
export async function provisionCompanyDrive(
  auth: DriveAuth,
  companyName: string,
): Promise<ProvisionedCompanyDrive> {
  const drive = driveClient(auth);
  const rootName = `DataSheets QMS – ${companyName}`;
  const rootFolderId = await createFolder(drive, rootName);

  const folders = {} as Record<QmsFolderCode, string>;
  for (const code of QMS_FOLDER_CODES) {
    folders[code] = await createFolder(drive, code, rootFolderId);
  }

  return { rootFolderId, folders };
}

export type CreateFileInput = {
  parentFolderId: string;
  title: string;
};

export async function createGoogleDoc(
  auth: DriveAuth,
  input: CreateFileInput,
): Promise<{ fileId: string }> {
  const drive = driveClient(auth);
  const res = await drive.files.create({
    requestBody: {
      name: input.title,
      mimeType: DOC_MIME,
      parents: [input.parentFolderId],
    },
    fields: "id",
    supportsAllDrives: true,
  });

  const fileId = res.data.id;
  if (!fileId) {
    throw new Error(`Failed to create Google Doc "${input.title}"`);
  }
  return { fileId };
}

export async function createGoogleSheet(
  auth: DriveAuth,
  input: CreateFileInput,
): Promise<{ fileId: string }> {
  const drive = driveClient(auth);
  const res = await drive.files.create({
    requestBody: {
      name: input.title,
      mimeType: SHEET_MIME,
      parents: [input.parentFolderId],
    },
    fields: "id",
    supportsAllDrives: true,
  });

  const fileId = res.data.id;
  if (!fileId) {
    throw new Error(`Failed to create Google Sheet "${input.title}"`);
  }
  return { fileId };
}

export type CopyFileInput = {
  fileId: string;
  title: string;
  parentFolderId: string;
};

/** Copy a Drive file (e.g. FRM template) into a parent folder. */
export async function copyFile(
  auth: DriveAuth,
  input: CopyFileInput,
): Promise<{ fileId: string }> {
  const drive = driveClient(auth);
  const res = await drive.files.copy({
    fileId: input.fileId,
    requestBody: {
      name: input.title,
      parents: [input.parentFolderId],
    },
    fields: "id",
    supportsAllDrives: true,
  });

  const fileId = res.data.id;
  if (!fileId) {
    throw new Error(`Failed to copy Drive file ${input.fileId}`);
  }
  return { fileId };
}

/** Export a Google Docs/Sheets/Slides file as PDF via Drive files.export. */
export async function exportFileAsPdf(
  auth: DriveAuth,
  fileId: string,
): Promise<Buffer> {
  const drive = driveClient(auth);
  const res = await drive.files.export(
    {
      fileId,
      mimeType: PDF_MIME,
    },
    { responseType: "arraybuffer" },
  );

  const data = res.data;
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (typeof data === "string") {
    return Buffer.from(data, "binary");
  }

  throw new Error(`Unexpected PDF export response type for file ${fileId}`);
}

/** Embeddable preview URL (iframe-friendly). */
export function getEmbedUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

/** Open-in-browser URL. */
export function getOpenUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}
