import { getAuth } from './server';
import { getSessionUser } from './session';

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers({ cookie: 'x' })) }));
vi.mock('./server', () => ({ getAuth: vi.fn() }));

describe('getSessionUser', () => {
  it('returns the person with their sign-in methods, or null', async () => {
    const getSession = vi
      .fn()
      .mockResolvedValueOnce({
        user: { id: 'u1', name: 'Ana', email: 'a@b.c', emailVerified: true, image: null },
      })
      .mockResolvedValueOnce(null);
    const listUserAccounts = vi.fn(async () => [
      { providerId: 'github' },
      { providerId: 'credential' },
    ]);
    vi.mocked(getAuth).mockReturnValue({ api: { getSession, listUserAccounts } } as never);

    expect(await getSessionUser()).toEqual({
      id: 'u1',
      name: 'Ana',
      email: 'a@b.c',
      emailVerified: true,
      providers: ['github', 'credential'],
    });
    expect(await getSessionUser()).toBeNull();
  });
});
