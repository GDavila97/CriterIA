import { render, renderHook, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { runSession } from '@/entities/corrida';
import type { RunCreatedBody } from '@/shared/api';
import { fullRun } from '@/shared/lib/testing';

import { UnsavedRunDialog } from '../ui/UnsavedRunDialog';
import { useLeaveWarning, useLossGuard } from './useLossGuard';

function finish(history: boolean) {
  runSession.start({ run_id: 'run-1', guardar_historial: history } as RunCreatedBody, 'Req');
  for (const evento of fullRun()) runSession.apply({ type: 'evento', evento });
}

function Harness({ action }: { action: () => void }) {
  const guard = useLossGuard();
  return (
    <>
      <button type="button" onClick={() => guard.guard(action)}>
        Nuevo análisis
      </button>
      <UnsavedRunDialog guard={guard} />
    </>
  );
}

const unload = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('losing an analysis', () => {
  beforeEach(() => runSession.clear());

  it('starts at once when there is nothing to lose or the result is in the history', async () => {
    const action = vi.fn();
    render(<Harness action={action} />);

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo análisis' }));
    finish(true);
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo análisis' }));

    expect(action).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('asks before replacing a result without history, and cancels or continues', async () => {
    finish(false);
    const action = vi.fn();
    render(<Harness action={action} />);

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo análisis' }));
    const dialog = screen.getByRole('alertdialog', { name: '¿Descartar el análisis?' });
    expect(dialog).toHaveAccessibleDescription(
      'Este análisis no está guardado en tu historial. Si continúas, se perderá. Puedes descargarlo antes.',
    );
    // Cancelar on the left, then Descargar and the destructive action, as in the design.
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Cancelar', 'Descargar', 'Descartar y continuar']);
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(action).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo análisis' }));
    await userEvent.click(screen.getByRole('button', { name: 'Descartar y continuar' }));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('downloads the analysis as Markdown from the dialog without leaving it', async () => {
    finish(false);
    const createObjectURL = vi.fn(() => 'blob:analisis');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<Harness action={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Nuevo análisis' }));
    await userEvent.click(screen.getByRole('button', { name: 'Descargar' }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toMatch(/\.md$/);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('warns on closing the tab only while something would be lost', () => {
    const { unmount } = renderHook(() => useLeaveWarning());

    expect(unload()).toBe(false);
    runSession.start({ run_id: 'run-1', guardar_historial: true } as RunCreatedBody, 'Req');
    expect(unload()).toBe(true);
    finish(true);
    expect(unload()).toBe(false);
    finish(false);
    expect(unload()).toBe(true);

    unmount();
    expect(unload()).toBe(false);
  });
});
