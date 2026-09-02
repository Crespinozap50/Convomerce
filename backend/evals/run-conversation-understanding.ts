import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DeterministicUnderstandingProvider } from '../src/conversation-understanding/deterministic-understanding.provider';
import { ConversationLocale } from '../src/localization/localization';

type Expected={intent:string;requestedAction:string|null;entities?:Record<string,unknown>;requiredEntities?:string[];searchTerms?:string[];requiresHuman:boolean};
type EvaluationCase={id:string;locale:ConversationLocale;message:string;interactiveSelectionId?:string;expected:Expected};
type Conversation={id:string;locale:ConversationLocale;turns:Array<Omit<EvaluationCase,'id'|'locale'>&{id:string}>};
type Suite={suite:string;minimumScore:number;cases?:EvaluationCase[];conversations?:Conversation[]};

async function main():Promise<number>{
  const suiteFiles=['conversation-understanding.json','conversation-multiturn.json'];
  const suites=suiteFiles.map(file=>JSON.parse(readFileSync(join(__dirname,file),'utf8')) as Suite);
  const provider=new DeterministicUnderstandingProvider();
  const failures:string[]=[];
  const localeTotals=new Map<string,{passed:number;total:number}>();
  const cases=suites.flatMap(suite=>[...(suite.cases??[]),...(suite.conversations??[]).flatMap(conversation=>conversation.turns.map(turn=>({...turn,id:`${conversation.id}/${turn.id}`,locale:conversation.locale})))]);
  for(const testCase of cases){
    const result=await provider.understand({message:testCase.message,configuredLocale:testCase.locale,handoffKeywords:testCase.locale==='es'?['asesor','humano','persona']:['agent','human','person'],timezone:'America/Bogota',interactiveSelectionId:testCase.interactiveSelectionId});
    const differences:string[]=[];
    if(result.intent!==testCase.expected.intent)differences.push(`intent=${result.intent}`);
    if(result.requestedAction!==testCase.expected.requestedAction)differences.push(`requestedAction=${String(result.requestedAction)}`);
    if(result.requiresHuman!==testCase.expected.requiresHuman)differences.push(`requiresHuman=${result.requiresHuman}`);
    for(const [key,value] of Object.entries(testCase.expected.entities??{}))if(JSON.stringify(result.entities[key])!==JSON.stringify(value))differences.push(`entities.${key}=${JSON.stringify(result.entities[key])}`);
    for(const key of testCase.expected.requiredEntities??[])if(result.entities[key]===undefined)differences.push(`missing entity=${key}`);
    const terms=Array.isArray(result.entities.searchTerms)?result.entities.searchTerms:[];
    for(const term of testCase.expected.searchTerms??[])if(!terms.includes(term))differences.push(`missing search term=${term}`);
    const totals=localeTotals.get(testCase.locale)??{passed:0,total:0};totals.total+=1;
    if(differences.length)failures.push(`${testCase.id}: ${differences.join(', ')}`);else totals.passed+=1;
    localeTotals.set(testCase.locale,totals);
  }
  const passed=cases.length-failures.length,score=passed/cases.length;
  const localeScores=Object.fromEntries([...localeTotals].map(([locale,value])=>[locale,Number((value.passed/value.total).toFixed(4))]));
  process.stdout.write(`${JSON.stringify({suites:suites.map(suite=>suite.suite),passed,total:cases.length,score:Number(score.toFixed(4)),localeScores,failures},null,2)}\n`);
  const minimumScore=Math.max(...suites.map(suite=>suite.minimumScore));
  return score<minimumScore||Object.values(localeScores).some(localeScore=>localeScore<minimumScore)?1:0;
}

void main().then(code=>process.exit(code)).catch(error=>{process.stderr.write(`${error instanceof Error?error.stack:String(error)}\n`);process.exit(1);});
