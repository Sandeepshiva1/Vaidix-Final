// W5 — revoke a recording share
import {
  jsonOk,
  requireAuth,
  handleUnexpected,
} from '@/server/services/api-helpers';
import {
  revokeShare,
  RecordingShareError,
} from '@/server/services/recordings/recording-share-service';
import { mapRecordingShareError } from '../route';

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; shareId: string }> }
) {
  try {
    const gate = await requireAuth();
    if (!gate.ok) return gate.response;
    const { shareId } = await ctx.params;
    await revokeShare({ userId: gate.user.id, role: gate.user.role }, shareId);
    return jsonOk({ revoked: true });
  } catch (err) {
    if (err instanceof RecordingShareError) {
      const mapped = mapRecordingShareError(err);
      if (mapped) return mapped;
    }
    return handleUnexpected(err);
  }
}
