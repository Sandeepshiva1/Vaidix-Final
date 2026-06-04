// ════════════════════════════════════════════════════════════════════════════
// Email Transport (Gmail SMTP via Nodemailer)
// ════════════════════════════════════════════════════════════════════════════
// Used for: invitations, password reset, safety escalations, digest emails.
// Production: swap to AWS SES or Sendgrid by changing EMAIL_HOST.

import nodemailer, { type Transporter } from 'nodemailer';
import { env } from './env';

const globalForMailer = globalThis as unknown as { mailer?: Transporter };

export const mailer: Transporter =
  globalForMailer.mailer ??
  nodemailer.createTransport({
    host: env.EMAIL_HOST,
    port: env.EMAIL_PORT,
    secure: env.EMAIL_PORT === 465,
    auth: {
      user: env.EMAIL_USER,
      pass: env.EMAIL_PASSWORD,
    },
  });

if (process.env.NODE_ENV !== 'production') {
  globalForMailer.mailer = mailer;
}

export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: EmailAttachment[];
}

export async function sendEmail(opts: SendEmailOptions) {
  // Ensure a display name is present — bare email addresses land in spam.
  const from = env.EMAIL_FROM.includes('<')
    ? env.EMAIL_FROM
    : `Vaidix <${env.EMAIL_FROM}>`
  // Extract the raw address for List-Unsubscribe (strips "Display <addr>" wrapper).
  const rawAddr = (from.match(/<([^>]+)>/) ?? [])[1] ?? env.EMAIL_FROM

  const info = await mailer.sendMail({
    from,
    to: Array.isArray(opts.to) ? opts.to.join(',') : opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text ?? stripHtml(opts.html),
    replyTo: opts.replyTo,
    cc: opts.cc?.join(','),
    bcc: opts.bcc?.join(','),
    attachments: opts.attachments,
    headers: {
      'List-Unsubscribe': `<mailto:${rawAddr}?subject=unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
  return { id: info.messageId, accepted: info.accepted, rejected: info.rejected };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

export async function verifyTransport(): Promise<boolean> {
  try {
    await mailer.verify();
    return true;
  } catch (err) {
    console.error('[email] transport verify failed:', err);
    return false;
  }
}
