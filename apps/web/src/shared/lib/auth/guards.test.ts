import { redirect } from 'next/navigation';

import { optionalUser, requireUser } from './guards';
import { getSessionUser } from './session';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
}));
vi.mock('./session', () => ({ getSessionUser: vi.fn() }));

const ana = {
  id: 'u1',
  name: 'Ana',
  email: 'a@b.c',
  emailVerified: false,
  providers: ['credential'],
};

describe('guards', () => {
  it('send people without a session to the home page', async () => {
    vi.mocked(getSessionUser).mockResolvedValueOnce(null);

    await expect(requireUser()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/');
  });

  it('return the person when there is a session', async () => {
    vi.mocked(getSessionUser).mockResolvedValue(ana);

    expect(await requireUser()).toBe(ana);
    expect(await optionalUser()).toBe(ana);
  });
});
