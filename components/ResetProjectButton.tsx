"use client";

import { appPath } from "@/lib/http";

export function ResetProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  return (
    <form
      action={appPath(`/api/projects/${projectId}/reset`)}
      method="POST"
      onSubmit={(e) => {
        if (
          !confirm(
            `Delete every imported schedule, progress update and review decision for "${projectName}"?\n\nThe project itself stays, and setup starts over from the import. This cannot be undone.`
          )
        ) {
          e.preventDefault();
        }
      }}
    >
      <button type="submit" className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
        Reset schedule data
      </button>
    </form>
  );
}
