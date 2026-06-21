import Link from "next/link";

const STEPS = [
  { path: "health", label: "Schedule health" },
  { path: "normalize", label: "Normalize activity names" },
  { path: "completeness", label: "Completeness" },
] as const;

export function WizardBanner({ projectId, step, why }: { projectId: string; step: 0 | 1 | 2; why: string }) {
  const prevPath = step > 0 ? STEPS[step - 1].path : null;
  const nextPath = step < STEPS.length - 1 ? STEPS[step + 1].path : null;

  return (
    <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm">
      <div className="mb-1 font-medium text-blue-900">
        First-time setup — step {step + 1} of {STEPS.length}: {STEPS[step].label}
      </div>
      <p className="mb-2 text-blue-800">{why}</p>
      <div className="flex gap-2">
        {prevPath && (
          <Link href={`/projects/${projectId}/${prevPath}?wizard=1`} className="rounded border border-blue-300 px-3 py-1.5 text-xs font-medium text-blue-900">
            Back
          </Link>
        )}
        {nextPath ? (
          <Link href={`/projects/${projectId}/${nextPath}?wizard=1`} className="rounded bg-blue-900 px-3 py-1.5 text-xs font-medium text-white">
            Next
          </Link>
        ) : (
          <form action={`/api/projects/${projectId}/complete-onboarding`} method="POST">
            <button type="submit" className="rounded bg-blue-900 px-3 py-1.5 text-xs font-medium text-white">
              Finish setup
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
