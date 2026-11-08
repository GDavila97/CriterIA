import { createTransport } from 'nodemailer';

import { createEmailSender, EmailError, resendSender } from './sender';
import { resetPasswordEmail, verificationEmail } from './templates';

vi.mock('nodemailer', () => ({ createTransport: vi.fn() }));

describe('createEmailSender', () => {
  it('sends nothing with EMAIL_PROVIDER=none', () => {
    expect(createEmailSender({ provider: 'none' })).toBeNull();
  });

  it('delivers through SMTP with the configured sender', async () => {
    const sendMail = vi.fn(async () => ({}));
    vi.mocked(createTransport).mockReturnValue({ sendMail } as never);
    const sender = createEmailSender({
      provider: 'smtp',
      smtpUrl: 'smtp://127.0.0.1:1025',
      from: 'CriterIA <no-reply@criteria.test>',
    });

    await sender?.send(verificationEmail('ana@example.test', 'http://localhost:3000/v?t=1'));

    expect(createTransport).toHaveBeenCalledWith('smtp://127.0.0.1:1025');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'CriterIA <no-reply@criteria.test>',
        to: 'ana@example.test',
        subject: 'Verifica tu correo en CriterIA',
      }),
    );
  });

  it('posts to Resend and hides its answer behind the status', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"to":"ana@example.test"}', { status: 422 }));
    const sender = resendSender('re_key', 'CriterIA <a@b.c>', fetchImpl);

    await sender.send(resetPasswordEmail('ana@example.test', 'http://x/r'));
    const failure = sender.send(resetPasswordEmail('ana@example.test', 'http://x/r'));

    await expect(failure).rejects.toEqual(new EmailError('Resend answered 422'));
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: { authorization: 'Bearer re_key', 'content-type': 'application/json' },
      }),
    );
    expect(
      createEmailSender({ provider: 'resend', resendApiKey: 'k', from: 'a@b.c' }),
    ).not.toBeNull();
  });
});

describe('templates', () => {
  it('escape the link in the HTML body', () => {
    const email = verificationEmail('a@b.c', 'http://x/?a=1&b="2"<script>');

    expect(email.html).toContain('&#38;b=&#34;2&#34;&#60;script&#62;');
    expect(email.html).not.toContain('<script>');
    expect(email.text).toContain('http://x/?a=1&b="2"<script>');
  });
});
