import {createHash} from 'node:crypto';

/** Tool-owned, reviewed wire contract. Schedule Manager mirrors this file byte for byte; never fetched from a tool response.
 * Schedule Manager-owned data only: the lookahead, what is due and late, and the open draft weekly update. No procurement
 * fields, no people and no free-text notes. Shaped so the weekly scheduling meeting can read it unchanged and write its
 * draft-update edits back on the same activity key. */
const integer=(minimum:number,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum,maximum});
const string=(minLength:number,maxLength:number)=>({type:'string',minLength,maxLength});
const nullable=(schema:unknown)=>({anyOf:[schema,{type:'null'}]});
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
// YYYY-MM-DD. The schema subset has no pattern; the tool rejects any other shape as invalid input.
const date=string(10,10),timestamp=string(1,40);
const status={type:'string',maxLength:11,enum:['not_started','in_progress','complete']};
const definition={
 id:'connect.schedule-manager.update_state.read',version:'1.0.0',ownerId:'tool.schedule-manager',toolSlug:'schedule-manager',
 title:'Read schedule update state',description:'The project\'s schedule lookahead as of a data date (default: the schedule\'s own data date, 1 week ahead): what is due and late, forecast dates and drift, and any open draft weekly update. Late and due work comes first. Schedule data only; no procurement or personal data.',
 effect:'read',mode:'read',dataMode:'live',minimumLevel:'viewer',
 inputSchema:object({projectId:integer(1),asOfDate:date,lookaheadWeeks:integer(1,6)},['projectId']),
 outputSchema:object({
  asOfDate:date,lookaheadWeeks:integer(1,6),
  // Null when no schedule is linked to this project or none has been imported yet; activities is then empty.
  scheduleImportedAt:nullable(timestamp),lastFinalizedAsOf:nullable(date),
  draftUpdate:nullable(object({asOfDate:date,lookaheadWeeks:integer(1,6),entryCount:integer(0),updatedAt:timestamp})),
  // Totals before truncation. Late: overdue or should have started. Due: incomplete work due by the data date.
  counts:object({lookahead:integer(0),due:integer(0),late:integer(0)}),
  // Sorted late, then due, then expectedStart. maxResultBytes caps the whole connect.tool.result/2 response body in
  // UTF-8, envelope included: activities are dropped from the end, never cut mid-record, and truncated is set, before
  // the body would exceed it.
  activities:{type:'array',maxItems:40,items:object({
   // key is canonicalActivityKey ("<wbs>|<normalized name>"), never shortened: draft edits are written back on it.
   // name may be shortened for display. An activity whose key is longer than 300 characters is left out.
   key:string(1,300),name:string(1,200),wbsCode:nullable(string(1,60)),isCritical:{type:'boolean'},isMilestone:{type:'boolean'},
   plannedStart:nullable(date),plannedFinish:nullable(date),expectedStart:nullable(date),expectedFinish:nullable(date),driftDays:integer(-10000,10000),
   status,percentComplete:nullable(integer(0,100)),
   slippage:{type:'string',maxLength:19,enum:['overdue','should-have-started','on-track']},dueByDataDate:{type:'boolean'},
   // This activity's entry in the open draft update, if it has one.
   draft:nullable(object({status,percentComplete:nullable(integer(0,100)),actualStart:nullable(date),actualFinish:nullable(date)})),
  })},
  truncated:{type:'boolean'},
 }),
 limits:{maxInputBytes:256,maxResultBytes:8000},
};
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export const scheduleUpdateStateContract=freeze(definition);
export const scheduleUpdateStateContractHash=createHash('sha256').update(JSON.stringify(scheduleUpdateStateContract)).digest('hex');
