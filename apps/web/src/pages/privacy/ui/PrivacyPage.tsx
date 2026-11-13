import Link from 'next/link';

import { DataControls } from '@/features/controles-datos';
import { Header, type HeaderUser } from '@/widgets/encabezado';

import styles from './PrivacyPage.module.css';

export interface PrivacyUser extends HeaderUser {
  providers: string[];
}

/** The address of a mailto: link, or the URL without its scheme. */
function contactLabel(url: string): string {
  return url.startsWith('mailto:') ? url.slice('mailto:'.length) : url.replace(/^https:\/\//, '');
}

export function PrivacyPage({
  user,
  contactUrl,
}: {
  user: PrivacyUser | null;
  contactUrl: string;
}) {
  const github = user?.providers.includes('github') ?? false;
  return (
    <div className={styles.page}>
      <Header user={user} />
      <main className={styles.main}>
        {user && (
          <Link href="/ajustes/modelos" className={styles.back}>
            Volver a ajustes
          </Link>
        )}
        <h1 className={styles.title}>Privacidad y datos</h1>
        <p className={styles.lead}>
          Qué pasa con lo que escribes, con quién se comparte y qué puedes controlar. Actualizado el
          7 nov 2026.
        </p>

        <section className={styles.card} aria-labelledby="req-title">
          <h2 id="req-title">Tu requerimiento</h2>
          <p>
            Para que los agentes trabajen, el texto que escribes se envía al proveedor de modelos
            que elegiste. Antes de cada análisis verás a qué proveedor se envía y con qué clave.
          </p>
          <p>
            CriterIA no guarda tus análisis, salvo que actives &quot;Guardar mis análisis&quot; o lo
            elijas al ejecutar. No escribas datos personales ni información confidencial.
          </p>
        </section>

        <section className={styles.card} aria-labelledby="providers-title">
          <h2 id="providers-title">Proveedores de modelos</h2>
          <div
            className={styles.scroll}
            tabIndex={0}
            role="region"
            aria-label="Tabla de proveedores"
          >
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Proveedor</th>
                  <th scope="col">Clave</th>
                  <th scope="col">Qué términos aplican</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>Groq (gratuito)</strong>
                  </td>
                  <td>De CriterIA</td>
                  <td>
                    Los de Groq para su API. Según sus términos, no entrena modelos con los datos
                    enviados.
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>OpenAI, Anthropic</strong>
                  </td>
                  <td>Tuya</td>
                  <td>Los de tu cuenta con ese proveedor.</td>
                </tr>
                <tr>
                  <td>
                    <strong>Compatible con OpenAI</strong>
                  </td>
                  <td>Tuya</td>
                  <td>Los del servicio que conectes.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Nunca cambiamos de proveedor sin preguntarte. Si tu clave falla, el análisis se detiene
            y tú decides si continuar con el modo gratuito.
          </p>
        </section>

        <section className={styles.card} aria-labelledby="stored-title">
          <h2 id="stored-title">Qué guardamos</h2>
          <ul>
            <li>
              <strong>Tu cuenta:</strong> nombre, correo y contraseña (guardada como hash, nunca en
              texto).
            </li>
            {github && (
              <li>
                <strong>Tu cuenta de GitHub:</strong> su identificador y tu correo verificado, para
                que puedas entrar. No guardamos sus tokens de acceso.
              </li>
            )}
            <li>
              <strong>Tus claves de API:</strong> cifradas; solo se usan durante tus análisis.
            </li>
            <li>
              <strong>Tu uso:</strong> cuántos análisis haces al día, para aplicar los límites.
            </li>
            <li>
              <strong>Tus análisis:</strong> solo si activas el historial.
            </li>
            <li>
              <strong>Errores técnicos:</strong> registros de fallos sin datos personales ni
              contenido de tus análisis.
            </li>
          </ul>
          <p>
            No usamos cookies de rastreo ni analítica de terceros. La única cookie mantiene tu
            sesión iniciada.
          </p>
        </section>

        <section className={styles.card} aria-labelledby="controls-title">
          <h2 id="controls-title">Tus controles</h2>
          {user ? (
            <DataControls />
          ) : (
            <p>Inicia sesión para borrar tu historial, tus claves o tu cuenta.</p>
          )}
        </section>

        <section className={styles.soft} aria-labelledby="responsible-title">
          <h2 id="responsible-title">Uso responsable</h2>
          <p>
            Los agentes proponen; tú apruebas. Revisa siempre las historias y los casos antes de
            usarlos. La calificación de la rúbrica la hace un modelo y puede equivocarse.
          </p>
          <p>
            Dudas o solicitudes sobre tus datos: <a href={contactUrl}>{contactLabel(contactUrl)}</a>
          </p>
        </section>
      </main>
    </div>
  );
}
