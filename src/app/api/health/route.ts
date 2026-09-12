export function GET() {
  return Response.json({ service: "hermes-payments", status: "ok", chainId: 42161 });
}
