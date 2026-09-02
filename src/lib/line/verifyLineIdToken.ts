import { createRemoteJWKSet, jwtVerify } from "jose";
import { validateLineIdTokenClaims } from "./validateIdTokenClaims";

const LINE_JWKS_URL = "https://api.line.me/oauth2/v2.1/certs";
const LINE_ISSUER = "https://access.line.me";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(LINE_JWKS_URL));
  }
  return jwks;
}

export async function verifyLineIdToken(
  idToken: string,
  channelId: string
): Promise<{ lineUserId: string }> {
  const { payload } = await jwtVerify(idToken, getJwks(), {
    issuer: LINE_ISSUER,
    audience: channelId,
  });

  if (
    typeof payload.sub !== "string" ||
    typeof payload.exp !== "number" ||
    typeof payload.aud !== "string"
  ) {
    throw new Error("invalid token payload");
  }

  return validateLineIdTokenClaims(
    { sub: payload.sub, aud: payload.aud, iss: LINE_ISSUER, exp: payload.exp },
    { channelId, nowSeconds: Math.floor(Date.now() / 1000) }
  );
}
