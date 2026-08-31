import { isSecureOrigin } from '../env'

export function oauthStateCookieName(): string {
  return isSecureOrigin() ? '__Host-vh_oauth' : 'vh_oauth'
}
