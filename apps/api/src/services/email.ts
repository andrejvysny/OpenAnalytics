import nodemailer, { type Transporter } from 'nodemailer';
import { env, emailEnabled } from '../env';

let cached: Transporter | null = null;

export function emailReady(): boolean {
  return emailEnabled;
}

function transport(): Transporter | null {
  if (!emailEnabled) return null;
  if (cached) return cached;
  // Implicit TLS on 465, STARTTLS on 587 unless SMTP_SECURE explicitly overrides.
  const secure = env.SMTP_SECURE ?? env.SMTP_PORT === 465;
  cached = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure,
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
  });
  return cached;
}

function defaultFrom(): string {
  return env.EMAIL_FROM ?? (env.SMTP_USER ? `OpenAnalytics <${env.SMTP_USER}>` : 'OpenAnalytics');
}

export async function verifyTransport(): Promise<{ ok: boolean; error?: string }> {
  const t = transport();
  if (!t) return { ok: false, error: 'SMTP not configured' };
  try {
    await t.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function sendInviteEmail(
  to: string,
  workspaceName: string,
  url: string,
  inviterName: string,
): Promise<boolean> {
  const t = transport();
  if (!t) return false;
  const subject = `${inviterName} invited you to ${workspaceName} on OpenAnalytics`;
  const text = `${inviterName} has invited you to join the workspace "${workspaceName}" on OpenAnalytics.\n\nAccept your invitation:\n${url}\n\nThis link expires in 7 days.`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 540px; margin: 0 auto;">
      <h2 style="margin-bottom: 8px;">You've been invited to ${escape(workspaceName)}</h2>
      <p>${escape(inviterName)} has invited you to join their workspace on <strong>OpenAnalytics</strong> — a tool for tracking coding-agent usage.</p>
      <p style="margin: 24px 0;">
        <a href="${url}" style="display: inline-block; background: #4f8cff; color: white; padding: 12px 22px; border-radius: 6px; text-decoration: none; font-weight: 500;">Accept invitation</a>
      </p>
      <p style="color: #666; font-size: 13px;">Or open this link:<br><a href="${url}">${escape(url)}</a></p>
      <p style="color: #888; font-size: 12px; margin-top: 32px;">This invitation expires in 7 days. If you weren't expecting it, you can ignore this message.</p>
    </div>`;
  await t.sendMail({ from: defaultFrom(), to, subject, text, html });
  return true;
}

export async function sendPasswordResetEmail(
  to: string,
  url: string,
  ttlHours: number,
): Promise<boolean> {
  const t = transport();
  if (!t) return false;
  const subject = 'Reset your OpenAnalytics password';
  const text = `Use the link below to reset your OpenAnalytics password. The link expires in ${ttlHours}h.\n\n${url}\n\nIf you didn't request this, you can ignore this email.`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 540px; margin: 0 auto;">
      <h2>Reset your password</h2>
      <p>Click below to set a new password for your OpenAnalytics account. Link expires in ${ttlHours} hours.</p>
      <p style="margin: 24px 0;">
        <a href="${url}" style="display: inline-block; background: #4f8cff; color: white; padding: 12px 22px; border-radius: 6px; text-decoration: none;">Reset password</a>
      </p>
      <p style="color: #888; font-size: 12px;">Didn't ask for this? Ignore the email — your password stays unchanged.</p>
    </div>`;
  await t.sendMail({ from: defaultFrom(), to, subject, text, html });
  return true;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
