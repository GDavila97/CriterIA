import { withFirstForwardedIp } from './client-ip';

const request = (headers: Record<string, string>) =>
  new Request('https://criteria.example/api/auth/sign-in/email', {
    method: 'POST',
    headers,
    body: '{"email":"ana@example.com"}',
  });

describe('withFirstForwardedIp', () => {
  it('keeps the first address of the list and the rest of the request', async () => {
    const original = request({
      'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1, 10.0.0.2',
      'x-real-ip': '198.51.100.9',
    });

    const normalized = withFirstForwardedIp(original);

    expect(normalized.headers.get('x-forwarded-for')).toBe('203.0.113.7');
    expect(normalized.headers.get('x-real-ip')).toBe('198.51.100.9');
    expect(normalized.method).toBe('POST');
    expect(normalized.url).toBe(original.url);
    expect(await normalized.text()).toBe('{"email":"ana@example.com"}');
  });

  it('returns the same request when there is nothing to trim', () => {
    const single = request({ 'x-forwarded-for': '203.0.113.7' });
    const none = request({});

    expect(withFirstForwardedIp(single)).toBe(single);
    expect(withFirstForwardedIp(none)).toBe(none);
  });

  it('drops a header whose first entry is empty', () => {
    const normalized = withFirstForwardedIp(request({ 'x-forwarded-for': ', 10.0.0.1' }));

    expect(normalized.headers.has('x-forwarded-for')).toBe(false);
  });
});
