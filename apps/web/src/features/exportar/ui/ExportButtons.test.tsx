import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { initialRunState, runReducer, type RunState } from '@/entities/corrida';
import { fullRun } from '@/shared/lib/testing';

import { toJson, toMarkdown } from '../model/export';
import { ResultActions } from './ExportButtons';

const done: RunState = fullRun().reduce(
  (state, evento) => runReducer(state, { type: 'evento', evento }),
  initialRunState('11111111-aaaa'),
);
const REQ = 'La biblioteca necesita apartados en línea';

describe('export', () => {
  it('writes every artifact to Markdown with origins and Gherkin', () => {
    const md = toMarkdown(done, `  ${REQ}  `);

    expect(md).toContain(`## Requerimiento\n\n${REQ}\n`);
    expect(md).toContain('### HU-1 (prioridad alta)');
    expect(md).toContain('| CP-90 | HU-1 | Caso 90 | Resultado 90 | Revisor |');
    expect(md).toContain(
      'Escenario: Escenario 1\n  Dado una alumna con sesión\n  Cuando confirma\n  Entonces queda registrado',
    );
    expect(md).toContain('Faltante (HU-1): Falta un caso de error');
    expect(md).toContain('## Rúbrica: 4.0 de 5');
    expect(md).toContain('revísala antes de usarla');
  });

  it('escapes table pipes and works with partial runs', () => {
    const partial: RunState = {
      ...initialRunState('r'),
      casos: [{ ...done.casos[0]!, titulo: 'A | B' }],
    };

    const md = toMarkdown(partial, REQ);

    expect(md).toContain('A \\| B');
    expect(md).not.toContain('## Rúbrica');
    expect(md).not.toContain('Modelos:');
  });

  it('exports JSON with the same content', () => {
    const json = JSON.parse(toJson(done, REQ));

    expect(json.requerimiento).toBe(REQ);
    expect(json.casos).toHaveLength(3);
    expect(json.observaciones[0]).toMatchObject({ tipo: 'faltante', ronda: 0 });
  });

  it('downloads Markdown and JSON from the Descargar menu, which closes after each choice', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<ResultActions state={done} requerimiento={REQ} />);
    const menu = screen.getByRole('button', { name: 'Descargar' });

    expect(menu).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Markdown' }));
    expect(screen.queryByRole('button', { name: 'JSON' })).not.toBeInTheDocument();
    expect(menu).toHaveFocus();
    await userEvent.click(menu);
    await userEvent.click(screen.getByRole('button', { name: 'JSON' }));

    expect(click).toHaveBeenCalledTimes(2);
    expect((click.mock.instances[1] as unknown as HTMLAnchorElement).download).toMatch(/\.json$/);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');
    click.mockRestore();
  });

  it('closes the menu with Escape or a click outside', async () => {
    render(<ResultActions state={done} requerimiento={REQ} />);
    const menu = screen.getByRole('button', { name: 'Descargar' });

    await userEvent.click(menu);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: 'Markdown' })).not.toBeInTheDocument();
    expect(menu).toHaveFocus();
    await userEvent.click(menu);
    await userEvent.click(document.body);
    expect(screen.queryByRole('button', { name: 'Markdown' })).not.toBeInTheDocument();
  });

  it('marks an unsaved result and offers Nuevo análisis only when it can start one', async () => {
    const onNewAnalysis = vi.fn();
    const { rerender } = render(<ResultActions state={done} requerimiento={REQ} />);
    expect(screen.queryByText('No guardado en tu historial')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo análisis' })).not.toBeInTheDocument();

    rerender(
      <ResultActions state={done} requerimiento={REQ} unsaved onNewAnalysis={onNewAnalysis} />,
    );
    expect(screen.getByText('No guardado en tu historial')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo análisis' }));
    expect(onNewAnalysis).toHaveBeenCalled();
  });
});
