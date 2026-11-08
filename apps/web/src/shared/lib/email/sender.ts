import { createTransport } from 'nodemailer';

import type { EmailProvider } from '@/shared/config/server-env.schema';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export interface EmailConfig {
  provider: EmailProvider;
  from?: string | undefined;
  smtpUrl?: string | undefined;
  resendApiKey?: string | undefined;
}

export class EmailError extends Error {
  override name = 'EmailError';
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function smtpSender(smtpUrl: string, from: string): EmailSender {
  const transport = createTransport(smtpUrl);
  return {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
}

export function resendSender(
  apiKey: string,
  from: string,
  fetchImpl: FetchLike = fetch,
): EmailSender {
  return {
    async send(message) {
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, ...message }),
      });
      // The provider's body may echo the address; only the status leaves this function.
      if (!response.ok) throw new EmailError(`Resend answered ${response.status}`);
    },
  };
}

/** Null with EMAIL_PROVIDER=none: verification and password recovery stay off. */
export function createEmailSender(config: EmailConfig): EmailSender | null {
  const from = config.from ?? '';
  switch (config.provider) {
    case 'none':
      return null;
    case 'smtp':
      return smtpSender(config.smtpUrl ?? '', from);
    case 'resend':
      return resendSender(config.resendApiKey ?? '', from);
  }
}
