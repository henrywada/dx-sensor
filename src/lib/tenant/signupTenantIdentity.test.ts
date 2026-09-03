import { describe, expect, it } from "vitest";
import { buildSignupTenantIdentity } from "./signupTenantIdentity";

const USER_ID_A = "11111111-1111-4111-8111-111111111111";
const USER_ID_B = "22222222-2222-4222-8222-222222222222";

describe("buildSignupTenantIdentity", () => {
  it("uses the email local part as the tenant name", () => {
    const { name } = buildSignupTenantIdentity("taro.yamada@example.com", USER_ID_A);
    expect(name).toBe("taro.yamada");
  });

  it("normalizes the local part into a lowercase hyphen slug", () => {
    const { slug } = buildSignupTenantIdentity("Taro.Yamada+test@example.com", USER_ID_A);
    expect(slug.startsWith("taro-yamada-test-")).toBe(true);
  });

  it("only contains url-safe lowercase characters and hyphens in the slug", () => {
    const { slug } = buildSignupTenantIdentity("Taro.Yamada+test@example.com", USER_ID_A);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("produces different slugs for different userIds with the same email local part", () => {
    const a = buildSignupTenantIdentity("taro@example.com", USER_ID_A);
    const b = buildSignupTenantIdentity("taro@example.com", USER_ID_B);
    expect(a.slug).not.toBe(b.slug);
  });

  it("uses the full de-hyphenated userId as the slug suffix", () => {
    const { slug } = buildSignupTenantIdentity("taro@example.com", USER_ID_A);
    expect(slug.endsWith(USER_ID_A.replace(/-/g, ""))).toBe(true);
  });
});
