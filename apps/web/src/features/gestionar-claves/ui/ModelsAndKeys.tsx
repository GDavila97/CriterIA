'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import {
  api,
  ApiError,
  type CatalogBody,
  type CredentialBody,
  type SettingsBody,
} from '@/shared/api';
import {
  JUDGE_ORDER,
  PROVIDER_NAMES,
  TIER_NAMES,
  type ProviderId,
  type Tier,
} from '@/shared/config/providers';
import { useHydrated } from '@/shared/lib/react';
import {
  Badge,
  Button,
  Icon,
  motion,
  Notice,
  SelectField,
  SkeletonCard,
  TextField,
} from '@/shared/ui';

import styles from './ModelsAndKeys.module.css';

type Api = Pick<
  typeof api,
  'catalog' | 'credentials' | 'settings' | 'saveSettings' | 'saveCredential' | 'deleteCredential'
>;

const DEFAULT_CHOICES: ProviderId[] = ['groq', 'anthropic', 'openai'];
const DATE = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

function KeyForm({
  provider,
  withUrl,
  onSave,
}: {
  provider: ProviderId;
  withUrl?: boolean;
  onSave: (key: string, url?: string) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const hydrated = useHydrated();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    const saved = await onSave(
      String(data.get('key') ?? ''),
      withUrl ? String(data.get('url') ?? '') : undefined,
    );
    setBusy(false);
    // The key never stays in the page once it was sent.
    if (saved) form.reset();
  };
  return (
    <form className={styles.keyForm} onSubmit={submit} method="post">
      {withUrl && (
        <TextField
          label="URL base (https)"
          name="url"
          type="url"
          placeholder="https://api.ejemplo.com/v1"
          required
        />
      )}
      <TextField
        label={`Clave de API de ${PROVIDER_NAMES[provider]}`}
        name="key"
        type="password"
        autoComplete="off"
        placeholder="sk-…"
        required
        maxLength={512}
      />
      <Button type="submit" variant="primary" disabled={busy || !hydrated}>
        Guardar y validar
      </Button>
    </form>
  );
}

