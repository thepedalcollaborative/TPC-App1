# TPC App — Complete Setup Guide

## What's built so far
- ✅ Home dashboard (stats, recent pedals, boards, Finder CTA)
- ✅ Pedal Finder (Surprise Me + guided quiz + result card)
- ✅ TPC Advisor — AI chat powered by Claude (NEW this session)
- ✅ Supabase schema + 20 seed pedals
- ✅ TPC brand system (teal/slate/rose)
- ✅ Global state (Zustand)
- ✅ Tab navigation (Home, Collection, Finder, Boards, Advisor)

## Coming next sessions
- [ ] Collection screen (own list + wishlist)
- [ ] Board builder
- [ ] Auth screens (sign up / sign in)
- [ ] Profile + RevenueCat subscriptions

---

## Step 1 — Install Node dependencies

Open Terminal, navigate to your tpc-app folder and run:

```bash
npm install
```

If you get errors, try:
```bash
npm install --legacy-peer-deps
```

---

## Step 2 — Set up Supabase (free)

1. Go to https://supabase.com → Create account → New Project
2. Name it "tpc-app", choose a region close to you, set a database password
3. Wait ~2 minutes for it to provision
4. Go to **SQL Editor** → **New Query**
5. Copy the entire contents of `DATABASE_SCHEMA.sql` and paste it in → **Run**
6. Go to **Settings → API**
7. Copy your **Project URL** and **anon public** key

---

## Step 3 — Get your Anthropic API key

1. Go to https://console.anthropic.com
2. Sign in or create an account
3. Go to **API Keys** → **Create Key**
4. Copy the key (you won't see it again)

> **Cost note:** Claude claude-sonnet-4-20250514 costs ~$0.003 per typical conversation turn.
> A user having 10 back-and-forth messages costs less than $0.05.
> For testing, $5 of API credit will last a very long time.

---

## Step 4 — Configure your keys in app.json

Open `app.json` and replace the placeholder values:

```json
"extra": {
  "supabaseUrl": "https://xxxxxxxxxxxx.supabase.co",
  "supabaseAnonKey": "eyJhbGciOiJIUzI1NiIsInR...",
  "anthropicApiKey": "sk-ant-api03-...",
  "revenueCatApiKey": "YOUR_REVENUECAT_KEY"
}
```

> ⚠️ IMPORTANT: Never commit app.json with real keys to a public GitHub repo.
> Before going to production, move keys to environment variables or Expo secrets.

---

## Step 5 — Install Expo CLI and start the app

```bash
# Install Expo CLI globally (one time)
npm install -g expo-cli

# Start the development server
npx expo start
```

Then:
- Press **i** to open in the iOS Simulator (requires Xcode)
- Or scan the QR code with **Expo Go** app on your iPhone for instant device testing

---

## Step 6 — Enable Auth in Supabase

1. Go to **Authentication → Providers** in your Supabase dashboard
2. Ensure **Email** is enabled
3. For App Store release, enable **Apple** provider later

---

## Testing the AI Advisor

1. Open the app → tap **Advisor** tab
2. Try a starter prompt like "What's missing from my setup?"
3. If you see an API error, double-check your `anthropicApiKey` in app.json
4. The Advisor automatically knows your collection (once you add pedals)

---

## File structure
```
tpc-app/
├── App.tsx                        # Entry + tab navigation
├── app.json                       # Config + API keys (← edit this)
├── DATABASE_SCHEMA.sql            # Run in Supabase SQL editor
├── SETUP.md                       # This file
├── src/
│   ├── theme/index.ts             # Colors, fonts, spacing
│   ├── lib/
│   │   ├── supabase.ts            # DB client + types
│   │   ├── anthropic.ts           # Claude API client (streaming)
│   │   └── systemPrompt.ts        # AI personality + context builder
│   ├── data/
│   │   └── pedalSeed.ts           # 50+ pedal catalog for AI context
│   ├── hooks/useStore.ts          # Global state (Zustand)
│   ├── components/index.tsx       # Shared UI components
│   └── screens/
│       ├── HomeScreen.tsx         # Dashboard
│       ├── FinderScreen.tsx       # Pedal Finder
│       └── AdvisorScreen.tsx      # AI Chat (NEW)
```
