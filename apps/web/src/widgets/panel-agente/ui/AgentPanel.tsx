'use client';

import {
  AGENTS,
  agentSummary,
  formatUsd,
  totalUse,
  type AgentId,
  type RunState,
} from '@/entities/corrida';
import type { AgentParamsBody, AgentsBody, CatalogProviderBody } from '@/shared/api';
import { modelLabel, PROVIDER_NAMES, TIER_NAMES } from '@/shared/config/providers';
import { Drawer, Ficha, SelectField, Skeleton, TextField } from '@/shared/ui';

import styles from './AgentPanel.module.css';

export interface AgentPanelProps {
  agent: AgentId | null;
  state: RunState;
  guide: AgentsBody | null;
  /** The provider this agent runs on: generation for three agents, the judge for the Evaluador. */
  provider: CatalogProviderBody | null;
  params: AgentParamsBody;
  maxRondas: number;
  onParams: (agent: AgentId, params: AgentParamsBody) => void;
  onMaxRondas: (value: number) => void;
  onClose: () => void;
}

const DEFAULT_TEMPERATURE = 0.2;
// Same default as the API: reasoning models spend part of the cap thinking.
const DEFAULT_TOKENS = 8192;

function modelOptions(provider: CatalogProviderBody | null) {
  if (!provider) return [{ value: '', label: 'El de la corrida' }];
  const tiers = provider.niveles.map((t) => ({
    value: `nivel:${t.nivel}`,
    label: `${PROVIDER_NAMES[provider.proveedor]} · ${TIER_NAMES[t.nivel]}`,
  }));
  const tiered = new Set(provider.niveles.map((t) => t.modelo));
  const models = provider.modelos
    .filter((m) => !tiered.has(m))
    .map((m) => ({
      value: `modelo:${m}`,
      label: modelLabel(provider.proveedor, provider.display_names[m] ?? m),
    }));
  return [{ value: '', label: 'El de la corrida' }, ...tiers, ...models];
}

function modelHint(provider: CatalogProviderBody | null, params: AgentParamsBody): string {
  if (params.modelo) return `Modelo: ${provider?.display_names[params.modelo] ?? params.modelo}`;
  const tier = provider?.niveles.find((t) => t.nivel === params.nivel);
  return tier ? `Modelo: ${tier.display_name}` : 'El modelo elegido al ejecutar la corrida.';
}

function selectedModel(params: AgentParamsBody): string {
  if (params.modelo) return `modelo:${params.modelo}`;
  if (params.nivel) return `nivel:${params.nivel}`;
  return '';
}

function fromModelValue(value: string): Pick<AgentParamsBody, 'nivel' | 'modelo'> {
  if (value.startsWith('nivel:'))
    return { nivel: value.slice(6) as AgentParamsBody['nivel'], modelo: null };
  if (value.startsWith('modelo:')) return { modelo: value.slice(7), nivel: null };
  return { nivel: null, modelo: null };
}

