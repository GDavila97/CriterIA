import { RecoverForm, ResetForm } from '@/features/autenticacion';
import { Header } from '@/widgets/encabezado';

import styles from './RecoveryPages.module.css';

export function RecoverPage() {
  return (
    <div>
      <Header user={null} />
      <main className={styles.main}>
        <RecoverForm />
      </main>
    </div>
  );
}

export function ResetPage({ token }: { token: string | null }) {
  return (
    <div>
      <Header user={null} />
      <main className={styles.main}>
        <ResetForm token={token} />
      </main>
    </div>
  );
}
