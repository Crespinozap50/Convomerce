import { PoolClient } from "pg";

// The single shared write both CommercialFlowService and
// AppointmentFlowService use to advance a conversation_workflows row —
// previously a byte-identical private method in both files.
export function stepWorkflow(
  client: PoolClient,
  id: string,
  step: string,
  context: Record<string, unknown>,
) {
  return client.query(
    `update app.conversation_workflows set step=$2,context=$3::jsonb,updated_at=now() where id=$1`,
    [id, step, JSON.stringify(context)],
  );
}
