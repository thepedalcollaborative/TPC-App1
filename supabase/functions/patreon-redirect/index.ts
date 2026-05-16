/**
 * patreon-redirect — HTTPS middleman for Patreon OAuth.
 *
 * Patreon's developer portal only accepts http:// and https:// redirect URIs —
 * it rejects custom app schemes like tpc://.  This function:
 *   1. Receives the OAuth callback from Patreon (GET with ?code & ?state)
 *   2. Immediately 302-redirects to the app's deep link (tpc://auth-callback)
 *
 * The app opens the auth URL with WebBrowser.openAuthSessionAsync whose
 * callbackUrl is set to "tpc://auth-callback", so it intercepts the redirect
 * and hands the code back to the app without ever leaving the in-app browser.
 *
 * Register this function's deployed URL in the Patreon developer portal as the
 * redirect URI:
 *   https://<project-ref>.supabase.co/functions/v1/patreon-redirect
 */

Deno.serve((req: Request) => {
  // Only allow GET (Patreon sends a browser redirect)
  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const incoming = new URL(req.url);

  const code  = incoming.searchParams.get('code');
  const state = incoming.searchParams.get('state');
  const error = incoming.searchParams.get('error');
  const errorDescription = incoming.searchParams.get('error_description');

  // Build the deep-link URL the app is listening for
  const appUrl = new URL('tpc://auth-callback');
  if (code)             appUrl.searchParams.set('code',              code);
  if (state)            appUrl.searchParams.set('state',             state);
  if (error)            appUrl.searchParams.set('error',             error);
  if (errorDescription) appUrl.searchParams.set('error_description', errorDescription);

  return Response.redirect(appUrl.toString(), 302);
});
