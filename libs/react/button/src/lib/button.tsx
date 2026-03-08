import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';
import { helloWorld } from '@isolate-ui/utils';
// import styles from './button.module.css';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  children,
  ...buttonProps
}: PropsWithChildren<ButtonProps>) {
  return <button {...buttonProps}>{children ?? helloWorld()}</button>;
}

export default Button;
