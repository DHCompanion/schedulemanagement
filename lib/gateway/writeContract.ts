import {createHash} from 'node:crypto';

/** Tool-owned, reviewed wire contract for Connect's agent draft write (connect.tool.write/1). Connect mirrors this file
 * byte for byte; never fetched from a tool response. The agent fills the project's open draft weekly update from what
 * the person told it; a person still reviews and finalizes the update in Schedule Manager. No notes, forecasts or people. */
const integer=(minimum:number,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum,maximum});
const string=(minLength:number,maxLength:number)=>({type:'string',minLength,maxLength});
const nullable=(schema:unknown)=>({anyOf:[schema,{type:'null'}]});
const object=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
// YYYY-MM-DD. The schema subset has no pattern; the tool refuses any other shape as invalid.
const date=string(10,10);
const status={type:'string',maxLength:11,enum:['not_started','in_progress','complete']};
const progress={status,percentComplete:nullable(integer(0,100)),actualStart:nullable(date),actualFinish:nullable(date)};
const definition={
 id:'connect.schedule-manager.update_draft.write',version:'1.0.0',ownerId:'tool.schedule-manager',toolSlug:'schedule-manager',
 title:'Save schedule progress to the draft update',description:'Save activity progress the person gave you into the project\'s open draft weekly update, creating the draft or moving its data date if asked. Send back the draft values you read so newer edits are never overwritten. A person reviews and finalizes the update in Schedule Manager.',
 effect:'write',mode:'standing',dataMode:'live',minimumLevel:'user',
 inputSchema:object({
  projectId:integer(1),
  idempotencyKey:{type:'string',minLength:8,maxLength:100},
  // The update's data date. Omitted: the open draft's date, or the schedule's own data date for a new draft.
  asOfDate:date,
  // draftUpdate.asOfDate from the update state read, or null when it showed no draft. A mismatch refuses the save.
  expectedDraftAsOfDate:nullable(date),
  // At most 15 activities per call; a larger update is several calls. An empty list only sets the data date.
  entries:{type:'array',maxItems:15,items:object({
   // The activity's key from the update state read, unchanged.
   key:string(1,300),...progress,
   // That activity's draft from the same read, or null when it had none. A mismatch refuses the whole save.
   expectedDraft:nullable(object(progress)),
  })},
 },['projectId','idempotencyKey','expectedDraftAsOfDate','entries']),
 outputSchema:object({
  saved:{type:'boolean'},
  // The draft's data date after the save; null when nothing was saved and no draft exists.
  asOfDate:nullable(date),
  // Keys saved, or the keys that caused a refusal.
  activities:{type:'array',maxItems:15,items:string(1,300)},
  reason:nullable({type:'string',maxLength:11,enum:['stale','invalid','finalized','no_schedule']}),
  // What to tell the person when saved is false.
  message:nullable(string(1,1000)),
 }),
 limits:{maxInputBytes:2048,maxResultBytes:8000},
};
function freeze<T>(value:T):T {if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export const scheduleDraftWriteContract=freeze(definition);
export const scheduleDraftWriteContractHash=createHash('sha256').update(JSON.stringify(scheduleDraftWriteContract)).digest('hex');
