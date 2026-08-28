export const BUCKET = "captured-documents";

export function tmpObjectPath(
  tenantId: string,
  userId: string,
  fileId: string
): string {
  return `${tenantId}/tmp/${userId}/${fileId}.jpg`;
}

export function finalObjectPath(
  tenantId: string,
  documentType: string,
  dateYmd: string,
  documentId: string,
  fileId: string
): string {
  return `${tenantId}/${documentType}/${dateYmd}/${documentId}/${fileId}.jpg`;
}

export function isTmpPath(
  path: string,
  tenantId: string,
  userId: string
): boolean {
  const prefix = `${tenantId}/tmp/${userId}/`;
  if (!path.startsWith(prefix)) {
    return false;
  }

  const remainder = path.slice(prefix.length);
  return remainder.length > 0 && !remainder.includes("/") && remainder.endsWith(".jpg");
}
