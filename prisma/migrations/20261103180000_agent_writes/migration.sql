-- Connect agent draft writes (connect.tool.write/1): one row per saved write, keyed by the agent's idempotency key.
CREATE TABLE "AgentWrite" (
    "id" TEXT NOT NULL,
    "personId" INTEGER NOT NULL,
    "agentId" TEXT NOT NULL,
    "clientKey" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "progressUpdateId" TEXT NOT NULL,
    "fromAsOfDate" TIMESTAMP(3),
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentWrite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentWrite_personId_agentId_idempotencyKey_key" ON "AgentWrite"("personId", "agentId", "idempotencyKey");
CREATE INDEX "AgentWrite_progressUpdateId_idx" ON "AgentWrite"("progressUpdateId");

ALTER TABLE "AgentWrite" ADD CONSTRAINT "AgentWrite_progressUpdateId_fkey" FOREIGN KEY ("progressUpdateId") REFERENCES "ProgressUpdate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
