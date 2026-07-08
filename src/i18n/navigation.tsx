'use client';

import { forwardRef } from 'react';
import { Link as RouterLink, useLocation, useNavigate, type LinkProps } from 'react-router-dom';
import { isLocale, routing, type Locale } from './routing';

/**
 * Locale-aware navigation helpers backed by react-router. Drop-in replacement
 * for the old next-intl `@/i18n/navigation` module: components importing
 * `Link`, `useRouter`, `usePathname` from here are unchanged. Paths passed in
 * are locale-agnostic (e.g. `/room/ABC`); the active locale prefix is added
 * automatically, or overridden via the `{ locale }` option.
 */

/** Active locale, read from the leading path segment (`/zh/...`). */
export function useCurrentLocale(): Locale {
  const { pathname } = useLocation();
  const seg = pathname.split('/')[1];
  return isLocale(seg) ? seg : routing.defaultLocale;
}

/** Strip a leading `/<locale>` from a pathname → its locale-agnostic form. */
function stripLocale(pathname: string): string {
  const parts = pathname.split('/');
  if (isLocale(parts[1])) {
    const rest = '/' + parts.slice(2).join('/');
    return rest.length > 1 ? rest.replace(/\/$/, '') : '/';
  }
  return pathname || '/';
}

/** Prefix a locale-agnostic path with `/<locale>`. */
function withLocale(path: string, locale: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return clean === '/' ? `/${locale}` : `/${locale}${clean}`;
}

/** The current path without its locale prefix (mirrors next-intl usePathname). */
export function usePathname(): string {
  const { pathname } = useLocation();
  return stripLocale(pathname);
}

interface NavOptions {
  locale?: string;
}

export function useRouter() {
  const navigate = useNavigate();
  const current = useCurrentLocale();
  return {
    push: (path: string, opts?: NavOptions) => navigate(withLocale(path, opts?.locale ?? current)),
    replace: (path: string, opts?: NavOptions) =>
      navigate(withLocale(path, opts?.locale ?? current), { replace: true }),
  };
}

type LocaleLinkProps = Omit<LinkProps, 'to'> & { href: string; locale?: string };

/** `<Link href="/room/ABC">` — locale prefix added automatically. */
export const Link = forwardRef<HTMLAnchorElement, LocaleLinkProps>(function Link(
  { href, locale, ...rest },
  ref,
) {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const current = useCurrentLocale();
  return <RouterLink ref={ref} to={withLocale(href, locale ?? current)} {...rest} />;
});
