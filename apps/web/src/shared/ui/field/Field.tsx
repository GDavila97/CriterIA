import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { Icon } from '../icon/Icon';

import styles from './Field.module.css';

interface FieldFrame {
  label: string;
  hint?: ReactNode;
  error?: string | null;
}

function Frame({
  id,
  label,
  hint,
  error,
  children,
}: FieldFrame & { id: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && (
        <span className={styles.hint} id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className={styles.error} id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function describedBy(id: string, frame: FieldFrame): string | undefined {
  const ids = [frame.hint && `${id}-hint`, frame.error && `${id}-error`].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

export function TextField({
  label,
  hint,
  error,
  ...props
}: FieldFrame & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <Frame id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { label, hint, error })}
        {...props}
      />
    </Frame>
  );
}

export function TextArea({
  label,
  hint,
  error,
  ...props
}: FieldFrame & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <Frame id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { label, hint, error })}
        {...props}
      />
    </Frame>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function SelectField({
  label,
  hint,
  error,
  options,
  ...props
}: FieldFrame & SelectHTMLAttributes<HTMLSelectElement> & { options: SelectOption[] }) {
  const id = useId();
  return (
    <Frame id={id} label={label} hint={hint} error={error}>
      <span className={styles.selectWrap}>
        <select
          id={id}
          className={styles.input}
          aria-describedby={describedBy(id, { label, hint, error })}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <span className={styles.fieldIcon} aria-hidden="true">
          <Icon name="abajo" size={16} />
        </span>
      </span>
    </Frame>
  );
}

export function CheckboxField({
  label,
  ...props
}: { label: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={styles.check}>
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}
