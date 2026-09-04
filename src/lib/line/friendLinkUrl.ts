const FRIEND_LINK_BASE_PATH = "/liff/friend-link";

/**
 * LINE友だち連携の招待トークンから、実際に存在するLIFFページのパスを組み立てる。
 * 過去に signup/provision と tenant-members/friend-invites で別々にURL文字列を
 * 組み立てていたため、存在しない /line-friend-invite/[token] を指す不整合が起きていた。
 */
export function buildFriendLinkPath(inviteToken: string): string {
  return `${FRIEND_LINK_BASE_PATH}/${inviteToken}`;
}
