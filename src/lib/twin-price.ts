import "server-only";

const TWIN_PRICE_URL = "https://api.belo.app/public/price";

type TwinPrice = { pairCode?: string; bid?: string; ask?: string };

export async function getUsdcArgtBid(): Promise<string> {
  const response = await fetch(TWIN_PRICE_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Twin price API returned ${response.status}`);
  const prices = (await response.json()) as TwinPrice[];
  const pair = prices.find((price) => price.pairCode === "USDC/ARGt");
  if (!pair?.bid || !Number.isFinite(Number(pair.bid)) || Number(pair.bid) <= 0) {
    throw new Error("Twin price for USDC/ARGt is unavailable");
  }
  return pair.bid;
}
