import { redirect } from "next/navigation";

// Trades now lives on the Data Health tab (redesign phase 2).
export default async function TradesPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  redirect(`/projects/${id}/data`);
}
