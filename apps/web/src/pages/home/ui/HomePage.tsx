import { AGENT_IDS, AGENTS } from '@/entities/corrida';
import { AuthCard, type EmailMode } from '@/features/autenticacion';
import { Ficha, Notice } from '@/shared/ui';
import { Header } from '@/widgets/encabezado';

import styles from './HomePage.module.css';

export interface HomePageProps {
  githubEnabled: boolean;
  emailMode: EmailMode;
  oauthError?: string | null;
  accountDeleted?: boolean;
}

export function HomePage({ githubEnabled, emailMode, oauthError, accountDeleted }: HomePageProps) {
  return (
    <div className={styles.page}>
      <Header user={null} />
      <main className={styles.hero}>
        <div>
          <div className={styles.fichas} aria-hidden="true">
            {AGENT_IDS.map((id) => (
              <Ficha
                key={id}
                color={AGENTS[id].color}
                shadow={AGENTS[id].sombra}
                size={64}
                rol={AGENTS[id].icono}
                patas
              />
            ))}
          </div>
          <h1 className={styles.title}>
            De un requerimiento a casos de prueba, revisados por agentes.
          </h1>
          <p className={styles.lead}>
            Escribe lo que el sistema debe hacer. Un Analista propone historias de usuario, tú las
            apruebas, QA escribe criterios y casos, un Revisor busca huecos y un Evaluador califica
            el resultado con una rúbrica.
          </p>
          <ul className={styles.chips} aria-label="Los cuatro agentes">
            {AGENT_IDS.map((id) => (
              <li key={id} className={styles.chip}>
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <rect width="10" height="10" rx="3" fill={AGENTS[id].color} />
                </svg>
                {AGENTS[id].nombre}
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            Tú decides qué se queda: el sistema propone y la persona aprueba. Tus corridas no se
            guardan a menos que lo actives.
          </p>
        </div>
        <div className={styles.side}>
          {accountDeleted && <Notice tone="ok">Eliminamos tu cuenta y todos tus datos.</Notice>}
          <AuthCard githubEnabled={githubEnabled} emailMode={emailMode} oauthError={oauthError} />
        </div>
      </main>
    </div>
  );
}
