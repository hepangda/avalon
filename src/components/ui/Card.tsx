import { cn } from '@/lib/utils/cn';

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('panel p-5', className)} {...props}>
      {children}
    </div>
  );
}
