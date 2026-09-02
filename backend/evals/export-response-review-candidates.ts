import { writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { validate as isUuid } from 'uuid';

const [tenantId,outputPath,rawLimit='50']=process.argv.slice(2);
if(!tenantId||!isUuid(tenantId)||!outputPath)throw new Error('Usage: export-response-review-candidates <tenant-id> <output.json> [limit]');
const limit=Number(rawLimit);if(!Number.isInteger(limit)||limit<1||limit>500)throw new Error('limit must be an integer between 1 and 500');
const connectionString=process.env.DATABASE_URL;if(!connectionString)throw new Error('DATABASE_URL is required');
const pool=new Pool({connectionString});

async function main(){
  const result=await pool.query<{id:string;locale:string;body:string;deterministic_body:string;protected_facts:unknown;context:unknown}>(
    `select outbound.id::text,
            coalesce(outbound.content#>>'{decision,locale}','en') locale,
            outbound.content->>'body' body,
            outbound.content#>>'{decision,rewriting,deterministicBody}' deterministic_body,
            coalesce(outbound.content#>'{decision,rewriting,protectedFacts}','[]'::jsonb) protected_facts,
            coalesce(context.messages,'[]'::jsonb) context
       from app.messages outbound
       left join lateral(
         select jsonb_agg(history.content->>'body' order by history.occurred_at,history.id) messages
           from(
             select previous.id,previous.content,previous.occurred_at
               from app.messages previous
              where previous.tenant_id=outbound.tenant_id
                and previous.conversation_id=outbound.conversation_id
                and (previous.occurred_at,previous.id)<(outbound.occurred_at,outbound.id)
              order by previous.occurred_at desc,previous.id desc limit 3
           ) history
       ) context on true
      where outbound.tenant_id=$1
        and outbound.direction='outbound'
        and outbound.content#>>'{decision,rewriting,mode}'='openai'
        and outbound.content#>>'{decision,rewriting,deterministicBody}' is not null
      order by outbound.occurred_at desc,outbound.id desc limit $2`,[tenantId,limit]);
  const scenarios=result.rows.map(row=>({id:row.id,locale:row.locale,context:Array.isArray(row.context)?row.context:[],protectedFacts:Array.isArray(row.protected_facts)?row.protected_facts:[],candidates:[{source:'deterministic',body:row.deterministic_body},{source:'challenger',body:row.body}]}));
  writeFileSync(outputPath,`${JSON.stringify(scenarios,null,2)}\n`,{mode:0o600});
  process.stdout.write(`${JSON.stringify({tenantId,exported:scenarios.length,outputPath})}\n`);
}

void main().then(()=>pool.end()).catch(async error=>{await pool.end();process.stderr.write(`${error instanceof Error?error.stack:String(error)}\n`);process.exitCode=1;});