export function ModelsAndKeys({ client = api }: { client?: Api }) {
  const [catalog, setCatalog] = useState<CatalogBody | null>(null);
  const [keys, setKeys] = useState<CredentialBody[]>([]);
  const [settings, setSettings] = useState<SettingsBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ProviderId | null>(null);

  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    Promise.all([client.catalog(), client.credentials(), client.settings()])
      .then(([c, k, s]) => {
        setCatalog(c);
        setKeys(k);
        setSettings(s);
      })
      .catch((failure: unknown) =>
        setError(
          failure instanceof ApiError ? failure.message : 'No se pudieron cargar tus ajustes.',
        ),
      );
  }, [client, version]);

  if (!catalog || !settings) {
    return error ? (
      <Notice tone="error">{error}</Notice>
    ) : (
      <div className={styles.page}>
        <SkeletonCard lines={3} label="Cargando tus ajustes" />
        <SkeletonCard lines={4} label="Cargando tus claves" />
      </div>
    );
  }

  const keyFor = (provider: ProviderId) => keys.find((k) => k.proveedor === provider);
  const available = (provider: ProviderId) =>
    catalog.proveedores.find((p) => p.proveedor === provider)?.disponible ?? false;
  const tiers = (provider: ProviderId) =>
    catalog.proveedores.find((p) => p.proveedor === provider)?.niveles ?? [];
  const currentDefault = settings.default_provider ?? catalog.proveedor_predeterminado;

  const saveSettings = async (change: Partial<SettingsBody>) => {
    setError(null);
    try {
      setSettings(await client.saveSettings({ ...settings, ...change }));
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'No se guardó el cambio.');
    }
  };

  const saveKey = async (provider: ProviderId, key: string, url?: string) => {
    setError(null);
    try {
      await client.saveCredential(provider, key, url);
      setOpen(null);
      load();
      return true;
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'No se pudo validar la clave.');
      return false;
    }
  };

  const remove = async (provider: ProviderId) => {
    setError(null);
    try {
      await client.deleteCredential(provider);
      if (settings.default_provider === provider)
        await saveSettings({ default_provider: null, default_tier: null });
      load();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'No se pudo eliminar la clave.');
    }
  };

  const keyCard = (provider: ProviderId, title: string, description?: string, withUrl = false) => {
    const key = keyFor(provider);
    const providerTiers = tiers(provider);
    return (
      <section key={provider} className={styles.key} aria-labelledby={`key-${provider}`}>
        <div className={styles.keyHead}>
          <h3 id={`key-${provider}`} className={styles.keyName}>
            {title}
          </h3>
          {key ? (
            <>
              <Badge tone="ok">
                <Icon name="palomita" size={14} /> Conectada
              </Badge>
              <span className={styles.mono}>••••{key.last4}</span>
              <span className={styles.small}>
                Validada el {DATE.format(new Date(key.validated_at))}
              </span>
              <div className={styles.keyActions}>
                <Button
                  small
                  onClick={() => setOpen(open === provider ? null : provider)}
                  aria-expanded={open === provider}
                >
                  Reemplazar
                </Button>
                <Button small variant="danger" onClick={() => remove(provider)}>
                  Eliminar
                </Button>
              </div>
            </>
          ) : (
            <Badge>Sin conectar</Badge>
          )}
        </div>
        {description && !key && <p className={styles.small}>{description}</p>}
        {(!key || open === provider) && (
          <KeyForm
            provider={provider}
            withUrl={withUrl}
            onSave={(k, u) => saveKey(provider, k, u)}
          />
        )}
        {key && providerTiers.length > 0 && (
          <fieldset className={styles.options}>
            <legend className={styles.small}>Nivel</legend>
            {providerTiers.map((tier) => (
              <label key={tier.nivel} className={`${styles.option} ${motion.lift}`}>
                <span className={styles.optionTitle}>
                  <input
                    type="radio"
                    name={`tier-${provider}`}
                    checked={
                      settings.default_provider === provider && settings.default_tier === tier.nivel
                    }
                    onChange={() =>
                      saveSettings({ default_provider: provider, default_tier: tier.nivel as Tier })
                    }
                  />
                  {TIER_NAMES[tier.nivel]}
                </span>
                <span className={styles.small}>{tier.display_name}</span>
                <span className={styles.mono}>
                  {tier.costo_estimado_usd === null
                    ? 'sin precio'
                    : `≈ $${tier.costo_estimado_usd.toFixed(3)} por corrida`}
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </section>
    );
  };

  const judges = JUDGE_ORDER.filter(
    (p) => available(p) && tiers(p).some((t) => t.nivel === 'economico'),
  );

  return (
    <div className={styles.page}>
      {error && <Notice tone="error">{error}</Notice>}
      <section className={styles.card} aria-labelledby="default-title">
        <h2 id="default-title" className={styles.cardTitle}>
          Modelo predeterminado
        </h2>
        <fieldset className={styles.options}>
          <legend className="sr-only">Proveedor predeterminado</legend>
          {DEFAULT_CHOICES.map((provider) => {
            const free = provider === 'groq';
            const ready = available(provider);
            return (
              <label key={provider} className={`${styles.option} ${motion.lift}`}>
                <span className={styles.optionTitle}>
                  <input
                    type="radio"
                    name="default-provider"
                    checked={currentDefault === provider}
                    disabled={!ready}
                    onChange={() =>
                      saveSettings({
                        default_provider: provider,
                        default_tier: free ? null : (tiers(provider)[0]?.nivel ?? null),
                      })
                    }
                  />
                  {free ? 'Gratuito' : PROVIDER_NAMES[provider]}
                </span>
                <span className={styles.small}>{free ? 'Groq · sin clave' : 'Con tu clave'}</span>
                <span className={ready ? styles.ok : styles.needs}>
                  {free ? 'Disponible' : ready ? 'Clave conectada' : 'Necesita clave'}
                </span>
              </label>
            );
          })}
        </fieldset>
        <p className={styles.small}>
          El modo gratuito usa Groq con la clave de CriterIA y tiene un límite de corridas por hora.
          Lo puedes cambiar en cada corrida.
        </p>
      </section>

      <section className={styles.card} aria-labelledby="keys-title">
        <h2 id="keys-title" className={styles.cardTitle}>
          Tus claves
        </h2>
        {keyCard('anthropic', 'Anthropic', 'La validamos con una consulta gratuita a Anthropic.')}
        {keyCard('openai', 'OpenAI', 'La validamos con una consulta gratuita a OpenAI.')}
        <div className={styles.pair}>
          {keyCard(
            'groq',
            'Groq con tu cuenta',
            'Opcional. Ya usas Groq gratis con la clave de CriterIA; conecta la tuya si necesitas más corridas.',
          )}
          {keyCard(
            'openai_compatible',
            'Compatible con OpenAI',
            'Para otros servicios con API compatible. Requiere URL con HTTPS y tu clave.',
            true,
          )}
        </div>
      </section>

      <section className={styles.card} aria-labelledby="judge-title">
        <h2 id="judge-title" className={styles.cardTitle}>
          Juez de la rúbrica
        </h2>
        <SelectField
          label="Quién califica tus corridas"
          value={settings.judge_provider ?? ''}
          onChange={(event) =>
            saveSettings({ judge_provider: (event.target.value || null) as ProviderId | null })
          }
          options={[
            {
              value: '',
              label: 'Automático: un proveedor distinto al de generación (recomendado)',
            },
            ...judges.map((p) => ({ value: p, label: PROVIDER_NAMES[p] })),
          ]}
          hint="Un modelo tiende a calificar mejor lo que escribió su propio proveedor. Si solo tienes uno configurado, la corrida te lo indicará."
        />
      </section>

      <section className={styles.care} aria-labelledby="care-title">
        <Icon name="candado" />
        <div>
          <h2 id="care-title" className={styles.cardTitle}>
            Cómo cuidamos tus claves
          </h2>
          <ul>
            <li>
              Se guardan cifradas (AES-256) y la llave de cifrado no está en nuestra base de datos.
            </li>
            <li>Nunca vuelven a tu navegador: solo ves los últimos 4 caracteres.</li>
            <li>Se usan únicamente durante tus corridas y no aparecen en registros.</li>
            <li>Nunca cambiamos de proveedor sin preguntarte.</li>
            <li>Puedes eliminarlas cuando quieras; se borran también al eliminar tu cuenta.</li>
          </ul>
          <Link href="/privacidad">Leer Privacidad y datos</Link>
        </div>
      </section>
    </div>
  );
}
