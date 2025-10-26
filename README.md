# Twitch Helix Local App

A minimal local Node.js app to authenticate with Twitch (OAuth2 Authorization Code) and call Helix endpoints.

## Prereqs
- Node.js 18+ recommended
- A Twitch Developer application

## Register a Twitch App
1. Go to https://dev.twitch.tv/console/apps
2. Create an app
3. Set OAuth Redirect URL to `http://localhost:3000/callback`
4. Copy the Client ID and generate a Client Secret

## Setup
1. Clone/open this repo folder `twitch-mon/`
2. Copy `.env.example` to `.env` and fill values
3. Install deps:
   ```bash
   npm install
   ```
4. Start server:
   ```bash
   npm start
   ```
5. Visit http://localhost:3000 and click `/login` (or go directly to `/login`)

## Endpoints
- `GET /login` – begin OAuth
- `GET /callback` – OAuth redirect target
- `GET /me` – current user info from Helix `/users`
- `GET /streams?user_login=<name>` – example Helix call

Tokens are stored locally in `tokens.json` (ignored by git). Refresh is automatic when needed.
