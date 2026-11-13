'use client';

import { useCallback, useEffect, useState } from 'react';

import { AGENT_IDS, type AgentId } from '@/entities/corrida';
import { resolveView, ViewSwitch, type Vista } from '@/features/cambiar-vista';
import {
  RunForm,
  useRunController,
  type RunController,
  type RunRequestDraft,
} from '@/features/ejecutar-corrida';
import { UnsavedRunDialog, useLossGuard } from '@/features/exportar';
import {
  api,
  ApiError,
  type AgentParamsBody,
  type AgentsBody,
  type CatalogBody,
  type RunCreateBody,
  type SettingsBody,
  type UsageBody,
} from '@/shared/api';
import { modelLabelFromId } from '@/shared/config/providers';
import { Notice, SkeletonCard } from '@/shared/ui';
import { Header, type HeaderUser } from '@/widgets/encabezado';
import { AgentPanel } from '@/widgets/panel-agente';
import { ClassicView } from '@/widgets/vista-clasica';

import styles from './RunWorkspace.module.css';

type Client = Pick<typeof api, 'catalog' | 'settings' | 'usage' | 'agents'>;
type Params = Record<AgentId, AgentParamsBody>;

interface Loaded {
  catalog: CatalogBody;
  settings: SettingsBody;
  usage: UsageBody;
  guide: AgentsBody;
}

export interface RunWorkspaceProps {
  user: HeaderUser;
  officeEnabled: boolean;
  vistaParam: string | null;
  client?: Client;
  /** Injected in tests; the page uses the real controller. */
  useController?: () => RunController;
}

const EMPTY_PARAMS: Params = { analista: {}, qa: {}, revisor: {}, evaluador: {} };
const DEFAULT_ROUNDS = 2;

function tunedAgents(params: Params): RunCreateBody['agentes'] {
  const tuned = AGENT_IDS.filter((id) =>
    Object.values(params[id]).some((v) => v !== null && v !== undefined),
  );
  return tuned.length ? Object.fromEntries(tuned.map((id) => [id, params[id]])) : undefined;
}

export function RunWorkspace({
  user,
  officeEnabled,
  vistaParam,
  client = api,
  useController = useRunController,
}: RunWorkspaceProps) {
  const run = useController();
  const lossGuard = useLossGuard();
  const [data, setData] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<RunRequestDraft | null>(null);
  const [params, setParams] = useState<Params>(EMPTY_PARAMS);
  const [maxRondas, setMaxRondas] = useState(DEFAULT_ROUNDS);
  const [agent, setAgent] = useState<AgentId | null>(null);
  const [vista, setVista] = useState<Vista>(() => resolveView(vistaParam, officeEnabled));

  useEffect(() => {
    Promise.all([client.catalog(), client.settings(), client.usage(), client.agents()])
      .then(([catalog, settings, usage, guide]) => setData({ catalog, settings, usage, guide }))
      .catch((failure: unknown) =>
        setLoadError(
          failure instanceof ApiError
            ? failure.message
            : 'No se pudo cargar la página. Recarga para intentar de nuevo.',
        ),
      );
  }, [client]);

  const refreshUsage = useCallback(() => {
    client
      .usage()
      .then((usage) => setData((current) => (current ? { ...current, usage } : current)))
      .catch(() => {});
  }, [client]);

  useEffect(() => {
    if (run.created) refreshUsage();
  }, [run.created, refreshUsage]);

  const start = (next: RunRequestDraft) => {
    setDraft(next);
    void run.start({
      requerimiento: next.requerimiento,
      proveedor: next.proveedor,
      nivel: next.nivel ?? null,
      modelo: next.modelo ?? null,
      juez: next.juez ?? null,
      guardar_historial: next.guardarHistorial,
      max_rondas: maxRondas,
      agentes: tunedAgents(params),
    });
  };

  const submit = (next: RunRequestDraft) => lossGuard.guard(() => start(next));

  // Only after the person clicks: the text goes to Groq, a provider they now chose. It retries the
  // same requirement after a key failure, so it does not ask before replacing that analysis.
  const useFree = () => {
    const requerimiento = draft?.requerimiento ?? run.requerimiento;
    if (!requerimiento) return;
    void run.start({
      requerimiento,
      proveedor: 'groq',
      nivel: 'economico',
      juez: 'groq',
      guardar_historial: draft?.guardarHistorial ?? run.created?.guardar_historial,
      max_rondas: maxRondas,
    });
  };

  const providerOf = (id: AgentId) => {
    const planned = run.created?.agentes[id].proveedor;
    const fallback =
      id === 'evaluador'
        ? data?.catalog.juez_predeterminado
        : (draft?.proveedor ?? data?.catalog.proveedor_predeterminado);
    return data?.catalog.proveedores.find((p) => p.proveedor === (planned ?? fallback)) ?? null;
  };

  return (
    <div className={styles.page}>
      <Header
        user={user}
        actions={<ViewSwitch value={vista} enabled={officeEnabled} onChange={setVista} />}
      />
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {!data ? (
        !loadError && (
          <main className={styles.layout} aria-busy="true">
            <SkeletonCard lines={5} label="Cargando el análisis" />
            <SkeletonCard lines={3} label="Cargando el tablero" />
          </main>
        )
      ) : (
        <main className={styles.layout}>
          <h1 className="sr-only">Nuevo análisis</h1>
          <RunForm
            catalog={data.catalog}
            settings={data.settings}
            usage={data.usage}
            busy={run.busy || run.connection !== 'cerrado'}
            hasRun={Boolean(run.created)}
            onSubmit={submit}
          />
          <div className={styles.right}>
            {run.error && <Notice tone="error">{run.error.message}</Notice>}
            <ClassicView
              state={run.state}
              requerimiento={run.requerimiento}
              connection={run.connection}
              onOpenAgent={setAgent}
              approval={{ busy: run.busy, onAnswer: (respuesta) => void run.respond(respuesta) }}
              onUseFree={useFree}
              judgeLabel={
                run.state.modelos
                  ? modelLabelFromId(run.state.modelos.juez, data.catalog)
                  : undefined
              }
              saved={run.created?.guardar_historial}
            />
          </div>
          <AgentPanel
            agent={agent}
            state={run.state}
            guide={data.guide}
            provider={agent ? providerOf(agent) : null}
            params={agent ? params[agent] : {}}
            maxRondas={maxRondas}
            onParams={(id, next) => setParams((current) => ({ ...current, [id]: next }))}
            onMaxRondas={setMaxRondas}
            onClose={() => setAgent(null)}
          />
          <UnsavedRunDialog guard={lossGuard} />
        </main>
      )}
    </div>
  );
}
