'use client';

import { Segmented } from '@/shared/ui';

import { storeView, type Vista } from '../model/view';

export interface ViewSwitchProps {
  value: Vista;
  enabled: boolean;
  onChange: (vista: Vista) => void;
}

/** Hidden until the office view exists (NEXT_PUBLIC_OFFICE_VIEW). */
export function ViewSwitch({ value, enabled, onChange }: ViewSwitchProps) {
  if (!enabled) return null;
  return (
    <Segmented<Vista>
      label="Vista"
      value={value}
      onChange={(vista) => {
        storeView(vista);
        onChange(vista);
      }}
      options={[
        { value: 'clasica', label: 'Clásica' },
        { value: 'oficina', label: 'Oficina' },
      ]}
    />
  );
}
