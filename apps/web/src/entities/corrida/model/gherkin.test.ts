import { caso, historia, observacion } from '@/shared/lib/testing';

import { featuresOf, gherkinSteps, scenarioOrigin, scenarioText, toFeature } from './gherkin';

describe('gherkinSteps', () => {
  it('tags each step with its keyword and keeps the model text', () => {
    expect(
      gherkinSteps({
        escenario: 'Agendar',
        dado: ['el paciente inició sesión', 'tiene una cita libre'],
        cuando: ['confirma la reserva'],
        entonces: ['el sistema crea la cita', 'pero no cobra nada', 'Y muestra la fecha'],
      }),
    ).toEqual([
      { keyword: 'Dado', text: 'el paciente inició sesión' },
      { keyword: 'Y', text: 'tiene una cita libre' },
      { keyword: 'Cuando', text: 'confirma la reserva' },
      { keyword: 'Entonces', text: 'el sistema crea la cita' },
      { keyword: 'Pero', text: 'no cobra nada' },
      { keyword: 'Y', text: 'muestra la fecha' },
    ]);
  });

  it('leaves a first step that starts with a conjunction untouched', () => {
    expect(
      gherkinSteps({ escenario: 'x', dado: ['y luego'], cuando: ['pasa'], entonces: ['sale'] })[0],
    ).toEqual({ keyword: 'Dado', text: 'y luego' });
  });
});

describe('features', () => {
  const historias = [historia(1, 'apartar un libro'), historia(2, 'ver mis apartados')];
  const casos = [caso(1, 'qa', 'HU-2'), caso(2, 'qa', 'HU-1'), caso(3, 'qa', 'HU-9'), caso(4)];

  it('groups scenarios by story in the stories order', () => {
    expect(
      featuresOf(historias, casos).map((f) => [f.historiaId, f.titulo, f.casos.map((c) => c.id)]),
    ).toEqual([
      ['HU-1', 'Apartar un libro', ['CP-02', 'CP-04']],
      ['HU-2', 'Ver mis apartados', ['CP-01']],
      ['HU-9', '', ['CP-03']],
    ]);
  });

  it('writes a Spanish .feature with one Característica per story', () => {
    const feature = toFeature({ historias, casos: [caso(1), caso(2, 'qa', 'HU-2')] });

    expect(feature).toBe(
      [
        '# language: es',
        '',
        'Característica: HU-1 Apartar un libro',
        '',
        '  @CP-01',
        '  Escenario: Escenario 1',
        '    Dado una alumna con sesión',
        '    Cuando confirma',
        '    Entonces queda registrado',
        '',
        'Característica: HU-2 Ver mis apartados',
        '',
        '  @CP-02',
        '  Escenario: Escenario 2',
        '    Dado una alumna con sesión',
        '    Cuando confirma',
        '    Entonces queda registrado',
        '',
      ].join('\n'),
    );
    expect(scenarioText(caso(1))).toBe(
      '@CP-01\nEscenario: Escenario 1\n  Dado una alumna con sesión\n  Cuando confirma\n  Entonces queda registrado',
    );
  });
});

describe('scenarioOrigin', () => {
  const round = (ronda: number, o = observacion(), seCorrige = true) => ({
    ronda,
    observacion: o,
    seCorrige,
  });

  it('cites the one observation behind a case the Reviewer asked for', () => {
    expect(scenarioOrigin(caso(90, 'revisor'), [round(0)])).toEqual({
      titulo: 'Agregado en la ronda 2 a pedido del Revisor',
      observacion: { numero: 1, descripcion: 'Falta un caso de error' },
    });
  });

  it('notes the request without a quote when several observations could explain it', () => {
    expect(scenarioOrigin(caso(90, 'revisor'), [round(0), round(0)])).toEqual({
      titulo: 'Agregado a pedido del Revisor',
      observacion: null,
    });
    expect(scenarioOrigin(caso(90, 'revisor'), [])).toEqual({
      titulo: 'Agregado a pedido del Revisor',
      observacion: null,
    });
  });

  it('marks a QA case only when an observation names it', () => {
    const naming = { ...observacion(), referencias: ['CP-01'] };
    expect(scenarioOrigin(caso(1), [round(0)])).toBeNull();
    expect(scenarioOrigin(caso(1), [round(1, observacion('analista')), round(0, naming)])).toEqual({
      titulo: 'Corregido en la ronda 2 a pedido del Revisor',
      observacion: { numero: 2, descripcion: 'Falta un caso de error' },
    });
    expect(scenarioOrigin(caso(1), [round(0, naming, false)])).toBeNull();
  });
});
