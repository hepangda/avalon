'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary:
    'bg-gradient-to-b from-gold-bright to-gold text-ink-deep font-semibold shadow-candle hover:from-gold hover:to-gold-dim disabled:from-gold/40 disabled:to-gold/30',
  secondary:
    'bg-stone/80 text-parchment border border-gold/40 hover:border-gold/80 hover:bg-stone hover:shadow-candle',
  ghost: 'bg-transparent text-parchment/80 hover:text-parchment hover:bg-white/5',
  danger:
    'bg-gradient-to-b from-crimson-bright to-crimson text-parchment font-semibold hover:from-crimson hover:to-crimson disabled:opacity-40',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/70',
        'disabled:cursor-not-allowed disabled:opacity-70',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});
