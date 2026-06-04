// list past attempts on this template (for "Review previous attempt"),
// or POST to start a new attempt (creates Case + Conversation + opening Message).
import {
  jsonOk,
  jsonError,
  requireAuth,
  requireAuthWithProgram,
  handleUnexpected,
} from '@/server/services/api-helpers';
import {
  listConversationsForTemplate,
  startCase,
  CasesError,
} from '@/server/services/cases/cases-service';
import { audit, AUDIT_EVENTS, extractRequestMetadata } from '@/server/services/audit';

export async function GET(_req: Request, ctx: { params: Promise<{ caseTemplateId: string }> }) {
  try {
    // List previous attempts: scoped to the user, not the program — a resident's
    // history is theirs across programs. The template id itself is opaque so
    // there's no cross-tenant leak surface.
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { caseTemplateId } = await ctx.params;
    const items = await listConversationsForTemplate(
      { userId: gate.user.id, role: gate.user.role },
      caseTemplateId
    );
    return jsonOk({ items });
  } catch (err) {
    return handleUnexpected(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ caseTemplateId: string }> }) {
  try {
    // starting a case must validate the template belongs to the
    // user's active program; the service layer enforces this.
    const gate = await requireAuthWithProgram();
    if (!gate.ok) return gate.response;
    const { caseTemplateId } = await ctx.params;
    const result = await startCase(
      { userId: gate.user.id, role: gate.user.role },
      caseTemplateId,
      gate.user.activeProgramId,
    );
    const meta = extractRequestMetadata(req);
    await audit({
      actorId: gate.user.id,
      actorRole: gate.user.role,
      eventType: AUDIT_EVENTS.CASE_STARTED,
      entityType: 'Case',
      entityId: result.caseId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      details: { templateId: caseTemplateId, conversationId: result.conversationId },
    });
    return jsonOk(result, { status: 201 });
  } catch (err) {
    if (err instanceof CasesError) {
      if (err.code === 'NOT_FOUND') return jsonError('NOT_FOUND', err.message, 404);
      if (err.code === 'FORBIDDEN') return jsonError('FORBIDDEN', err.message, 403);
      return jsonError('INVALID', err.message, 400);
    }
    return handleUnexpected(err);
  }
}
