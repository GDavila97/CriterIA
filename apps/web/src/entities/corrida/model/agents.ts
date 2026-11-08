export type AgentId = 'analista' | 'qa' | 'revisor' | 'evaluador';
export type AgentIcon = 'lapiz' | 'palomita' | 'lupa' | 'estrella';

export interface AgentInfo {
  id: AgentId;
  nombre: string;
  etiqueta: string;
  descripcion: string;
  icono: AgentIcon;
  color: string;
  sombra: string;
}

export const AGENT_IDS: readonly AgentId[] = ['analista', 'qa', 'revisor', 'evaluador'];

export const AGENTS: Record<AgentId, AgentInfo> = {
  analista: {
    id: 'analista',
    nombre: 'Analista',
    etiqueta: 'Historias de usuario',
    descripcion:
      'Convierte el requerimiento en historias de usuario con prioridad y supuestos explícitos.',
    icono: 'lapiz',
    color: 'var(--color-agent-analista)',
    sombra: 'var(--color-agent-analista-shadow)',
  },
  qa: {
    id: 'qa',
    nombre: 'QA',
    etiqueta: 'Criterios y casos',
    descripcion:
      'Escribe criterios de aceptación y casos de prueba con escenarios Gherkin para cada historia.',
    icono: 'palomita',
    color: 'var(--color-agent-qa)',
    sombra: 'var(--color-agent-qa-shadow)',
  },
  revisor: {
    id: 'revisor',
    nombre: 'Revisor',
    etiqueta: 'Calidad y huecos',
    descripcion:
      'Busca ambigüedades, inconsistencias y requisitos faltantes, y pide correcciones al agente que corresponda.',
    icono: 'lupa',
    color: 'var(--color-agent-revisor)',
    sombra: 'var(--color-agent-revisor-shadow)',
  },
  evaluador: {
    id: 'evaluador',
    nombre: 'Evaluador',
    etiqueta: 'Rúbrica',
    descripcion:
      'Califica de 1 a 5 la claridad, verificabilidad, completitud y consistencia de los artefactos.',
    icono: 'estrella',
    color: 'var(--color-agent-evaluador)',
    sombra: 'var(--color-agent-evaluador-shadow)',
  },
};

export function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}
