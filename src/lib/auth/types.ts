export interface AuthUser {
  id: string;
  /** Original identity-provider name; a game alias never changes the login identity. */
  username: string;
  alias?: string;
  picture?: string;
}

export function accountDisplayName(user: AuthUser): string {
  return user.alias || user.username;
}
