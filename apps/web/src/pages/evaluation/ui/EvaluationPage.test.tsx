import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
}));
vi.mock('@/shared/lib/auth/client', () => ({ authClient: {} }));

import { EvaluationPage } from './EvaluationPage';

describe('EvaluationPage', () => {
  it('evaluation loads the public results, its empty state and errors', async () => {
    const { unmount } = render(
      <EvaluationPage user={null} client={{ evaluation: vi.fn(async () => ({ lotes: [] })) }} />,
    );
    expect(
      await screen.findByText('Los resultados se publicarán tras la primera evaluación.'),
    ).toBeInTheDocument();
    unmount();

    render(
      <EvaluationPage
        user={null}
        client={{ evaluation: vi.fn().mockRejectedValue(new Error('x')) }}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudieron cargar los resultados',
    );
  });
});
