import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { Drawer } from '../drawer/Drawer';
import { Dialog } from './Dialog';
import { lockScroll } from './useModal';

function DrawerHarness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    onClose();
    setOpen(false);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Ver agente
      </button>
      <Drawer open={open} title="Agente" onClose={close}>
        <button type="button">Dentro</button>
      </Drawer>
    </>
  );
}

const dialogOf = () => document.querySelector('dialog') as HTMLDialogElement;

describe('modal drawer', () => {
  afterEach(() => {
    document.documentElement.style.overflow = '';
  });

  it('closes with the X, gives the focus back and lets the page scroll again', async () => {
    render(<DrawerHarness />);
    const opener = screen.getByRole('button', { name: 'Ver agente' });

    await userEvent.click(opener);
    expect(dialogOf().open).toBe(true);
    expect(document.documentElement.style.overflow).toBe('hidden');

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(dialogOf().open).toBe(false);
    expect(document.documentElement.style.overflow).toBe('');
    expect(opener).toHaveFocus();
  });

  it('closes with Escape', async () => {
    const onClose = vi.fn();
    render(<DrawerHarness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver agente' }));

    fireEvent(dialogOf(), new Event('cancel', { cancelable: true }));

    expect(onClose).toHaveBeenCalled();
    expect(dialogOf().open).toBe(false);
  });

  it('closes on a click on the backdrop but not inside the panel', async () => {
    const onClose = vi.fn();
    render(<DrawerHarness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver agente' }));
    const dialog = dialogOf();
    dialog.getBoundingClientRect = () =>
      DOMRect.fromRect({ x: 600, y: 0, width: 400, height: 800 });

    fireEvent.click(screen.getByRole('button', { name: 'Dentro' }), { clientX: 700, clientY: 100 });
    fireEvent.click(dialog, { clientX: 700, clientY: 100 });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(dialog, { clientX: 100, clientY: 100 });
    expect(onClose).toHaveBeenCalled();
    expect(dialog.open).toBe(false);
  });
});

describe('Dialog', () => {
  it('is an alert dialog named by its title and described by its text', () => {
    render(
      <Dialog
        open
        title="¿Continuar?"
        description="Se perderá."
        onClose={() => {}}
        actions={<button type="button">Cancelar</button>}
      />,
    );

    const dialog = screen.getByRole('alertdialog', { name: '¿Continuar?' });
    expect(dialog).toHaveAccessibleDescription('Se perderá.');
  });
});

describe('lockScroll', () => {
  it('keeps the page still until the last of nested modals closes', () => {
    const outer = lockScroll();
    const inner = lockScroll();
    inner();
    inner();
    expect(document.documentElement.style.overflow).toBe('hidden');
    outer();
    expect(document.documentElement.style.overflow).toBe('');
  });
});
