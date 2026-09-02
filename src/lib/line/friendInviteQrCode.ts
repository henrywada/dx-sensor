import QRCode from "qrcode";

export function buildFriendInviteLiffUrl(liffId: string, token: string): string {
  return `https://liff.line.me/${liffId}/friend-link/${encodeURIComponent(token)}`;
}

export async function generateFriendInviteQrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, { margin: 1, width: 320 });
}
