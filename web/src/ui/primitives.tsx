// The few building blocks every section is made from, so the pages look uniform.

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, Spinner, type IconName } from './Icon.tsx';

export type Tone = 'neutral' | 'quiet' | 'accent' | 'safe' | 'caution' | 'danger';

export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');

type ButtonLook = {
  variant?: 'primary' | 'secondary' | 'quiet';
  size?: 'md' | 'lg' | 'sm';
  icon?: IconName;
  iconAfter?: IconName;
};

export function buttonClass({ variant = 'secondary', size = 'md' }: ButtonLook, extra?: string): string {
  return cx('btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, extra);
}

export function Button({
  variant,
  size,
  icon,
  iconAfter,
  busy = false,
  className,
  children,
  type = 'button',
  disabled,
  ...rest
}: ButtonLook & { busy?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size }, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <Spinner /> : icon ? <Icon name={icon} size={17} /> : null}
      <span>{children}</span>
      {iconAfter && !busy ? <Icon name={iconAfter} size={17} /> : null}
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  icon,
  iconAfter,
  className,
  children,
  ...rest
}: ButtonLook & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={buttonClass({ variant, size }, className)} {...rest}>
      {icon ? <Icon name={icon} size={17} /> : null}
      <span>{children}</span>
      {iconAfter ? <Icon name={iconAfter} size={17} /> : null}
    </a>
  );
}

type CardTag = 'div' | 'section' | 'article' | 'li' | 'aside';

export function Card({
  as: Tag = 'div',
  tone = 'default',
  pad = 'md',
  className,
  children,
  ...rest
}: {
  as?: CardTag;
  tone?: 'default' | 'accent' | 'safe' | 'caution' | 'danger' | 'sunken';
  pad?: 'sm' | 'md' | 'lg' | 'none';
  className?: string;
  children: ReactNode;
  id?: string;
  role?: string;
  tabIndex?: number;
  'aria-labelledby'?: string;
  'aria-live'?: 'polite' | 'assertive' | 'off';
}) {
  return (
    <Tag className={cx('card', tone !== 'default' && `card--${tone}`, `card--pad-${pad}`, className)} {...rest}>
      {children}
    </Tag>
  );
}

export function Chip({
  tone = 'neutral',
  icon,
  title,
  children,
}: {
  tone?: Tone;
  icon?: IconName;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className={`chip chip--${tone}`} title={title}>
      {icon ? <Icon name={icon} size={13} /> : null}
      <span>{children}</span>
    </span>
  );
}

export function SectionHeading({
  id,
  eyebrow,
  title,
  aside,
  level = 2,
}: {
  id?: string;
  eyebrow?: string;
  title: ReactNode;
  aside?: ReactNode;
  level?: 2 | 3;
}) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <div className="section-head">
      <div className="section-head__text">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <H id={id} className="section-head__title">
          {title}
        </H>
      </div>
      {aside ? <div className="section-head__aside">{aside}</div> : null}
    </div>
  );
}
