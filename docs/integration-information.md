# Tool Gateway Integration Information

> Slug corrected to `schedule-manager` throughout — that is the identity registered
> in the OS module registry, and slugs are immutable once shipped.

This document describes how the Skiles Group Connect OS handles project scoping and data access for integrated external tools like Schedule Management.

## How Project Access Works

The OS does not expose a "list available projects" API. Instead, **the OS launches your tool with a project-specific, signed Bearer token** that automatically scopes all your data access to a single project.

### Launch Flow

1. **OS initiates tool launch** with your tool slug, person ID, and project ID
2. **OS returns a signed Bearer token** that encodes:
   - `toolSlug`: Your tool's identifier (e.g., `"schedule-manager"`)
   - `personId`: The authenticated user launching the tool
   - `projectId`: The single project your tool is scoped to
   - `osCapabilities`: What OS features you can access (tasks, activity_events, context_packets, etc.)
   - Issue and expiration timestamps (15-minute TTL by default)
3. **Your tool stores this token** and includes it in every request to the OS as a Bearer token

### Project Scoping Is Automatic

Every request you make to the OS using your Bearer token is **automatically scoped to the one project encoded in that token**. You do not need to:
- Parse the token yourself
- Query for available projects
- Manually scope requests

Examples of OS endpoints your tool can call (when permitted by `osCapabilities`):

- `GET /api/tool-gateway/project-context` — returns only your scoped project's metadata (name, location, client, status) plus your person context
- `POST /api/tool-gateway/task-requests` — creates tasks in your scoped project
- `POST /api/tool-gateway/activity-events` — publishes activity to your scoped project's activity stream
- `POST /api/tool-gateway/context-requests` — requests summary packets from other tools scoped to your project

The OS re-validates on every request:
- Your tool is still registered and enabled
- The person is still active
- The project still exists
- The person still has active access to that project

### Multi-Project Scenarios

If your tool needs to operate across multiple projects (e.g., a superintendent reviewing multiple sites), the OS issues **separate tokens for each project**. Your tool would maintain multiple active tokens and switch between them based on user navigation.

## Required Integration Points

### 1. Read the Tool Integration Contract

See `docs/tool-integration/TOOL_INTEGRATION_CONTRACT.md` in the main Skiles Group Connect repo for:
- Manifest fields your tool must declare (integrationMode, osCapabilities, contextDependencies, contextExposures, dailyReportPolicy)
- Detailed endpoint documentation (launch-sessions, project-context, task-requests, activity-events, context-requests)
- Forbidden patterns (direct DB access, calling other tools, raw telemetry)

### 2. Token Handling

Store the Bearer token issued at launch and include it in every request:

```
Authorization: Bearer <your-signed-token>
```

Do not attempt to parse or validate the token yourself — the OS validates it on your behalf on each request.

### 3. Project Context

When your tool initializes, call:

```
GET /api/tool-gateway/project-context
Authorization: Bearer <token>
```

This returns (scoped to your project):
- `project.id`, `project.name`, `project.projectNumber`, `project.location`, `project.client`, `project.status`
- `person.id`, `person.displayName`, `person.roleTitle`, `person.roleProfile`
- `access.accessRole` (e.g., "Superintendent", "Project Manager", "project team")
- `session` metadata (toolSlug, personId, projectId, osCapabilities, expiresAt)

### 4. Linking Your Records to the OS

Every record your tool saves must include OS linkage for routing, auditing, and cross-tool context:

- `projectId`: The OS project ID (from your token or project-context response)
- `personId`: The person who performed the action (from your project-context response)
- `sourceTool`: Your tool slug (e.g., `"schedule-manager"`)
- `sourceToolRecordId`: Your tool's own unique record ID (do not use OS-generated IDs)
- `createdAt`, `updatedAt`: ISO 8601 timestamps
- `visibility` or `sensitivity`: Scope level for shared context (project_team, manager_only, admin_only)

Example: when you save a scheduling constraint, store with your OS record:
```json
{
  "id": "constraint-12345",  // your tool's ID
  "projectId": 1,            // from token
  "personId": 4,             // from token
  "sourceTool": "schedule-manager",
  "title": "Crane availability limited",
  "createdAt": "2026-06-20T10:30:00Z",
  "visibility": "project_team"
}
```

