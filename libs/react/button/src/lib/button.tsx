import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from 'react';
import { ark } from '@ark-ui/react';
import { helloWorld } from '@isolate-ui/utils';
import { cx } from 'styled-system/css';
import { buttonRecipe } from './button.recipe';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Renders the button in a loading state, disabling interaction. */
  loading?: boolean;
  /** Icon rendered before the label text. */
  leadingIcon?: ReactNode;
  /** Icon rendered after the label text. */
  trailingIcon?: ReactNode;
};

export function Button({
  children,
  className,
  loading = false,
  leadingIcon,
  trailingIcon,
  disabled,
  type = 'button',
  ...buttonProps
}: PropsWithChildren<ButtonProps>) {
  const styles = buttonRecipe();

  return (
    <ark.button
      {...buttonProps}
      type={type}
      className={cx(styles.root, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
    >
      {leadingIcon && (
        <span className={styles.icon} aria-hidden="true">
          {leadingIcon}
        </span>
      )}

      {loading && (
        <span className={styles.spinner} role="status" aria-label="Loading">
          ⟳
        </span>
      )}

      <span className={styles.label}>{children ?? helloWorld()}</span>

      {trailingIcon && (
        <span className={styles.icon} aria-hidden="true">
          {trailingIcon}
        </span>
      )}
    </ark.button>
  );
}

export default Button;
