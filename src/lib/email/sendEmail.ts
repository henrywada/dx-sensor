export type EmailClient = {
  emails: {
    send: (params: {
      from: string;
      to: string | string[];
      subject: string;
      html: string;
    }) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
};

export async function sendEmail(params: {
  client: EmailClient;
  from: string;
  to: string | string[];
  subject: string;
  html: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { client, from, to, subject, html } = params;

  const { error } = await client.emails.send({ from, to, subject, html });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
