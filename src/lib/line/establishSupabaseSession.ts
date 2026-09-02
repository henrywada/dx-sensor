type GenerateLinkClient = {
  auth: {
    admin: {
      generateLink: (params: { type: "magiclink"; email: string }) => Promise<{
        data: { properties?: { hashed_token?: string } | null } | null;
        error: { message: string } | null;
      }>;
    };
  };
};

type VerifyOtpClient = {
  auth: {
    verifyOtp: (params: {
      type: "magiclink";
      token_hash: string;
      email: string;
    }) => Promise<{ error: { message: string } | null }>;
  };
};

export async function establishSupabaseSession(params: {
  adminClient: GenerateLinkClient;
  sessionClient: VerifyOtpClient;
  email: string;
}): Promise<void> {
  const { adminClient, sessionClient, email } = params;

  const { data, error } = await adminClient.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  const hashedToken = data?.properties?.hashed_token;
  if (error || !hashedToken) {
    throw new Error("failed to generate session link");
  }

  const { error: verifyError } = await sessionClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: hashedToken,
    email,
  });

  if (verifyError) {
    throw new Error("failed to verify session link");
  }
}
