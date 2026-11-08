import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Paged } from './Paged';

const items = (n: number) => Array.from({ length: n }, (_, i) => `Elemento ${i + 1}`);

function List({ values }: { values: string[] }) {
  return (
    <Paged items={values} label="Páginas de elementos">
      {(page) => (
        <ul>
          {page.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      )}
    </Paged>
  );
}

const visiblePage = () =>
  screen.getAllByRole('list').find((list) => !list.closest('[inert]')) as HTMLElement;

describe('Paged', () => {
  it('renders a short list as is, without navigation', () => {
    render(<List values={items(10)} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('shows ten per page and moves with previous and next', async () => {
    render(<List values={items(23)} />);

    const nav = screen.getByRole('navigation', { name: 'Páginas de elementos' });
    const previous = within(nav).getByRole('button', { name: 'Anterior' });
    const next = within(nav).getByRole('button', { name: 'Siguiente' });
    expect(within(nav).getByText('Página 1 de 3')).toBeInTheDocument();
    expect(within(visiblePage()).getAllByRole('listitem')).toHaveLength(10);
    expect(previous).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(next);
    expect(within(nav).getByText('Página 2 de 3')).toBeInTheDocument();
    expect(within(visiblePage()).getByText('Elemento 11')).toBeInTheDocument();

    await userEvent.click(next);
    expect(within(visiblePage()).getAllByRole('listitem')).toHaveLength(3);
    expect(next).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(next);
    expect(within(nav).getByText('Página 3 de 3')).toBeInTheDocument();
    expect(next).toHaveFocus();

    await userEvent.click(previous);
    expect(within(nav).getByText('Página 2 de 3')).toBeInTheDocument();
  });

  it('keeps every page in place so the card does not change height, hiding the others', () => {
    const { container } = render(<List values={items(15)} />);

    const pages = container.querySelectorAll('[data-page]');
    expect(pages).toHaveLength(2);
    expect(pages[0]).not.toHaveAttribute('inert');
    expect(pages[1]).toHaveAttribute('inert');
  });

  it('stays on a page that still exists when the list shrinks', async () => {
    const { rerender } = render(<List values={items(25)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    rerender(<List values={items(15)} />);

    expect(screen.getByText('Página 2 de 2')).toBeInTheDocument();
  });
});
