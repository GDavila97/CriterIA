import type { ButtonHTMLAttributes, Ref } from 'react';

import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'danger' | 'destructive' | 'ghost';

export interface ButtonStyle {
  variant?: ButtonVariant;
  block?: boolean;
  small?: boolean;
}

/** The class list, also for links that look like buttons. */
export function buttonClass({ variant = 'secondary', block, small }: ButtonStyle = {}): string {
  return [styles.button, styles[variant], block && styles.block, small && styles.small]
    .filter(Boolean)
    .join(' ');
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  ButtonStyle & { ref?: Ref<HTMLButtonElement> };

export function Button({
  variant,
  block,
  small,
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[buttonClass({ variant, block, small }), className].filter(Boolean).join(' ')}
      {...props}
    />
  );
}
