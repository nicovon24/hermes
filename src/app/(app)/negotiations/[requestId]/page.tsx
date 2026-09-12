export default async function NegotiationDetailPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  return <div>Negotiation {requestId}</div>;
}
