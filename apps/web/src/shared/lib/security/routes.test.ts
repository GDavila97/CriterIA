import { isPrivatePath } from './routes';

describe('isPrivatePath', () => {
  it('covers the run, history and settings pages, not public ones', () => {
    expect(['/corrida', '/historial/abc', '/ajustes/modelos'].every(isPrivatePath)).toBe(true);
    expect(
      ['/', '/evaluacion', '/privacidad', '/corridas-falsas', '/api/auth/token'].some(
        isPrivatePath,
      ),
    ).toBe(false);
  });
});
