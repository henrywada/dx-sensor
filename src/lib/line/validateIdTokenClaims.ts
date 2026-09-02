export type LineIdTokenClaims = {
  sub: string;
  aud: string;
  iss: string;
  exp: number;
};

const LINE_ISSUER = "https://access.line.me";

export function validateLineIdTokenClaims(
  claims: LineIdTokenClaims,
  params: { channelId: string; nowSeconds: number }
): { lineUserId: string } {
  if (claims.iss !== LINE_ISSUER) {
    throw new Error("invalid issuer");
  }
  if (claims.aud !== params.channelId) {
    throw new Error("invalid audience");
  }
  if (claims.exp <= params.nowSeconds) {
    throw new Error("token expired");
  }
  if (!claims.sub) {
    throw new Error("missing subject");
  }

  return { lineUserId: claims.sub };
}
