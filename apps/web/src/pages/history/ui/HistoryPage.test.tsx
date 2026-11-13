import { render, screen } from '@testing-library/react';

import type { HistoryItemBody } from '@/shared/api';
import { puntajes } from '@/shared/lib/testing';

import { HistoryPage } from './HistoryPage';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/historial',
}));
vi.mock('@/shared/lib/auth/client', () => ({ authClient: {} }));

const user = { name: 'Ana', email: 'ana@example.test' };
const scores = puntajes() as unknown as HistoryItemBody['scores'];

describe('HistoryPage', () => {
  it('lists saved runs with their score and links to each one', async () => {
    const client = {
      history: vi.fn(async () => [
        {
          id: 'r1',
          status: 'completada',
          provider: 'groq',
          model: 'openai/gpt-oss-20b',
          model_display_name: 'GPT-OSS 20B',
          created_at: '2026-11-07T12:00:00Z',
          scores,
        },
        {
          id: 'r2',
          status: 'error',
          provider: 'openai',
          model: 'gpt-6-luna',
          model_display_name: 'GPT-6 Luna',
          created_at: '2026-11-06T12:00:00Z',
          scores: [],
        },
      ]),
    };
    render(<HistoryPage user={user} client={client} />);

    expect(
      await screen.findByRole('link', { name: /Groq · GPT-OSS 20B · Terminada/ }),
    ).toHaveAttribute('href', '/historial/r1');
    expect(screen.getByText('4.0/5')).toBeInTheDocument();
    expect(screen.getByText(/Con error/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Borrar mi historial' })).toBeInTheDocument();
  });

  it('explains an empty history and loading errors', async () => {
    const { unmount } = render(
      <HistoryPage user={user} client={{ history: vi.fn(async () => []) }} />,
    );
    expect(await screen.findByText('Aún no tienes análisis guardados.')).toBeInTheDocument();
    unmount();

    render(
      <HistoryPage user={user} client={{ history: vi.fn().mockRejectedValue(new Error('x')) }} />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar tu historial.');
  });
});
