import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { initialRunState, runReducer, type RunState } from '@/entities/corrida';
import { agentsGuide, catalog, fullRun } from '@/shared/lib/testing';

import { AgentPanel, type AgentPanelProps } from './AgentPanel';

const done: RunState = fullRun().reduce(
  (s, evento) => runReducer(s, { type: 'evento', evento }),
  initialRunState('r'),
);
const groq = catalog().proveedores.find((p) => p.proveedor === 'groq') ?? null;

function setup(overrides: Partial<AgentPanelProps> = {}) {
  const props: AgentPanelProps = {
    agent: 'revisor',
    state: done,
    guide: agentsGuide(),
    provider: groq,
    params: {},
    maxRondas: 2,
    onParams: vi.fn(),
    onMaxRondas: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<AgentPanel {...props} />);
  return props;
}

describe('AgentPanel', () => {
  it('describes the agent with its prompt read-only and its use in the run', () => {
    setup();

    expect(screen.getByRole('dialog', { name: 'Agente' })).toBeInTheDocument();
    expect(screen.getByText('Calidad y huecos')).toBeInTheDocument();
    expect(screen.getByText('Aprobó · 2 rondas · 1 observación')).toBeInTheDocument();
    expect(screen.getByLabelText('Prompt del Revisor, solo lectura')).toHaveTextContent(
      'Eres el Revisor',
    );
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('2,400')).toBeInTheDocument();
    expect(screen.getByText('3.0 s')).toBeInTheDocument();
    expect(screen.getByText('USD 0.0020')).toBeInTheDocument();
    expect(screen.getByText('Los cambios aplican a tu siguiente corrida.')).toBeInTheDocument();
  });

  it('edits the model within its provider, the temperature, tokens and rounds', async () => {
    const props = setup();

    await userEvent.selectOptions(
      screen.getByLabelText('Modelo'),
      'modelo:llama-3.3-70b-versatile',
    );
    fireEvent.change(screen.getByLabelText(/Temperatura/), { target: { value: '0.7' } });
    fireEvent.change(screen.getByLabelText('Máx. tokens'), { target: { value: '2048' } });
    fireEvent.change(screen.getByLabelText('Rondas máx.'), { target: { value: '3' } });

    expect(props.onParams).toHaveBeenNthCalledWith(1, 'revisor', {
      modelo: 'llama-3.3-70b-versatile',
      nivel: null,
    });
    expect(props.onParams).toHaveBeenNthCalledWith(2, 'revisor', { temperatura: 0.7 });
    expect(props.onParams).toHaveBeenNthCalledWith(3, 'revisor', { max_tokens: 2048 });
    expect(props.onMaxRondas).toHaveBeenCalledWith(3);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'El de la corrida',
      'Groq · Económico (openai/gpt-oss-20b)',
      'Groq · llama-3.3-70b-versatile',
    ]);
  });

  it('shows the chosen values, flags out-of-range tokens and hides rounds for others', async () => {
    const props = setup({
      agent: 'qa',
      params: { nivel: 'economico', temperatura: 0.5, max_tokens: 100 },
      guide: null,
      provider: null,
    });

    expect(screen.getByLabelText('Modelo')).toHaveValue('');
    expect(screen.getByText('0.5')).toBeInTheDocument();
    expect(screen.getByText('Entre 256 y 8192.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Rondas máx.')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Cargando el prompt' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('reflects a chosen tier and stays closed without an agent', async () => {
    const props = setup({
      agent: 'evaluador',
      params: { nivel: 'economico' },
      state: initialRunState(),
    });

    expect(screen.getByLabelText('Modelo')).toHaveValue('nivel:economico');
    expect(screen.getByText('Todavía no entrega.')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Modelo'), '');
    expect(props.onParams).toHaveBeenCalledWith('evaluador', { nivel: null, modelo: null });
    await userEvent.selectOptions(screen.getByLabelText('Modelo'), 'nivel:economico');
    expect(props.onParams).toHaveBeenLastCalledWith('evaluador', {
      nivel: 'economico',
      modelo: null,
    });
  });

  it('renders nothing visible without an agent', () => {
    setup({ agent: null });

    expect(screen.queryByText('Parámetros')).not.toBeInTheDocument();
  });
});