export function AgentPanel({
  agent,
  state,
  guide,
  provider,
  params,
  maxRondas,
  onParams,
  onMaxRondas,
  onClose,
}: AgentPanelProps) {
  if (!agent)
    return (
      <Drawer open={false} title="Agente" onClose={onClose}>
        {null}
      </Drawer>
    );
  const info = AGENTS[agent];
  const summary = agentSummary(state, agent);
  const use = totalUse(state.agentes[agent].usos);
  const temperature = params.temperatura ?? DEFAULT_TEMPERATURE;
  const maxTemperature = guide?.temperatura_maxima ?? 1;
  const minTokens = guide?.max_tokens_minimo ?? 256;
  const maxTokens = guide?.max_tokens_maximo ?? 8192;
  const version = agent === 'evaluador' ? guide?.version_juez : guide?.version_prompts;
  const set = (change: AgentParamsBody) => onParams(agent, { ...params, ...change });

  return (
    <Drawer open title="Agente" onClose={onClose}>
      <div className={styles.panel}>
        <div className={styles.hero}>
          <Ficha
            color={info.color}
            shadow={info.sombra}
            size={96}
            rol={info.icono}
            patas
            trabajando={state.agentes[agent].estado === 'trabajando'}
          />
          <span className={styles.status}>
            <span className={styles.dot} aria-hidden="true" />
            {summary.detalle ? `${summary.estado} · ${summary.detalle}` : summary.estado}
          </span>
        </div>

        <dl className={styles.facts}>
          <div>
            <dt>Nombre</dt>
            <dd>{info.nombre}</dd>
          </div>
          <div>
            <dt>Etiqueta</dt>
            <dd>{info.etiqueta}</dd>
          </div>
          <div>
            <dt>Descripción</dt>
            <dd>{info.descripcion}</dd>
          </div>
        </dl>

        <section className={styles.box} aria-labelledby="params-title">
          <h3 id="params-title" className={styles.boxHead}>
            Parámetros
          </h3>
          <SelectField
            label="Modelo"
            value={selectedModel(params)}
            onChange={(event) => set(fromModelValue(event.target.value))}
            options={modelOptions(provider)}
            hint={modelHint(provider, params)}
          />
          <div className={styles.range}>
            <div className={styles.rangeHead}>
              <label htmlFor="temperature">Temperatura</label>
              <output htmlFor="temperature" className={styles.version}>
                {temperature.toFixed(1)}
              </output>
            </div>
            <input
              id="temperature"
              type="range"
              min={0}
              max={maxTemperature}
              step={0.1}
              value={temperature}
              onChange={(event) => set({ temperatura: Number(event.target.value) })}
            />
          </div>
          <div className={styles.pair}>
            <TextField
              label="Máx. tokens"
              type="number"
              inputMode="numeric"
              min={minTokens}
              max={maxTokens}
              step={256}
              value={params.max_tokens ?? DEFAULT_TOKENS}
              onChange={(event) => set({ max_tokens: Number(event.target.value) })}
              error={
                params.max_tokens !== undefined &&
                params.max_tokens !== null &&
                (params.max_tokens < minTokens || params.max_tokens > maxTokens)
                  ? `Entre ${minTokens} y ${maxTokens}.`
                  : null
              }
            />
            {agent === 'revisor' && (
              <TextField
                label="Rondas máx."
                type="number"
                inputMode="numeric"
                min={0}
                max={guide?.rondas_maximas ?? 3}
                value={maxRondas}
                onChange={(event) => onMaxRondas(Number(event.target.value))}
              />
            )}
          </div>
          <p className={styles.note}>Los cambios aplican a tu siguiente corrida.</p>
        </section>

        <section className={styles.box} aria-labelledby="prompt-title">
          <h3 id="prompt-title" className={styles.boxHead}>
            Prompt {version && <span className={styles.version}>{version}</span>}
          </h3>
          {guide ? (
            <pre
              className={styles.prompt}
              tabIndex={0}
              aria-label={`Prompt del ${info.nombre}, solo lectura`}
            >
              {guide.prompts[agent]}
            </pre>
          ) : (
            <div className={styles.promptLoading} role="status" aria-label="Cargando el prompt">
              <Skeleton />
              <Skeleton />
              <Skeleton width="60%" />
            </div>
          )}
          <p className={styles.note}>Solo lectura en esta versión.</p>
        </section>

        <section className={styles.box} aria-labelledby="run-title">
          <h3 id="run-title" className={styles.boxHead}>
            En esta corrida
          </h3>
          <p className={styles.note}>{summary.detalle ?? 'Todavía no entrega.'}</p>
          <dl className={styles.metrics}>
            <div>
              <dt>Tokens</dt>
              <dd>{use.tokens.toLocaleString('es-MX')}</dd>
            </div>
            <div>
              <dt>Latencia</dt>
              <dd>{(use.latenciaMs / 1000).toFixed(1)} s</dd>
            </div>
            <div>
              <dt>Costo</dt>
              <dd>{state.agentes[agent].usos.length ? formatUsd(use.costo) : '—'}</dd>
            </div>
          </dl>
        </section>
      </div>
    </Drawer>
  );
}
