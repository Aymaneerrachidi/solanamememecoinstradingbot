export type Tier = "S" | "A" | "B";

export interface KolRecord {
  wallet: string;
  name: string;
  pnl: number;
  winRate: number;
  rank: number;
  tier: Tier;
  updatedAt: number;
}

export interface BuyEvent {
  kolWallet: string;
  tier: Tier;
  tokenMint: string;
  ts: number; // unix ms
  signature: string;
}

export interface SafetyStats {
  liquidityUsd: number;
  lpBurnedOrLocked: boolean;
  mintAuthorityRevoked: boolean;
  freezeAuthorityRevoked: boolean;
  top10HolderPct: number; // 0-100
  volume24hUsd: number;
  ageMinutes: number;
  holderCount: number;
}

export interface SafetyResult {
  pass: boolean;
  failedGates: string[];
  stats: SafetyStats;
}
