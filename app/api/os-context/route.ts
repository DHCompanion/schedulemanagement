import { CALLBACK_SIGNATURE_HEADER, verifyContextCallback } from "@/lib/os-context/verifyCallback";
import { SCHEDULE_PACKET_TYPE, buildScheduleContextPacket } from "@/lib/os-context/scheduleContextPacket";

// POST /<BASE_PATH>/api/os-context — the OS manifest's launch.contextEndpoint.
//
// Called by Skiles Connect server-to-server on another tool's behalf, never by a
// browser: it carries an HMAC header, not a session cookie, so middleware must
// let it through (PUBLIC_PATHS) or every call redirects to /login and the OS
// reports the tool unreachable.
//
// The OS has already authorized the requesting tool, the person, the project,
// and the packet's sensitivity before calling. Nothing here re-decides that.
export async function POST(request: Request) {
  // Raw bytes, before any parse — the signature covers exactly what was sent.
  const rawBody = await request.text();
  const verification = verifyContextCallback(rawBody, request.headers.get(CALLBACK_SIGNATURE_HEADER));

  if (!verification.ok) {
    // The specific reason is logged, never returned — see REJECTED in verifyCallback.
    console.error("[schedule-manager/os-context] rejected:", verification.reason);
    return Response.json({ error: verification.message }, { status: verification.status });
  }

  const { limit, packetType, projectId } = verification.payload;

  if (packetType !== SCHEDULE_PACKET_TYPE) {
    return Response.json({ error: `Unknown packetType ${packetType}.` }, { status: 400 });
  }

  const packet = await buildScheduleContextPacket(projectId, limit);
  return Response.json(packet);
}
