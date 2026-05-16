/**
 * send-auth-email
 *
 * Supabase Auth Hook — "Send Email" event.
 * Intercepts every auth email Supabase would normally send (password reset,
 * email confirmation, magic link, email change) and delivers it via Resend's
 * HTTP API instead. No SMTP config, no domain verification required —
 * uses Resend's shared onboarding@resend.dev sender.
 *
 * Setup (one-time, in Supabase dashboard):
 *   1. Deploy:  npx supabase functions deploy send-auth-email --no-verify-jwt
 *   2. Secret:  npx supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx SEND_EMAIL_HOOK_SECRET='v1,whsec_...'
 *   3. Dashboard → Authentication → Hooks → "Send Email" hook
 *      → enable → paste the function URL
 *      → generate/copy the Secret into SEND_EMAIL_HOOK_SECRET
 *
 * Payload shape (Supabase Auth Hook spec):
 *   { user: { email }, email_data: { email_action_type, token_hash, redirect_to, site_url } }
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const HOOK_SECRET    = Deno.env.get('SEND_EMAIL_HOOK_SECRET')
  ?? Deno.env.get('SEND_AUTH_EMAIL_HOOK_SECRET')
  ?? '';
const FROM_NAME      = 'The Pedal Collaborative';
const FROM_EMAIL     = 'onboarding@resend.dev';
const FROM           = `${FROM_NAME} <${FROM_EMAIL}>`;

function standardWebhookSecret(secret: string): string {
  return secret.startsWith('v1,whsec_') ? secret.replace('v1,whsec_', '') : secret;
}

// ─── Email templates ──────────────────────────────────────────────────────────

function buildVerifyLink(siteUrl: string, tokenHash: string, type: string, redirectTo: string) {
  const base = siteUrl.replace(/\/$/, '');
  return `${base}/auth/v1/verify?token=${tokenHash}&type=${type}&redirect_to=${encodeURIComponent(redirectTo)}`;
}

function passwordResetEmail(link: string) {
  return {
    subject: 'Reset your TPC password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0d1b2a;color:#e2e8f0;border-radius:12px;">
        <img src="https://thepedalcollaborative.com/tpc-logo.png" alt="TPC" width="48" style="margin-bottom:24px;" />
        <h2 style="margin:0 0 8px;font-size:22px;color:#ffffff;">Reset your password</h2>
        <p style="margin:0 0 24px;color:#94a3b8;font-size:15px;line-height:1.6;">
          We received a request to reset the password for your TPC account. Click the button below to choose a new one.
        </p>
        <a href="${link}" style="display:inline-block;background:#2BB5A0;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:15px;font-weight:600;">
          Reset Password
        </a>
        <p style="margin:24px 0 0;color:#64748b;font-size:13px;">
          This link expires in 1 hour. If you didn't request a reset, you can safely ignore this email.
        </p>
      </div>
    `,
  };
}

function emailConfirmationEmail(link: string) {
  return {
    subject: 'Confirm your TPC email',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0d1b2a;color:#e2e8f0;border-radius:12px;">
        <img src="https://thepedalcollaborative.com/tpc-logo.png" alt="TPC" width="48" style="margin-bottom:24px;" />
        <h2 style="margin:0 0 8px;font-size:22px;color:#ffffff;">Welcome to TPC</h2>
        <p style="margin:0 0 24px;color:#94a3b8;font-size:15px;line-height:1.6;">
          Tap the button below to confirm your email and get into the app.
        </p>
        <a href="${link}" style="display:inline-block;background:#2BB5A0;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:15px;font-weight:600;">
          Confirm Email
        </a>
        <p style="margin:24px 0 0;color:#64748b;font-size:13px;">
          If you didn't create a TPC account, you can safely ignore this email.
        </p>
      </div>
    `,
  };
}

function magicLinkEmail(link: string) {
  return {
    subject: 'Your TPC sign-in link',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0d1b2a;color:#e2e8f0;border-radius:12px;">
        <img src="https://thepedalcollaborative.com/tpc-logo.png" alt="TPC" width="48" style="margin-bottom:24px;" />
        <h2 style="margin:0 0 8px;font-size:22px;color:#ffffff;">Sign in to TPC</h2>
        <p style="margin:0 0 24px;color:#94a3b8;font-size:15px;line-height:1.6;">
          Tap the button below to sign in. This link expires in 1 hour.
        </p>
        <a href="${link}" style="display:inline-block;background:#2BB5A0;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:15px;font-weight:600;">
          Sign In
        </a>
        <p style="margin:24px 0 0;color:#64748b;font-size:13px;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  };
}

function emailChangeEmail(link: string, isCurrent: boolean) {
  return {
    subject: isCurrent ? 'Confirm your email change on TPC' : 'Confirm your new TPC email',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0d1b2a;color:#e2e8f0;border-radius:12px;">
        <img src="https://thepedalcollaborative.com/tpc-logo.png" alt="TPC" width="48" style="margin-bottom:24px;" />
        <h2 style="margin:0 0 8px;font-size:22px;color:#ffffff;">
          ${isCurrent ? 'Confirm email change' : 'Confirm your new email'}
        </h2>
        <p style="margin:0 0 24px;color:#94a3b8;font-size:15px;line-height:1.6;">
          Tap the button below to ${isCurrent ? 'approve the email change on your current address' : 'confirm your new email address'}.
        </p>
        <a href="${link}" style="display:inline-block;background:#2BB5A0;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-size:15px;font-weight:600;">
          Confirm
        </a>
      </div>
    `,
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (!HOOK_SECRET) {
    console.error('[send-auth-email] SEND_EMAIL_HOOK_SECRET not set');
    return new Response('Hook not configured', { status: 503 });
  }

  if (!RESEND_API_KEY) {
    console.error('[send-auth-email] RESEND_API_KEY not set');
    return new Response('Missing RESEND_API_KEY', { status: 500 });
  }

  let payload: {
    user: { email: string };
    email_data: {
      email_action_type: string;
      token_hash: string;
      redirect_to: string;
      site_url: string;
    };
  };

  try {
    const rawPayload = await req.text();
    const headers = Object.fromEntries(req.headers);
    payload = new Webhook(standardWebhookSecret(HOOK_SECRET)).verify(rawPayload, headers) as typeof payload;
  } catch (err) {
    console.error('[send-auth-email] Invalid webhook signature:', err instanceof Error ? err.message : String(err));
    return new Response('Unauthorized', { status: 401 });
  }

  const { user, email_data } = payload;
  const { email_action_type, token_hash, redirect_to, site_url } = email_data;
  const toEmail = user.email;

  const link = buildVerifyLink(site_url, token_hash, email_action_type, redirect_to);

  let template: { subject: string; html: string };
  switch (email_action_type) {
    case 'recovery':
      template = passwordResetEmail(link);
      break;
    case 'signup':
    case 'invite':
      template = emailConfirmationEmail(link);
      break;
    case 'magiclink':
      template = magicLinkEmail(link);
      break;
    case 'email_change_current':
      template = emailChangeEmail(link, true);
      break;
    case 'email_change_new':
      template = emailChangeEmail(link, false);
      break;
    default:
      console.warn('[send-auth-email] Unknown action type:', email_action_type);
      return new Response('Unknown email_action_type', { status: 400 });
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to:   [toEmail],
      subject: template.subject,
      html:    template.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('[send-auth-email] Resend error:', res.status, body);
    return new Response(`Resend error: ${body}`, { status: 502 });
  }

  console.log(`[send-auth-email] Sent "${email_action_type}" email`);
  return new Response(JSON.stringify({ sent: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
