import { redirect } from "next/navigation";

// Task Granularity now lives on the Data Health tab (redesign phase 2).
export default async function CompletenessPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  redirect(`/projects/${id}/data`);
}
