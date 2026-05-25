import { Connection, PublicKey } from "@solana/web3.js";

export interface OnchainData {
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  top10HolderPct: number;
  holderCount: number;
}

export async function fetchOnchainData(
  conn: Connection,
  tokenMint: string
): Promise<OnchainData> {
  const mint = new PublicKey(tokenMint);

  const supplyResp = await conn.getTokenSupply(mint);
  const totalSupply = Number(supplyResp.value.amount);

  // Parsed mint account exposes mintAuthority / freezeAuthority (null when revoked).
  const info = await conn.getParsedAccountInfo(mint);
  const parsed =
    (info.value?.data as { parsed?: { info?: Record<string, unknown> } })?.parsed?.info ?? {};
  const mintAuthorityRevoked = parsed.mintAuthority == null;
  const freezeAuthorityRevoked = parsed.freezeAuthority == null;

  const largest = await conn.getTokenLargestAccounts(mint);
  const top10 = largest.value.slice(0, 10);
  const top10Amount = top10.reduce((sum, a) => sum + Number(a.amount), 0);
  const top10HolderPct = totalSupply > 0 ? (top10Amount / totalSupply) * 100 : 100;

  return {
    mintAuthorityRevoked,
    freezeAuthorityRevoked,
    top10HolderPct,
    holderCount: largest.value.length,
  };
}
