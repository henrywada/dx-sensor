import { randomBytes } from "node:crypto";

const INVITE_TTL_HOURS = 72;

export function generateInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function inviteExpiryDate(fromDate: Date = new Date()): Date {
  return new Date(fromDate.getTime() + INVITE_TTL_HOURS * 60 * 60 * 1000);
}
