import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { historia } from '@/shared/lib/testing';

import { answerFor } from '../model/draft';
import { ApprovalPanel } from './ApprovalPanel';

const stories = [historia(1), historia(2), historia(3)];

function setup(otrasVersiones = 0) {
  const onAnswer = vi.fn();
  render(
    <ApprovalPanel
      historias={stories}
      otrasVersiones={otrasVersiones}
      busy={false}
      onAnswer={onAnswer}
    />,
  );
  return onAnswer;
}

describe('ApprovalPanel', () => {
  it('approves without changes', async () => {
    const onAnswer = setup();

    await userEvent.click(screen.getByRole('button', { name: 'Aprobar 3 historias y continuar' }));

    expect(onAnswer).toHaveBeenCalledWith({ decision: 'aprobado' });
  });

  it('sends an edit after excluding, editing and adding stories', async () => {
    const onAnswer = setup();

    await userEvent.click(screen.getByLabelText('Incluir HU-3'));
    await userEvent.click(screen.getByRole('button', { name: 'Editar HU-1' }));
    const quiero = screen.getByLabelText('Quiero');
    await userEvent.clear(quiero);
    await userEvent.type(quiero, 'apartar un libro en línea');
    await userEvent.click(screen.getByRole('button', { name: 'Terminar edición de HU-1' }));
    await userEvent.click(screen.getByRole('button', { name: /Agregar historia/ }));
    expect(screen.getByRole('button', { name: /Aprobar 3 historias/ })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Como'), 'bibliotecaria');
    await userEvent.type(screen.getByLabelText('Quiero'), 'ver los apartados del día');
    await userEvent.type(screen.getByLabelText('Para'), 'preparar los libros');
    await userEvent.selectOptions(screen.getByLabelText('Prioridad'), 'alta');
    await userEvent.type(screen.getByLabelText('Supuestos (uno por línea)'), 'Solo personal');
    await userEvent.click(screen.getByRole('button', { name: 'Aprobar 3 historias y continuar' }));

    const answer = onAnswer.mock.calls[0]?.[0];
    expect(answer.decision).toBe('editado');
    expect(answer.historias.historias.map((h: { id: string }) => h.id)).toEqual([
      'HU-1',
      'HU-2',
      'HU-4',
    ]);
    expect(answer.historias.historias[0].quiero).toBe('apartar un libro en línea');
    expect(answer.historias.historias[2]).toMatchObject({
      como: 'bibliotecaria',
      prioridad: 'alta',
      supuestos: ['Solo personal'],
    });
  });

  it('needs at least one story', async () => {
    setup();
    for (const id of ['HU-1', 'HU-2', 'HU-3'])
      await userEvent.click(screen.getByLabelText(`Incluir ${id}`));

    expect(screen.getByRole('button', { name: 'Aprobar 0 historias y continuar' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Incluye al menos una historia');
  });

  it('asks for another version with an optional note', async () => {
    const onAnswer = setup(1);

    await userEvent.click(screen.getByRole('button', { name: 'Pedir otra versión al Analista' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar al Analista' }));
    await userEvent.type(
      screen.getByLabelText('¿Qué esperabas? (opcional)'),
      '  Separa la entrega  ',
    );
    expect(screen.getByLabelText('¿Qué esperabas? (opcional)')).toHaveAccessibleDescription(
      '21 / 500',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Enviar al Analista' }));

    expect(onAnswer.mock.calls).toEqual([
      [{ decision: 'otra_version' }],
      [{ decision: 'otra_version', nota: 'Separa la entrega' }],
    ]);
  });

  it('explains why another version is no longer possible', () => {
    setup(2);

    const button = screen.getByRole('button', { name: 'Pedir otra versión al Analista' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/Ya pediste dos versiones nuevas/);
    expect(
      within(
        screen.getByRole('region', { name: 'Revisa las historias antes de seguir' }),
      ).getByText(/espera hasta 1 hora/),
    ).toBeInTheDocument();
  });
});

describe('answerFor', () => {
  it('refuses to send no stories', () => {
    expect(() => answerFor(stories, [])).toThrow('at least one story');
  });
});
