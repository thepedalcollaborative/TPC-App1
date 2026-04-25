// app.config.js — dynamic config layer on top of app.json.
// Expo CLI automatically loads .env files (SDK 49+), so process.env is
// populated before this runs. EAS Build uses EAS Secrets for production.
//
// All values below are loaded from .env locally and EAS Secrets in production.
// Never hardcode secrets directly in this file or in app.json.

/** @param {{ config: import('@expo/config').ExpoConfig }} ctx */
export default ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    supabaseUrl:      process.env.SUPABASE_URL      ?? '',
    supabaseAnonKey:  process.env.SUPABASE_ANON_KEY ?? '',
    patreonClientId:  process.env.PATREON_CLIENT_ID ?? '',
    revenueCatApiKey: process.env.REVENUE_CAT_API_KEY ?? '',
  },
});
