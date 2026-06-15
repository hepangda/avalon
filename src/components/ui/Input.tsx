'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils/cn';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'w-full rounded-md border border-gold/30 bg-ink/40 px-3 py-2.5 text-parchment',
          'placeholder:text-parchment/40',
          'focus:border-gold/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40',
          className,
        )}
        {...props}
      />
    );
  },
);
