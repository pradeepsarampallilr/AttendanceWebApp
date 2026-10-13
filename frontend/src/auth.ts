/**
 * Sets up Okta sign-in, and gives the website the sign-in token to send with requests.
 * Also handles signing out.
 */
import { OktaAuth } from '@okta/okta-auth-js';

const issuer = import.meta.env.VITE_OKTA_ISSUER as string | undefined;
const clientId = import.meta.env.VITE_OKTA_CLIENT_ID as string | undefined;


export const oktaAuth = issuer && clientId
  ? new OktaAuth({
      issuer,
      clientId,
      redirectUri: `${window.location.origin}/login/callback`,
      scopes: ['openid', 'profile', 'email'],
      pkce: true,
      tokenManager: { storage: 'sessionStorage', autoRenew: true },
    })
  : null;

export const CALLBACK_PATH = '/login/callback';

export async function getAccessToken(): Promise<string | undefined> {
  if (!oktaAuth) return undefined;
  if (!new URL(oktaAuth.options.issuer!).pathname.includes('/oauth2')) {
    return (await oktaAuth.tokenManager.get('idToken')) ? oktaAuth.getIdToken() : undefined;
  }
  return (await oktaAuth.tokenManager.get('accessToken')) ? oktaAuth.getAccessToken() : undefined;
}

export async function signOut(): Promise<void> {
  if (!oktaAuth) return;
  const idToken = await oktaAuth.tokenManager.get('idToken').catch(() => undefined);
  oktaAuth.tokenManager.clear();
  sessionStorage.clear();
  localStorage.removeItem('okta-token-storage');
  try {
    await oktaAuth.signOut({
      idToken: idToken && 'idToken' in idToken ? idToken : undefined,
      postLogoutRedirectUri: window.location.origin,
      clearTokensBeforeRedirect: true,
    });
  } catch {
    window.location.assign('/');
  }
}
