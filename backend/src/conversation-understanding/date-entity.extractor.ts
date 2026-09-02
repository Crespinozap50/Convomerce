import { matchesConversationRule, mergedLanguageMap } from '../localization/conversation-copy';

export function extractRequestedDate(message:string,timezone:string,now=new Date()):string|null{
  const text=message.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9\s/-]/g,' ').replace(/\s+/g,' ').trim();
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get=(type:string)=>Number(parts.find(part=>part.type===type)?.value);
  const today=new Date(Date.UTC(get('year'),get('month')-1,get('day')));
  const relative=matchesConversationRule(text,'tomorrow')?1:matchesConversationRule(text,'today')?0:null;
  if(relative!==null){today.setUTCDate(today.getUTCDate()+relative);return today.toISOString().slice(0,10);}
  const iso=text.match(/\b(20\d{2})[-/]([01]?\d)[-/]([0-3]?\d)\b/);
  if(iso)return validFutureDate(Number(iso[1]),Number(iso[2]),Number(iso[3]),today);
  const numeric=text.match(/\b([0-3]?\d)[/]([01]?\d)(?:[/](20\d{2}))?\b/);
  if(numeric)return validFutureDate(Number(numeric[3]??today.getUTCFullYear()),Number(numeric[2]),Number(numeric[1]),today);
  const months=mergedLanguageMap('months');
  const named=text.match(/\b([0-3]?\d)(?:\s+de)?\s+([a-z]+)(?:\s+(?:de\s+)?(20\d{2}))?\b/);
  if(named&&months[named[2]]){
    const year=Number(named[3]??today.getUTCFullYear());
    let value=validFutureDate(year,months[named[2]],Number(named[1]),today);
    if(!named[3]&&!value)value=validFutureDate(year+1,months[named[2]],Number(named[1]),today);
    return value;
  }
  const monthFirst=text.match(/\b([a-z]+)\s+([0-3]?\d)(?:\s+(20\d{2}))?\b/);
  if(monthFirst&&months[monthFirst[1]]){
    const year=Number(monthFirst[3]??today.getUTCFullYear());
    let value=validFutureDate(year,months[monthFirst[1]],Number(monthFirst[2]),today);
    if(!monthFirst[3]&&!value)value=validFutureDate(year+1,months[monthFirst[1]],Number(monthFirst[2]),today);
    return value;
  }
  const weekdays=mergedLanguageMap('weekdays');
  const weekday=Object.keys(weekdays).find(name=>new RegExp(`\\b${name}\\b`).test(text));
  if(weekday){let days=(weekdays[weekday]-today.getUTCDay()+7)%7;if(days===0)days=7;today.setUTCDate(today.getUTCDate()+days);return today.toISOString().slice(0,10);}
  return null;
}

function validFutureDate(year:number,month:number,day:number,today:Date):string|null{
  const value=new Date(Date.UTC(year,month-1,day));
  if(value.getUTCFullYear()!==year||value.getUTCMonth()!==month-1||value.getUTCDate()!==day||value<today)return null;
  const maximum=new Date(today);maximum.setUTCDate(maximum.getUTCDate()+90);
  return value<=maximum?value.toISOString().slice(0,10):null;
}
