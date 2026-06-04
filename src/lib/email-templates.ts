// ════════════════════════════════════════════════════════════════════════════
// Vaidix — Email Templates (HTML)
// ════════════════════════════════════════════════════════════════════════════
// Pattern: template-literal HTML (matches BusinessOS style).
// Branding: Vaidix teal → blue gradient. Max 600px responsive table layout.

import { env } from './env';

interface BrandConfig {
  appName: string;
  primaryGradient: string;
  supportEmail: string;
  appUrl: string;
}

const BRAND: BrandConfig = {
  appName: 'Vaidix',
  primaryGradient: 'linear-gradient(135deg, #0D9488 0%, #3B82F6 100%)',
  supportEmail: env.EMAIL_FROM.match(/<(.+?)>/)?.[1] ?? env.EMAIL_FROM,
  appUrl: env.NEXTAUTH_URL,
};

function shell(title: string, inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#334155;line-height:1.5;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#F8FAFC;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:${BRAND.primaryGradient};padding:36px 32px;text-align:center;">
            <div style="font-size:28px;font-weight:900;letter-spacing:-0.02em;color:#ffffff;">${BRAND.appName}</div>
            <div style="font-size:12px;color:rgba(255,255,255,0.8);margin-top:4px;letter-spacing:0.1em;text-transform:uppercase;">Ophthalmology Education Platform</div>
          </td>
        </tr>
        <tr><td style="padding:40px 32px 24px;">${inner}</td></tr>
        <tr>
          <td style="background:#0F172A;padding:24px 32px;color:#94A3B8;font-size:12px;text-align:center;">
            <div style="margin-bottom:8px;"><strong style="color:#F1F5F9;">${BRAND.appName}</strong> · LVPEI Residency Training</div>
            <div>Need help? Reply to this email or contact <a href="mailto:${BRAND.supportEmail}" style="color:#5EEAD4;text-decoration:none;">${BRAND.supportEmail}</a></div>
            <div style="margin-top:12px;font-size:11px;opacity:0.7;">You are receiving this email because an action was requested for an account associated with your address. If this was not you, you can safely ignore.</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function button(text: string, href: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px auto;">
    <tr><td style="border-radius:10px;background:${BRAND.primaryGradient};">
      <a href="${href}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-weight:700;font-size:15px;text-decoration:none;">${text}</a>
    </td></tr>
  </table>`;
}

function detailRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 0;border-bottom:1px solid #F1F5F9;font-size:13px;color:#64748B;width:40%;">${label}</td>
    <td style="padding:8px 0;border-bottom:1px solid #F1F5F9;font-size:14px;color:#1E293B;font-weight:600;">${value}</td>
  </tr>`;
}

// Derives the canonical login URL from the accept-invitation URL. Used inline
// in the invitation email so the recipient knows where to log in *after*
// setting their password.
function loginUrlFromAccept(acceptUrl: string): string {
  try {
    return new URL('/login', acceptUrl).toString();
  } catch {
    return `${BRAND.appUrl}/login`;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 1. INVITATION — sent when admin invites a new user
// ════════════════════════════════════════════════════════════════════════════
export interface InvitationEmailVars {
  invitedName: string;
  invitedEmail: string;
  inviterName: string;
  role: string;
  subspecialty?: string | null;
  department?: string | null;
  acceptUrl: string;
  expiresAt: Date;
}

export function renderInvitationEmail(v: InvitationEmailVars): { subject: string; html: string } {
  const subject = `You're invited to ${BRAND.appName} — ophthalmology training platform`;
  const hoursLeft = Math.round((v.expiresAt.getTime() - Date.now()) / (3600 * 1000));
  const details = [
    detailRow('Email', v.invitedEmail),
    detailRow('Role', v.role),
    v.subspecialty ? detailRow('Subspecialty', v.subspecialty) : '',
    v.department ? detailRow('Department', v.department) : '',
    detailRow('Invited by', v.inviterName),
    detailRow('Valid for', `${hoursLeft} hours`),
  ].join('');

  const inner = `
    <div style="font-size:24px;font-weight:800;color:#0F172A;margin-bottom:8px;">Welcome to Vaidix, ${escapeHtml(v.invitedName.split(' ')[0])} 🎉</div>
    <div style="font-size:15px;color:#475569;margin-bottom:28px;line-height:1.65;">
      <strong>${escapeHtml(v.inviterName)}</strong> has invited you to join <strong>${BRAND.appName}</strong> —
      the ophthalmology training platform used by LVPEI students, teachers, and program leadership.
    </div>
    <div style="background:#F0FDFA;border-left:4px solid #0D9488;padding:16px 20px;border-radius:10px;margin-bottom:24px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#0F766E;font-weight:700;margin-bottom:8px;">Your Invitation</div>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">${details}</table>
    </div>
    <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:14px 18px;font-size:13px;color:#1E40AF;line-height:1.65;margin-bottom:20px;">
      <div style="font-weight:700;margin-bottom:6px;">🔐 How to log in</div>
      <div style="margin-bottom:4px;"><strong>Step 1.</strong> Click the button below to accept the invitation.</div>
      <div style="margin-bottom:4px;"><strong>Step 2.</strong> On the page that opens, choose your own password.</div>
      <div><strong>Step 3.</strong> From then on, log in at <a href="${escapeHtml(loginUrlFromAccept(v.acceptUrl))}" style="color:#1D4ED8;text-decoration:underline;">${escapeHtml(loginUrlFromAccept(v.acceptUrl))}</a> using <strong>${escapeHtml(v.invitedEmail)}</strong> and the password you just set.</div>
    </div>
    ${button('Accept Invitation & Set Password', v.acceptUrl)}
    <div style="text-align:center;font-size:12px;color:#94A3B8;margin-bottom:20px;">Or copy this link:<br><span style="color:#475569;word-break:break-all;">${v.acceptUrl}</span></div>
    <div style="background:#FFFBEB;border-radius:10px;padding:14px 18px;font-size:13px;color:#92400E;line-height:1.6;">
      ⏱️ <strong>This invitation expires in ${hoursLeft} hours.</strong> After that, ask your administrator to resend.
    </div>
    <div style="margin-top:28px;padding-top:24px;border-top:1px solid #E2E8F0;">
      <div style="font-size:13px;color:#64748B;font-weight:700;margin-bottom:10px;">What you'll get access to:</div>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="font-size:13px;color:#475569;">
        <tr>
          <td style="padding:4px 0;">✓ Clinical case dialogues</td>
          <td style="padding:4px 0;">✓ Pearls &amp; signs atlas</td>
        </tr>
        <tr>
          <td style="padding:4px 0;">✓ Live video sessions</td>
          <td style="padding:4px 0;">✓ Recorded lectures</td>
        </tr>
        <tr>
          <td style="padding:4px 0;">✓ DOPS &amp; Mini-CEX</td>
          <td style="padding:4px 0;">✓ Personalized recommendations</td>
        </tr>
      </table>
    </div>
  `;
  return { subject, html: shell(subject, inner) };
}

// ════════════════════════════════════════════════════════════════════════════
// 2. PASSWORD RESET
// ════════════════════════════════════════════════════════════════════════════
export interface PasswordResetEmailVars {
  userName: string;
  resetUrl: string;
  expiresAt: Date;
  ipAddress?: string;
}

export function renderPasswordResetEmail(v: PasswordResetEmailVars): { subject: string; html: string } {
  const subject = `Reset your ${BRAND.appName} password`;
  const minutesLeft = Math.round((v.expiresAt.getTime() - Date.now()) / 60_000);
  const inner = `
    <div style="font-size:24px;font-weight:800;color:#0F172A;margin-bottom:8px;">Reset your password</div>
    <div style="font-size:15px;color:#475569;margin-bottom:24px;line-height:1.65;">
      Hi ${escapeHtml(v.userName.split(' ')[0])}, we received a request to reset the password for your ${BRAND.appName} account.
      Click the button below to choose a new password. This link will expire in <strong>${minutesLeft} minutes</strong>.
    </div>
    ${button('Reset My Password', v.resetUrl)}
    <div style="text-align:center;font-size:12px;color:#94A3B8;margin-bottom:24px;">Or copy this link:<br><span style="color:#475569;word-break:break-all;">${v.resetUrl}</span></div>
    <div style="background:#FEF2F2;border-radius:10px;padding:14px 18px;font-size:13px;color:#991B1B;line-height:1.6;">
      🔐 <strong>Didn't request this?</strong> You can safely ignore this email. Your password will remain unchanged.
      ${v.ipAddress ? `<br>Request made from IP: ${escapeHtml(v.ipAddress)}` : ''}
    </div>
  `;
  return { subject, html: shell(subject, inner) };
}

// ════════════════════════════════════════════════════════════════════════════
// 3. WELCOME — sent right after invitation accepted
// ════════════════════════════════════════════════════════════════════════════
export interface WelcomeEmailVars {
  userName: string;
  role: string;
  loginUrl: string;
}

export function renderWelcomeEmail(v: WelcomeEmailVars): { subject: string; html: string } {
  const subject = `Welcome to ${BRAND.appName}, ${v.userName.split(' ')[0]}!`;
  const inner = `
    <div style="font-size:24px;font-weight:800;color:#0F172A;margin-bottom:8px;">Welcome aboard, ${escapeHtml(v.userName.split(' ')[0])} 👋</div>
    <div style="font-size:15px;color:#475569;margin-bottom:24px;line-height:1.65;">
      Your ${BRAND.appName} account is active. You signed up as a <strong>${escapeHtml(v.role)}</strong>.
    </div>
    ${button('Open Vaidix', v.loginUrl)}
    <div style="margin-top:28px;padding:20px;background:#F8FAFC;border-radius:12px;">
      <div style="font-size:13px;color:#64748B;font-weight:700;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.08em;">Quick start</div>
      <div style="font-size:14px;color:#334155;line-height:1.7;">
        <strong>1.</strong> Open your Dashboard and complete your profile<br>
        <strong>2.</strong> Browse the Pearls library and Signs Atlas<br>
        <strong>3.</strong> Start your first clinical case<br>
        <strong>4.</strong> Join the next live session in Classroom
      </div>
    </div>
  `;
  return { subject, html: shell(subject, inner) };
}

// ════════════════════════════════════════════════════════════════════════════
// 4. INVITATION ACCEPTED — notify the admin who invited
// ════════════════════════════════════════════════════════════════════════════
export interface InviteAcceptedAdminVars {
  adminName: string;
  invitedUserName: string;
  invitedUserEmail: string;
  role: string;
}

export function renderInviteAcceptedAdminEmail(v: InviteAcceptedAdminVars): { subject: string; html: string } {
  const subject = `${v.invitedUserName} has joined ${BRAND.appName}`;
  const inner = `
    <div style="font-size:20px;font-weight:800;color:#0F172A;margin-bottom:12px;">Invitation accepted ✓</div>
    <div style="font-size:14px;color:#475569;margin-bottom:20px;line-height:1.65;">
      Hi ${escapeHtml(v.adminName.split(' ')[0])}, the user you invited has accepted their invitation and now has access to ${BRAND.appName}.
    </div>
    <div style="background:#F0FDF4;border-left:4px solid #16A34A;padding:14px 18px;border-radius:10px;font-size:14px;color:#14532D;">
      <strong>${escapeHtml(v.invitedUserName)}</strong> (${escapeHtml(v.invitedUserEmail)}) &mdash; ${escapeHtml(v.role)}
    </div>
  `;
  return { subject, html: shell(subject, inner) };
}

// ════════════════════════════════════════════════════════════════════════════
// 5-9. SESSION LIFECYCLE — proposed / approved / rejected / rescheduled /
//       cancelled. Sent to the faculty host, the proposer, and attendees.
// ════════════════════════════════════════════════════════════════════════════

export interface SessionEmailSharedVars {
  sessionTitle: string;
  sessionType: string;
  start: Date;
  end: Date;
  hostName: string;
  proposerName: string;
  sessionUrl: string;
  calendarUrl: string;
}

function sessionWhenLine(start: Date, end: Date): string {
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
    timeZoneName: 'short',
  };
  const s = start.toLocaleString('en-IN', dateOpts);
  const endTime = end.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  return `${s} – ${endTime}`;
}

function sessionDetailBlock(v: SessionEmailSharedVars): string {
  return `
    <div style="background:#F0FDFA;border-left:4px solid #0D9488;padding:16px 20px;border-radius:10px;margin-bottom:24px;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#0F766E;font-weight:700;margin-bottom:8px;">Session</div>
      <div style="font-size:17px;font-weight:700;color:#0F172A;margin-bottom:10px;">${escapeHtml(v.sessionTitle)}</div>
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        ${detailRow('Type', v.sessionType.replace(/_/g, ' ').toLowerCase())}
        ${detailRow('When', sessionWhenLine(v.start, v.end))}
        ${detailRow('Host', v.hostName)}
        ${detailRow('Proposed by', v.proposerName)}
      </table>
    </div>
  `;
}

// 5. PROPOSED — PD proposes a session; faculty host gets approval request ---
export interface SessionProposedEmailVars extends SessionEmailSharedVars {
  recipientName: string;
  approvalUrl: string;
  inviteCount: number;
}

export function renderSessionProposedEmail(v: SessionProposedEmailVars): {
  subject: string;
  html: string;
} {
  const subject = `Approval needed: "${v.sessionTitle}" on ${v.start.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })}`;
  const inner = `
    <div style="font-size:24px;font-weight:800;color:#0F172A;margin-bottom:8px;">You're asked to host a session</div>
    <div style="font-size:15px;color:#475569;margin-bottom:24px;line-height:1.65;">
      Hi ${escapeHtml(v.recipientName.split(' ')[0])}, <strong>${escapeHtml(v.proposerName)}</strong>
      has scheduled a session and named you as the host. Please review and accept or decline.
    </div>
    ${sessionDetailBlock(v)}
    ${button('Review in Approval Inbox', v.approvalUrl)}
    <div style="text-align:center;font-size:12px;color:#94A3B8;margin-bottom:20px;">
      Until you accept, the session stays in <strong>pending</strong> and attendees will not see it on their calendars.
    </div>
  `;
  return { subject, html: shell(subject, inner) };
}

// 6. APPROVED — faculty accepted; notify proposer + attendees -----------------
export interface SessionApprovedEmailVars extends SessionEmailSharedVars {
  recipientName: string;
  recipientRole: 'PROPOSER' | 'ATTENDEE';
}

export function renderSessionApprovedEmail(v: SessionApprovedEmailVars): {
  subject: string;
  html: string;
} {
  const subject =
    v.recipientRole === 'PROPOSER'
      ? `Confirmed: ${v.hostName} accepted "${v.sessionTitle}"`
      : `You're invited: "${v.sessionTitle}"`;
  const intro =
    v.recipientRole === 'PROPOSER'
      ? `<strong>${escapeHtml(v.hostName)}</strong> has accepted the session you proposed. Attendees on the visibility list have been notified and the <code>.ics</code> attachment is included below.`
      : `You're invited to a Vaidix teaching session. The <code>.ics</code> attachment below will add this to Google Calendar / Outlook / Apple Calendar.`;
  const inner = `
    <div style="font-size:24px;font-weight:800;color:#0F172A;margin-bottom:8px;">
      ${v.recipientRole === 'PROPOSER' ? 'Session confirmed ✓' : 'Session on your calendar 📅'}
    </div>
    <div style="font-size:15px;color:#475569;margin-bottom:24px;line-height:1.65;">
      Hi ${escapeHtml(v.recipientName.split(' ')[0])}, ${intro}
    </div>
    ${sessionDetailBlock(v)}
    ${button('Open in Vaidix', v.sessionUrl)}
    <div style="text-align:center;font-size:12px;color:#94A3B8;margin-bottom:8px;">
      <a href="${v.calendarUrl}" style="color:#475569;text-decoration:underline;">See full calendar</a>
    </div>
  `;
  return { subject, html: shell(subject, inner) };
}

// 7. REJECTED — faculty declined; notify proposer ----------------------------
export interface SessionRejectedEmailVars extends SessionEmailSharedVars {
  recipientName: string;
  reason: string;
}

export function renderSessionRejectedEmail(v: SessionRejectedEmailVars): {
  subject: string;
  html: string;
} {
  const subject = `Declined: ${v.hostName} cannot host "${v.sessionTitle}"`;
  const inner = `
    <div style="font-size:24px;font-weight:800;color:#0F172A;margin-bottom:8px;">Session declined</div>
    <div style="font-size:15px;color:#475569;margin-bottom:20px;line-height:1.65;">
      Hi ${escapeHtml(v.recipientName.split(' ')[0])}, <strong>${escapeHtml(v.hostName)}</strong>
      has declined hosting this session. You can pick another host or reschedule.
    </div>
    ${sessionDetailBlock(v)}
    <div style="background:#FEF2F2;border-radius:10px;padding:14px 18px;font-size:13px;color:#991B1B;line-height:1.6;margin-bottom:24px;">
      <strong>Reason:</strong> ${escapeHtml(v.reason)}
    </div>
    ${button('Reschedule or pick another host', v.calendarUrl)}
  `;
  return { subject, html: shell(subject, inner) };
}

// 8. RESCHEDULED — dates changed; re-notify host + attendees -----------------
export interface SessionRescheduledEmailVars extends SessionEmailSharedVars {
  recipientName: string;
  recipientRole: 'HOST' | 'ATTENDEE';
  previousStart: Date;
  previousEnd: Date;
  requiresApproval: boolean;
  approvalUrl?: string;
}

export function renderSessionRescheduledEmail(v: SessionRescheduledEmailVars): {
  subject: string;
  html: string;
} {
  const subject = `Rescheduled: "${v.sessionTitle}" → ${v.start.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`;
  const ctaHref = v.recipientRole === 'HOST' && v.requiresApproval ? v.approvalUrl ?? v.sessionUrl : v.sessionUrl;
  const ctaLabel =
    v.recipientRole === 'HOST' && v.requiresApproval ? 'Re-confirm in Approval Inbox' : 'Open session';
  const inner = `
    <div style="font-size:24px;font-weight:800;color:#0F172A;margin-bottom:8px;">Session rescheduled</div>
    <div style="font-size:15px;color:#475569;margin-bottom:24px;line-height:1.65;">
      Hi ${escapeHtml(v.recipientName.split(' ')[0])}, the session below has been moved to a new time.
      ${v.recipientRole === 'HOST' && v.requiresApproval ? ' Please re-confirm — the session is back in pending state.' : ' The attached <code>.ics</code> will update your external calendar.'}
    </div>
    ${sessionDetailBlock(v)}
    <div style="background:#FFFBEB;border-radius:10px;padding:14px 18px;font-size:13px;color:#92400E;line-height:1.6;margin-bottom:24px;">
      <strong>Previously:</strong> ${sessionWhenLine(v.previousStart, v.previousEnd)}
    </div>
    ${button(ctaLabel, ctaHref)}
  `;
  return { subject, html: shell(subject, inner) };
}

// 9. CANCELLED — session pulled --------------------------------------------
export interface SessionCancelledEmailVars extends SessionEmailSharedVars {
  recipientName: string;
  reason?: string | null;
}

export function renderSessionCancelledEmail(v: SessionCancelledEmailVars): {
  subject: string;
  html: string;
} {
  const subject = `Cancelled: "${v.sessionTitle}"`;
  const inner = `
    <div style="font-size:24px;font-weight:800;color:#0F172A;margin-bottom:8px;">Session cancelled</div>
    <div style="font-size:15px;color:#475569;margin-bottom:24px;line-height:1.65;">
      Hi ${escapeHtml(v.recipientName.split(' ')[0])}, the session below has been cancelled.
      The attached <code>.ics</code> marks the event as <strong>CANCELLED</strong> in Google Calendar / Outlook / Apple Calendar.
    </div>
    ${sessionDetailBlock(v)}
    ${v.reason ? `<div style="background:#FEF2F2;border-radius:10px;padding:14px 18px;font-size:13px;color:#991B1B;line-height:1.6;margin-bottom:24px;"><strong>Reason:</strong> ${escapeHtml(v.reason)}</div>` : ''}
    ${button('See other sessions', v.calendarUrl)}
  `;
  return { subject, html: shell(subject, inner) };
}

// 10. REMINDER — 24h + 15min before the session -----------------------------
export interface SessionReminderEmailVars extends SessionEmailSharedVars {
  recipientName: string;
  leadTime: '24H' | '15MIN';
}

export function renderSessionReminderEmail(v: SessionReminderEmailVars): {
  subject: string;
  html: string;
} {
  const subject =
    v.leadTime === '24H'
      ? `Tomorrow: "${v.sessionTitle}" with ${v.hostName}`
      : `Starting in 15 min: "${v.sessionTitle}"`;
  const intro =
    v.leadTime === '24H'
      ? `This is a reminder that you have a session tomorrow.`
      : `Your session starts in about 15 minutes. Click below to join.`;
  const inner = `
    <div style="font-size:24px;font-weight:800;color:#0F172A;margin-bottom:8px;">
      ${v.leadTime === '24H' ? 'Session tomorrow' : 'Starting soon ⏰'}
    </div>
    <div style="font-size:15px;color:#475569;margin-bottom:24px;line-height:1.65;">
      Hi ${escapeHtml(v.recipientName.split(' ')[0])}, ${intro}
    </div>
    ${sessionDetailBlock(v)}
    ${button(v.leadTime === '15MIN' ? 'Join now' : 'Open session', v.sessionUrl)}
  `;
  return { subject, html: shell(subject, inner) };
}

// ════════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════════
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
