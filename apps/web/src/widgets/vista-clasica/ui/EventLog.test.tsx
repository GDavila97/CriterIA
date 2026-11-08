import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { initialRunState, runReducer, type RunState } from '@/entities/corrida';
import type { Evento } from '@/shared/api';
import { eventsFrom, fullRun, inicia } from '@/shared/lib/testing';

import { EventLog } from './EventLog';

const reduce = (events: Evento[]) =>
  events.reduce<RunState>(
    (s, evento) => runReducer(s, { type: 'evento', evento }),
    initialRunState('r'),
  );

const lastLog = () => screen.getByRole('log', { name: 'Últimos eventos' });

describe('EventLog', () => {
  it('waits for the first events', () => {
    render(<EventLog state={initialRunState('r')} />);

    expect(screen.getByText('Los eventos aparecen aquí en vivo.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ver registro completo/ })).not.toBeInTheDocument();
  });

  it('keeps short logs whole, without the full view', () => {
    render(<EventLog state={reduce(eventsFrom(inicia))} />);

    expect(within(lastLog()).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Ver registro completo/ })).not.toBeInTheDocument();
  });

  it('shows the last five events and the whole timeline in a side panel', async () => {
    const state = reduce(fullRun());
    const total = state.registro.length;
    render(<EventLog state={state} />);

    const items = within(lastLog()).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items.at(-1)).toHaveTextContent(state.registro.at(-1)?.texto ?? '');

    await userEvent.click(screen.getByRole('button', { name: `Ver registro completo (${total})` }));
    const panel = screen.getByRole('dialog', { name: 'Registro completo' });
    const full = within(panel).getByRole('log', { name: 'Registro completo de la corrida' });
    expect(within(full).getAllByRole('listitem')).toHaveLength(total);
    expect(within(panel).getByText(`${total} eventos`)).toBeInTheDocument();
  });

  it('filters the timeline by agent', async () => {
    const state = reduce(fullRun());
    const fromQa = state.registro.filter((e) => e.agent === 'qa').length;
    render(<EventLog state={state} />);
    await userEvent.click(screen.getByRole('button', { name: /Ver registro completo/ }));
    const panel = screen.getByRole('dialog', { name: 'Registro completo' });

    await userEvent.selectOptions(within(panel).getByLabelText('Filtrar por agente'), 'qa');

    const full = within(panel).getByRole('log', { name: 'Registro completo de la corrida' });
    expect(within(full).getAllByRole('listitem')).toHaveLength(fromQa);
    expect(
      within(panel).getByText(`${fromQa} de ${state.registro.length} eventos`),
    ).toBeInTheDocument();
    expect(within(panel).getByRole('option', { name: `QA (${fromQa})` })).toBeInTheDocument();

    await userEvent.selectOptions(within(panel).getByLabelText('Filtrar por agente'), 'evaluador');
    await userEvent.selectOptions(within(panel).getByLabelText('Filtrar por agente'), 'sistema');
    expect(
      within(panel).getByRole('log', { name: 'Registro completo de la corrida' }),
    ).toBeVisible();
  });

  it('keeps updating while the panel is open', async () => {
    const events = fullRun();
    const { rerender } = render(<EventLog state={reduce(events.slice(0, 8))} />);
    await userEvent.click(screen.getByRole('button', { name: /Ver registro completo/ }));

    const later = reduce(events);
    rerender(<EventLog state={later} />);

    const panel = screen.getByRole('dialog', { name: 'Registro completo' });
    expect(panel).toHaveAttribute('open');
    const full = within(panel).getByRole('log', { name: 'Registro completo de la corrida' });
    expect(within(full).getAllByRole('listitem')).toHaveLength(later.registro.length);
    expect(
      screen.getByRole('button', { name: `Ver registro completo (${later.registro.length})` }),
    ).toBeInTheDocument();
  });

  it('says when an agent has no events yet', async () => {
    const events = fullRun();
    render(<EventLog state={reduce(events.slice(0, 7))} />);
    await userEvent.click(screen.getByRole('button', { name: /Ver registro completo/ }));
    const panel = screen.getByRole('dialog', { name: 'Registro completo' });

    await userEvent.selectOptions(within(panel).getByLabelText('Filtrar por agente'), 'evaluador');

    expect(within(panel).getByText('Este agente todavía no tiene eventos.')).toBeInTheDocument();
  });
});
