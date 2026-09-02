import { createHash } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';

type Candidate={source:'deterministic'|'challenger';body:string};
type Scenario={id:string;locale:string;context:string[];protectedFacts:string[];candidates:[Candidate,Candidate]};

const [inputPath,packPath,keyPath]=process.argv.slice(2);
if(!inputPath||!packPath||!keyPath)throw new Error('Usage: prepare-blind-review <input.json> <pack.json> <key.json>');
const scenarios=JSON.parse(readFileSync(inputPath,'utf8')) as Scenario[];
const pack:unknown[]=[],key:unknown[]=[];
const scenarioIds = new Set<string>();
for(const scenario of scenarios){
  if (scenarioIds.has(scenario.id)) throw new Error(`Duplicate scenario id: ${scenario.id}`);
  scenarioIds.add(scenario.id);
  if(scenario.candidates.length!==2)throw new Error(`${scenario.id} must contain exactly two candidates`);
  if (new Set(scenario.candidates.map(candidate => candidate.source)).size !== 2) {
    throw new Error(`${scenario.id} must contain one deterministic and one challenger candidate`);
  }
  for (const fact of scenario.protectedFacts) {
    for (const candidate of scenario.candidates) {
      if (!candidate.body.includes(fact)) {
        throw new Error(`${scenario.id} is missing protected fact "${fact}" in ${candidate.source}`);
      }
    }
  }
  const swap=createHash('sha256').update(scenario.id).digest()[0]%2===1;
  const [a,b]=swap?[scenario.candidates[1],scenario.candidates[0]]:scenario.candidates;
  pack.push({scenarioId:scenario.id,locale:scenario.locale,context:scenario.context,protectedFacts:scenario.protectedFacts,responseA:a.body,responseB:b.body,ratings:{factualPassA:null,factualPassB:null,naturalnessA:null,naturalnessB:null,warmthA:null,warmthB:null,concisenessA:null,concisenessB:null,continuityA:null,continuityB:null,culturalFitA:null,culturalFitB:null,notes:''}});
  key.push({scenarioId:scenario.id,responseA:a.source,responseB:b.source});
}
writeFileSync(packPath,`${JSON.stringify(pack,null,2)}\n`, { mode: 0o600 });
writeFileSync(keyPath,`${JSON.stringify(key,null,2)}\n`, { mode: 0o600 });
chmodSync(packPath, 0o600);
chmodSync(keyPath, 0o600);
