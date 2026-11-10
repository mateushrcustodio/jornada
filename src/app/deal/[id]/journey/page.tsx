import { notFound } from "next/navigation";
import { Journey } from "@/components/journey";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!/^[1-9]\d{0,9}$/.test(id)) notFound();
  return <Journey id={Number(id)} />;
}
