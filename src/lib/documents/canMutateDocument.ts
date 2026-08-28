export type DocumentActorRole = "owner" | "admin" | "viewer" | "developer";

export function canMutateDocument({
  actorUserId,
  actorRole,
  isDeveloper,
  ownerUserId,
  companyVisible,
}: {
  actorUserId: string;
  actorRole: DocumentActorRole;
  isDeveloper: boolean;
  ownerUserId: string;
  companyVisible: boolean;
}): boolean {
  if (isDeveloper) return true;
  if (actorUserId === ownerUserId) return true;
  if (companyVisible && (actorRole === "owner" || actorRole === "admin")) {
    return true;
  }
  return false;
}
