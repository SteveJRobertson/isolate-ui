import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { helloWorld } from '@isolate-ui/utils';
import { css } from 'styled-system/css';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  children,
  className,
  ...buttonProps
}: PropsWithChildren<ButtonProps>) {
  const baseStyles = css({
    backgroundColor: 'primary.500',
    color: 'neutral.0',
    padding: '4',
    borderRadius: '2',
    fontWeight: 'semibold',
    fontSize: 'base',
  });

  return (
    <button
      className={className ? `${baseStyles} ${className}` : baseStyles}
      {...buttonProps}
    >
      {children ?? helloWorld()}
    </button>
  );
}

export default Button;
