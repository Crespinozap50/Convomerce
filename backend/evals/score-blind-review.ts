import { readFileSync } from 'node:fs';

type Rating={scenarioId:string;factualPassA:boolean;factualPassB:boolean;naturalnessA:number;naturalnessB:number;warmthA:number;warmthB:number;concisenessA:number;concisenessB:number;continuityA:number;continuityB:number;culturalFitA:number;culturalFitB:number};
type Key={scenarioId:string;responseA:'deterministic'|'challenger';responseB:'deterministic'|'challenger'};
const [ratingsPath,keyPath]=process.argv.slice(2);
if(!ratingsPath||!keyPath)throw new Error('Usage: score-blind-review <completed-pack.json> <key.json>');
const ratings=JSON.parse(readFileSync(ratingsPath,'utf8')) as Rating[],keys=JSON.parse(readFileSync(keyPath,'utf8')) as Key[];
const keyById=new Map(keys.map(key=>[key.scenarioId,key]));
const totals={deterministic:{eligible:0,wins:0,score:0,factualFailures:0},challenger:{eligible:0,wins:0,score:0,factualFailures:0},ties:0};
for(const rating of ratings){
  const key=keyById.get(rating.scenarioId);if(!key)throw new Error(`Missing answer key for ${rating.scenarioId}`);
  if(typeof rating.factualPassA!=='boolean'||typeof rating.factualPassB!=='boolean')throw new Error(`${rating.scenarioId} requires factual pass ratings for A and B`);
  for(const dimension of ['naturalness','warmth','conciseness','continuity','culturalFit'] as const)for(const side of ['A','B'] as const){const value=rating[`${dimension}${side}`];if(!Number.isInteger(value)||value<1||value>5)throw new Error(`${rating.scenarioId} ${dimension}${side} must be an integer from 1 to 5`);}
  const score=(side:'A'|'B')=>['naturalness','warmth','conciseness','continuity','culturalFit'].reduce((sum,dimension)=>sum+Number(rating[`${dimension}${side}` as keyof Rating]),0)/5;
  const values={A:{source:key.responseA,pass:rating.factualPassA,score:score('A')},B:{source:key.responseB,pass:rating.factualPassB,score:score('B')}} as const;
  for(const value of Object.values(values)){if(!value.pass)totals[value.source].factualFailures+=1;else{totals[value.source].eligible+=1;totals[value.source].score+=value.score;}}
  if(!values.A.pass&&!values.B.pass)totals.ties+=1;
  else if(values.A.pass&&!values.B.pass)totals[values.A.source].wins+=1;
  else if(values.B.pass&&!values.A.pass)totals[values.B.source].wins+=1;
  else if(values.A.score===values.B.score)totals.ties+=1;
  else totals[values.A.score>values.B.score?values.A.source:values.B.source].wins+=1;
}
process.stdout.write(`${JSON.stringify({scenarios:ratings.length,deterministic:{...totals.deterministic,averageScore:totals.deterministic.eligible?Number((totals.deterministic.score/totals.deterministic.eligible).toFixed(3)):null},challenger:{...totals.challenger,averageScore:totals.challenger.eligible?Number((totals.challenger.score/totals.challenger.eligible).toFixed(3)):null},ties:totals.ties},null,2)}\n`);
