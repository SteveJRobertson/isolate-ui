import type { HTMLAttributes, PropsWithChildren } from 'react';
import { helloWorld } from '@isolate-ui/utils';
// import styles from './button.module.css';

export interface ButtonProps extends HTMLAttributes<HTMLButtonElement> {}

export function Button({ children, ...buttonProps }: PropsWithChildren<ButtonProps>) {
  return (
    <button{...buttonProps}>
      {children ?? helloWorld()}
    </button>
  );
}

export default Button;
