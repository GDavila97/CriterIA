import { isPrivatePath } from './routes';

describe('isPrivatePath', () => {
  it('covers the run, history and settings pages, not public ones', () => {
    expect(['/analisis', '/historial/abc', '/ajustes/modelos'].every(isPrivatePath)).toBe(true);
    expect(
      ['/', '/evaluacion', '/privacidad', '/analisis-falsos', '/api/auth/token'].some(
        isPrivatePath,
      ),
    ).toBe(false);
  });
});