### 5. Publishing Activity and Requests

When your tool completes significant actions, publish them to the OS:

**Task requests** (if you have `tasks` in osCapabilities):
```
POST /api/tool-gateway/task-requests
Authorization: Bearer <token>

{
  "sourceRecordId": "constraint-12345",
  "title": "Resolve crane availability issue",
  "priority": "High",
  "owner": "Project Superintendent",
  "dueDate": "2026-06-22",
  "notes": "Requested by Schedule Management tool"
}
```

**Activity events** (if you have `activity_events` in osCapabilities):
```
POST /api/tool-gateway/activity-events
Authorization: Bearer <token>

{
  "sourceRecordId": "constraint-12345",
  "eventType": "SCHEDULE_CONSTRAINT_CREATED",
  "summary": "Crane availability constraint logged",
  "payload": { "constraintType": "equipment", "severity": "high" },
  "dailyLogRelevance": "candidate",
  "importance": "high"
}
```

### 6. Requesting Context from Other Tools

If you need to show summary data from other tools (e.g., QA/QC observations affecting your schedule):

```
POST /api/tool-gateway/context-requests
Authorization: Bearer <token>

{
  "target": "qaqc",
  "packetType": "qaqc_project_summary",
  "limit": 10
}
```

The OS enforces:
- Your manifest declares this dependency in `contextDependencies`
- The target tool exposes this packet type in `contextExposures`
- Your access role meets the packet's sensitivity requirement (project_team / manager_only / admin_only)

Returns a summary packet scoped to your project, person, and access level — not raw data.

## Hard Rules

**Your tool must not:**
- Connect to the OS database directly
- Read another tool's database tables or private APIs
- Exchange records with another tool outside the OS (all cross-tool communication routes through OS context packets)
- Store or send unencrypted project data outside the secure context of a valid, current Bearer token
- Treat the Activity Stream as raw telemetry (activity events are project-scoped, sensitive records)

**The OS guarantees:**
- Every request is scoped to one project
- Every request re-validates your tool, the person, and their project access
- Context packets are summaries only, not raw table dumps
- Cross-tool requests are mediated and permission-checked
- Token expiration (15 minutes) forces periodic re-authorization

## Example: Scheduling Tool Workflow

1. **Launch**: User launches your tool for Project 5 → OS issues token scoped to tool=`schedule-manager`, person=4, project=5
2. **Initialize**: Your tool calls `GET /api/tool-gateway/project-context` → receives project metadata (name: "Downtown Hospital Renovation", location: "Boston, MA")
3. **Query constraints**: Your tool calls `POST /api/tool-gateway/context-requests { target: "qaqc", packetType: "qaqc_project_summary" }` → receives summary of active QA/QC items that might block your schedule
4. **Save a constraint**: Your tool saves `{ id: "sch-98765", projectId: 5, personId: 4, sourceTool: "schedule-manager", title: "Elevator delivery delayed" }`
5. **Publish activity**: Your tool calls `POST /api/tool-gateway/activity-events` → OS logs to Project 5's activity stream
6. **Request task**: Your tool calls `POST /api/tool-gateway/task-requests` → OS creates a task in Project 5

All requests use the same Bearer token; all operations are scoped to Project 5 and Person 4's access level.

## Token Security

Tokens are:
- **Signed**: HMAC-SHA256 using `SKILES_TOOL_GATEWAY_SECRET` (configured on the OS side)
- **Stateless**: No database lookup needed; OS validates signature + payload integrity + expiration + field constraints
- **Short-lived**: 15-minute default TTL; your tool must refresh by re-launching when expired
- **Scoped**: Each token encodes exactly one tool/person/project combo; cannot be reused across projects or people

If a person's access to a project is revoked, their existing tokens become invalid immediately (OS checks `person_project_access` table on each request).

---

For implementation details and manifest fields, see the main Skiles Group Connect repo:
- `docs/tool-integration/TOOL_INTEGRATION_CONTRACT.md` — full endpoint reference and manifest spec
- `backend/src/core/toolGateway/toolGatewayToken.ts` — token structure and validation
- `backend/src/core/toolGateway/toolGatewayService.ts` — launch and authentication logic
