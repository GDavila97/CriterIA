'use client';

import { useRunSession } from '@/entities/corrida';
import { Button, Dialog, Icon } from '@/shared/ui';

import type { LossGuard } from '../model/useLossGuard';
import { downloadMarkdown } from './ExportButtons';

export const UNSAVED_MESSAGE =
  'Este análisis no está guardado en tu historial. Si continúas, se perderá. Puedes descargarlo antes.';

export function UnsavedRunDialog({ guard }: { guard: LossGuard }) {
  const session = useRunSession();
  return (
    <Dialog
      open={guard.asking}
      title="¿Descartar el análisis?"
      description={UNSAVED_MESSAGE}
      onClose={guard.cancel}
      actions={
        <>
          <Button onClick={guard.cancel}>Cancelar</Button>
          <Button
            variant="soft"
            onClick={() => downloadMarkdown(session.state, session.requerimiento)}
          >
            <Icon name="descargar" size={18} />
            Descargar
          </Button>
          <Button variant="destructive" onClick={guard.proceed}>
            Descartar y continuar
          </Button>
        </>
      }
    />
  );
}
