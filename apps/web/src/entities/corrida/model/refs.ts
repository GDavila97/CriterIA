export type RefKind = 'historia' | 'caso' | 'observacion' | 'rubrica';

/** Something a message or a note points at: a story, a case, an observation or the rubric. */
export interface ArtifactRef {
  kind: RefKind;
  /** "HU-2", "CP-10", "O-1" or "rubrica". */
  id: string;
  /** What the link says, such as "CP-01 … CP-09" for a range. */
  label: string;
}

/** The artifacts tab that shows each kind; the rubric has its own card. */
export const REF_TAB: Record<RefKind, string | null> = {
  historia: 'historias',
  caso: 'casos',
  observacion: 'observaciones',
  rubrica: null,
};

/** The element id a reference opens. */
export const anchorOf = (ref: Pick<ArtifactRef, 'kind' | 'id'>) => `ref-${ref.kind}-${ref.id}`;

export const observationLabel = (numero: number) => `O-${numero}`;

export const ref = (kind: RefKind, id: string, label = id): ArtifactRef => ({ kind, id, label });
