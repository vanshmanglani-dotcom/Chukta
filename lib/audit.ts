import { db } from './db';

/** Append-only audit trail. Never throws: auditing must not break the main action. */
export async function audit(
  orgId: string | null,
  actor: string,
  action: string,
  entity?: string,
  entityId?: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db()`
      INSERT INTO audit_log (org_id, actor, action, entity, entity_id, meta)
      VALUES (${orgId}, ${actor}, ${action}, ${entity ?? null}, ${entityId ?? null}, ${JSON.stringify(meta)}::jsonb)`;
  } catch (err) {
    console.error('audit failed', action, err);
  }
}
