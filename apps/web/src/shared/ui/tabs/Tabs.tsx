'use client';

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import styles from './Tabs.module.css';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

export interface TabsProps {
  label: string;
  items: TabItem[];
  initial?: string;
}

/** WAI-ARIA tabs: arrows, Home and End move between tabs and select them. */
export function Tabs({ label, items, initial }: TabsProps) {
  const base = useId();
  const [selected, setSelected] = useState(initial ?? items[0]?.id);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = items.findIndex((item) => item.id === selected);
    const moves: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: items.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const index = (target + items.length) % items.length;
    setSelected(items[index]?.id);
    refs.current[index]?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label={label} className={styles.list} onKeyDown={onKeyDown}>
        {items.map((item, index) => (
          <button
            key={item.id}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`${base}-${item.id}-tab`}
            aria-selected={item.id === selected}
            aria-controls={`${base}-${item.id}-panel`}
            tabIndex={item.id === selected ? 0 : -1}
            className={styles.tab}
            onClick={() => setSelected(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items
        .filter((item) => item.id === selected)
        .map((item) => (
          <div
            key={item.id}
            role="tabpanel"
            id={`${base}-${item.id}-panel`}
            aria-labelledby={`${base}-${item.id}-tab`}
            tabIndex={0}
            className={styles.panel}
          >
            {item.content}
          </div>
        ))}
    </div>
  );
}
