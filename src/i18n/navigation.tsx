'use client';

import { forwardRef, useMemo } from 'react';
import { Link as RouterLink, useLocation, useNavigate, type LinkProps } from 'react-router-dom';

/** Navigation is independent of the browser's language preference. */
export function usePathname(): string {
  return useLocation().pathname;
}

export function useRouter() {
  const navigate = useNavigate();
  return useMemo(() => ({
    push: (path: string) => navigate(path),
    replace: (path: string) => navigate(path, { replace: true }),
  }), [navigate]);
}

type AppLinkProps = Omit<LinkProps, 'to'> & { href: string };

export const Link = forwardRef<HTMLAnchorElement, AppLinkProps>(function Link(
  { href, ...rest },
  ref,
) {
  return <RouterLink ref={ref} to={href} {...rest} />;
});
