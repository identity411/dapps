/**
 * E1 — build the gas / fee / break-even dataset and charts.
 *
 * Inputs:
 *   experiments/e1/local-gas.json   (from npm run e1:gas)
 *   experiments/e1/sepolia-smoke.json (existing Sepolia smoke run)
 *
 * Outputs:
 *   experiments/e1/sepolia-gas.csv
 *   experiments/e1/fee-comparison.csv
 *   experiments/e1/summary.json
 *   experiments/e1/gas-by-operation.svg
 *   experiments/e1/fee-breakeven.svg
 *
 * The SVGs are pure XML so the pipeline has no chart-tool dependency. On macOS
 * they can be rasterized with:
 *   qlmanage -t -s 1600 -o experiments/e1 experiments/e1/gas-by-operation.svg
 *
 * Assumptions are explicit: ETH price is an illustration (test ETH has no real
 * value), gas-price scenarios are scenario analysis, and platform fee tiers
 * 1% / 2.5% / 5% are hypothetical. Competitor rates are sourced separately.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "experiments", "e1");

const ETH_USD = Number(process.env.E1_ETH_USD || "3000");
const SCENARIO_GWEI = [1, 10, 50];
const HAPPY_PATH = ["createListing", "buy", "markOfferSent", "confirmReceipt"];
const FEE_TIERS = [1, 2.5, 5];
const OPERATIONS = [
  "createListing",
  "buy",
  "markOfferSent",
  "confirmReceipt",
  "claimAccepted",
  "finalizeClaim",
  "expireOrder",
  "cancelListing",
  "openDispute",
  "resolveDispute",
  "withdraw",
];

interface LocalRow {
  operation: string;
  scenario: string;
  gasUsed: string;
  gasPriceWei: string;
  feeWei: string;
  txHash: string;
  notes: string;
}

interface LocalJson {
  network: string;
  chainId: number;
  contract: string;
  date: string;
  codeCommit: string;
  gasPriceWei: string;
  rows: LocalRow[];
}

interface SepTx {
  step: string;
  txHash: string;
  blockNumber: number;
  gasUsed: string;
  gasPrice: string;
  feeWei: string;
}

interface SepJson {
  generatedAt: string;
  network: string;
  chainId: number;
  contract: string;
  deploymentBlock: number;
  priceWei: string;
  bondWei: string;
  transactions: SepTx[];
}

interface SepCompletionJson {
  generatedAt: string;
  network: string;
  chainId: number;
  contract: string;
  deploymentBlock: number | null;
  priceWei: string;
  bondWei: string;
  windows: { offerWindow: number; challengeWindow: number; deliveryWindow: number };
  transactions: SepTx[];
  listingIds?: Record<string, string>;
  note?: string;
}

interface GasPoint {
  operation: string;
  gasUsed: number;
  gasPriceWei: string;
  feeWei: string;
  txHash: string;
}

interface SepRow extends GasPoint {
  step: string;
  blockNumber: number;
  note: string;
}

interface FeeSource {
  name: string;
  sellerFeePct: number;
  buyerFeePct: number;
  source: string;
  verified: string;
  note: string;
  hypothetical: boolean;
}

const local = JSON.parse(
  fs.readFileSync(path.join(OUT, "local-gas.json"), "utf8"),
) as LocalJson;
const sepolia = JSON.parse(
  fs.readFileSync(path.join(OUT, "sepolia-smoke.json"), "utf8"),
) as SepJson;
const completionPath = path.join(OUT, "sepolia-smoke-missing.json");
const completion = fs.existsSync(completionPath)
  ? (JSON.parse(fs.readFileSync(completionPath, "utf8")) as SepCompletionJson)
  : null;
const COMPLETION_OPS = new Set([
  "claimAccepted",
  "finalizeClaim",
  "expireOrder",
  "withdraw",
]);
const completionTxs = (completion?.transactions ?? []).filter((tx) =>
  COMPLETION_OPS.has(tx.step),
);

function normalizeOperation(step: string): string {
  return step.replace(/\(.*\)$/, "");
}

function stepNote(step: string): string {
  if (step.endsWith("(cancel)")) return "setup for cancelListing";
  if (step.endsWith("(dispute)")) return "setup for the dispute path";
  if (step === "openDispute") return "stores only a dispute hash; funds stay in escrow";
  if (step.startsWith("resolveDispute")) return "arbiter: buyer wins, bond slashed to buyer";
  if (step === "confirmReceipt") return "buyer confirms; withdrawal measured separately";
  if (step === "claimAccepted") return "starts the challenge window; no payout yet";
  if (step === "finalizeClaim") return "permissionless after the challenge window; credits price + bond";
  if (step === "expireOrder") return "permissionless refund; buyer price + seller bond as pull payments";
  if (step === "withdraw") return "pull payment; ReentrancyGuard + zeroed credit before the call";
  return "";
}

const sepRows: SepRow[] = [...sepolia.transactions, ...completionTxs].map((tx) => ({
  step: tx.step,
  operation: normalizeOperation(tx.step),
  gasUsed: Number(tx.gasUsed),
  gasPriceWei: tx.gasPrice,
  feeWei: tx.feeWei,
  txHash: tx.txHash,
  blockNumber: tx.blockNumber,
  note: stepNote(tx.step),
}));

const localByOp = new Map<string, GasPoint>(
  local.rows.map((row) => [
    row.operation,
    {
      operation: row.operation,
      gasUsed: Number(row.gasUsed),
      gasPriceWei: row.gasPriceWei,
      feeWei: row.feeWei,
      txHash: row.txHash,
    },
  ]),
);
const sepoliaByOp = new Map<string, SepRow>();
for (const row of sepRows) {
  if (!sepoliaByOp.has(row.operation)) sepoliaByOp.set(row.operation, row);
}

function sumHappyPath(map: Map<string, GasPoint>): number {
  return HAPPY_PATH.reduce((sum, op) => sum + (map.get(op)?.gasUsed ?? 0), 0);
}
const localHappyGas = sumHappyPath(localByOp);
const sepoliaHappyGas = sumHappyPath(sepoliaByOp);

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function gasCostUsd(gasUsed: number, gasPriceGwei: number, ethUsd: number): number {
  return gasUsed * gasPriceGwei * 1e-9 * ethUsd;
}

function breakEvenPriceUsd(
  gasUsed: number,
  gasPriceGwei: number,
  ethUsd: number,
  feePct: number,
): number {
  return gasCostUsd(gasUsed, gasPriceGwei, ethUsd) / (feePct / 100);
}

function fmtInt(value: number): string {
  return value.toLocaleString("en-US");
}

function fmtUsd(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
  });
}

function fmtUsdTick(value: number): string {
  if (value >= 1000) return `$${value / 1000}k`;
  return `$${value}`;
}

// ---------------------------------------------------------------------------
// CSV: Sepolia gas rows
// ---------------------------------------------------------------------------
const sepoliaCsv = [
  "step,operation,gasUsed,gasPriceWei,feeWei,txHash,blockNumber,note",
  ...sepRows.map((row) =>
    [
      row.step,
      row.operation,
      String(row.gasUsed),
      row.gasPriceWei,
      row.feeWei,
      row.txHash,
      String(row.blockNumber),
      csvEscape(row.note),
    ].join(","),
  ),
].join("\n");
fs.writeFileSync(path.join(OUT, "sepolia-gas.csv"), `${sepoliaCsv}\n`);

// ---------------------------------------------------------------------------
// Fee sources (sources and access dates)
// ---------------------------------------------------------------------------
const feeSources: FeeSource[] = [
  {
    name: "Steam Community Market",
    sellerFeePct: 15,
    buyerFeePct: 0,
    source: "https://steamdb.com/en/markets/steam",
    verified: "accessed 2026-11-07",
    note: "5% Steam transaction fee + 10% CS2 game fee; seller pays; buyer 0%.",
    hypothetical: false,
  },
  {
    name: "BUFF163",
    sellerFeePct: 1.5,
    buyerFeePct: 0,
    source: "https://buff.163.com/news/87397",
    verified: "official announcement, accessed 2026-11-07",
    note: "Official announcement: seller fee cut from 2.5% to 1.5% (effective 4-14); withdrawal fee 1%. Third-party trackers still list 2.5-3%.",
    hypothetical: false,
  },
  {
    name: "YouPin898",
    sellerFeePct: 1,
    buyerFeePct: 0,
    source: "https://steamdb.com/en/markets/youpin",
    verified: "SteamDB last verified 2026-07-01",
    note: "Seller 1%, buyer 0%.",
    hypothetical: false,
  },
  ...FEE_TIERS.map(
    (rate): FeeSource => ({
      name: `Assumed tier ${rate}%`,
      sellerFeePct: rate,
      buyerFeePct: 0,
      source: "analysis assumption",
      verified: "n/a",
      note: "Hypothetical platform fee used for sensitivity, not a competitor claim.",
      hypothetical: true,
    }),
  ),
];

const feeComparisonRows: string[] = [
  "basis,name,seller_fee_pct,item_price_usd,platform_fee_usd,sepolia_happy_gas_usd_at_10gwei,local_happy_gas_usd_at_10gwei,sepolia_gas_cheaper,local_gas_cheaper,sepolia_break_even_price_usd_at_10gwei,source,verified",
];
for (const fee of feeSources) {
  for (const itemPrice of [10, 50, 100, 200, 500]) {
    const platformFee = itemPrice * (fee.sellerFeePct / 100);
    const sepoliaGas = gasCostUsd(sepoliaHappyGas, 10, ETH_USD);
    const localGas = gasCostUsd(localHappyGas, 10, ETH_USD);
    const breakEven = breakEvenPriceUsd(sepoliaHappyGas, 10, ETH_USD, fee.sellerFeePct);
    feeComparisonRows.push(
      [
        fee.hypothetical ? "hypothetical" : "competitor",
        csvEscape(fee.name),
        String(fee.sellerFeePct),
        String(itemPrice),
        platformFee.toFixed(2),
        sepoliaGas.toFixed(4),
        localGas.toFixed(4),
        sepoliaGas < platformFee ? "yes" : "no",
        localGas < platformFee ? "yes" : "no",
        breakEven.toFixed(2),
        csvEscape(fee.source),
        csvEscape(fee.verified),
      ].join(","),
    );
  }
}
fs.writeFileSync(
  path.join(OUT, "fee-comparison.csv"),
  `${feeComparisonRows.join("\n")}\n`,
);

// ---------------------------------------------------------------------------
// Break-even table
// ---------------------------------------------------------------------------
const breakEvenRows: Array<{
  environment: string;
  happyPathGas: number;
  feePct: number;
  gasPriceGwei: number;
  gasCostEth: number;
  gasCostUsd: number;
  breakEvenItemPriceUsd: number;
}> = [];
for (const [environment, happyGas] of [
  ["local-osaka", localHappyGas],
  ["sepolia-amsterdam", sepoliaHappyGas],
] as const) {
  for (const fee of FEE_TIERS) {
    for (const gwei of SCENARIO_GWEI) {
      const gasCostEth = happyGas * gwei * 1e-9;
      breakEvenRows.push({
        environment,
        happyPathGas: happyGas,
        feePct: fee,
        gasPriceGwei: gwei,
        gasCostEth,
        gasCostUsd: gasCostEth * ETH_USD,
        breakEvenItemPriceUsd: breakEvenPriceUsd(happyGas, gwei, ETH_USD, fee),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function svgOpen(width: number, height: number, title: string, desc: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`,
    `<title>${esc(title)}</title>`,
    `<desc>${esc(desc)}</desc>`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
  ].join("\n");
}

const FONT = `font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"`;

// ---------------------------------------------------------------------------
// Chart 1: grouped horizontal bars, local vs Sepolia
// ---------------------------------------------------------------------------
function renderGasChart(): string {
  const W = 1040;
  const H = 700;
  const M = { left: 200, right: 150, top: 132, bottom: 110 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const maxGas = 800_000;
  const groupH = plotH / OPERATIONS.length;
  const barH = Math.min(14, groupH * 0.3);
  const x = (gas: number): number => M.left + (gas / maxGas) * plotW;
  const parts: string[] = [
    svgOpen(
      W,
      H,
      "SkinPact gas by operation",
      "Grouped bars comparing local Hardhat Osaka gas with Sepolia Amsterdam receipt gas for eleven SkinPactMarket operations.",
    ),
  ];
  parts.push(
    `<text x="${M.left}" y="48" ${FONT} font-size="24" font-weight="700" fill="#111827">SkinPact gas by operation</text>`,
  );
  parts.push(
    `<text x="${M.left}" y="74" ${FONT} font-size="13" fill="#4b5563">Local: Hardhat 2.29.1 (Osaka default), fixed 1 gwei reporting price.</text>`,
    `<text x="${M.left}" y="92" ${FONT} font-size="13" fill="#4b5563">Sepolia: receipt gasUsed from the 2026-11-06 smoke run (Amsterdam gas rules).</text>`,
  );
  // Legend
  const legendY = 114;
  parts.push(
    `<rect x="${M.left}" y="${legendY - 11}" width="12" height="12" rx="2" fill="#2f6fa8"/>`,
    `<text x="${M.left + 18}" y="${legendY}" ${FONT} font-size="12" fill="#374151">Local (Osaka)</text>`,
    `<rect x="${M.left + 140}" y="${legendY - 11}" width="12" height="12" rx="2" fill="#d1495b"/>`,
    `<text x="${M.left + 158}" y="${legendY}" ${FONT} font-size="12" fill="#374151">Sepolia (Amsterdam)</text>`,
  );
  // Grid
  for (let tick = 0; tick <= maxGas; tick += 100_000) {
    const tx = x(tick);
    parts.push(
      `<line x1="${tx}" y1="${M.top}" x2="${tx}" y2="${M.top + plotH}" stroke="#e5e7eb" stroke-width="1"/>`,
      `<text x="${tx}" y="${M.top + plotH + 20}" ${FONT} font-size="11" fill="#6b7280" text-anchor="middle">${tick === 0 ? "0" : `${tick / 1000}k`}</text>`,
    );
  }
  parts.push(
    `<text x="${M.left + plotW / 2}" y="${H - 18}" ${FONT} font-size="12" fill="#374151" text-anchor="middle">gas used (gas units)</text>`,
  );
  // Bars
  OPERATIONS.forEach((op, index) => {
    const center = M.top + index * groupH + groupH / 2;
    const localRow = localByOp.get(op);
    const sepRow = sepoliaByOp.get(op);
    parts.push(
      `<text x="${M.left - 12}" y="${center + 4}" ${FONT} font-size="12" fill="#111827" text-anchor="end">${esc(op)}</text>`,
    );
    if (localRow) {
      const width = Math.max(1, x(localRow.gasUsed) - M.left);
      parts.push(
        `<rect x="${M.left}" y="${center - barH - 2}" width="${width.toFixed(1)}" height="${barH}" rx="2" fill="#2f6fa8"/>`,
        `<text x="${(M.left + width + 6).toFixed(1)}" y="${center - 4}" ${FONT} font-size="11" fill="#1f2937">${fmtInt(localRow.gasUsed)}</text>`,
      );
    }
    if (sepRow) {
      const width = Math.max(1, x(sepRow.gasUsed) - M.left);
      parts.push(
        `<rect x="${M.left}" y="${center + 2}" width="${width.toFixed(1)}" height="${barH}" rx="2" fill="#d1495b"/>`,
        `<text x="${(M.left + width + 6).toFixed(1)}" y="${center + barH + 2}" ${FONT} font-size="11" fill="#1f2937">${fmtInt(sepRow.gasUsed)}</text>`,
      );
    } else {
      parts.push(
        `<text x="${M.left + 6}" y="${center + barH + 2}" ${FONT} font-size="10" fill="#9ca3af">not measured on Sepolia (no new tx sent)</text>`,
      );
    }
  });
  parts.push(
    completion
      ? `<text x="${M.left}" y="${H - 62}" ${FONT} font-size="11" fill="#6b7280">Sepolia: 2026-11-06 smoke + E1 completion smoke (claim, finalize, expire, withdraw).</text>`
      : `<text x="${M.left}" y="${H - 62}" ${FONT} font-size="11" fill="#6b7280">Sepolia did not measure claimAccepted, finalizeClaim, expireOrder or withdraw.</text>`,
    `<text x="${M.left}" y="${H - 46}" ${FONT} font-size="11" fill="#6b7280">Local and Sepolia cover all 11 operations, but use different gas schedules.</text>`,
  );
  parts.push("</svg>");
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Chart 2: break-even item price vs gas price
// ---------------------------------------------------------------------------
function renderBreakEvenChart(): string {
  const W = 1040;
  const H = 680;
  const M = { left: 96, right: 230, top: 120, bottom: 100 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const xMin = 0.1;
  const xMax = 100;
  const yMin = 1;
  const yMax = 100_000;
  const x = (gwei: number): number =>
    M.left +
    ((Math.log10(gwei) - Math.log10(xMin)) /
      (Math.log10(xMax) - Math.log10(xMin))) *
      plotW;
  const y = (usd: number): number =>
    M.top +
    ((Math.log10(yMax) - Math.log10(Math.max(usd, yMin))) /
      (Math.log10(yMax) - Math.log10(yMin))) *
      plotH;
  const colors: Record<number, string> = {
    1: "#2e7d32",
    2.5: "#d97706",
    5: "#6a3d9a",
  };
  const parts: string[] = [
    svgOpen(
      W,
      H,
      "SkinPact break-even item price versus gas price",
      "Break-even item price for 1%, 2.5% and 5% platform-fee tiers, comparing Sepolia Amsterdam gas with local Hardhat Osaka gas, assuming ETH at 3000 USD.",
    ),
  ];
  parts.push(
    `<text x="${M.left}" y="44" ${FONT} font-size="24" font-weight="700" fill="#111827">Break-even item price vs gas price</text>`,
    `<text x="${M.left}" y="70" ${FONT} font-size="13" fill="#4b5563">ETH = ${fmtUsd(ETH_USD)} (illustrative). Happy path = createListing + buy + markOfferSent + confirmReceipt.</text>`,
    `<text x="${M.left}" y="90" ${FONT} font-size="13" fill="#4b5563">Solid = Sepolia (${fmtInt(sepoliaHappyGas)} gas); dashed = local (${fmtInt(localHappyGas)} gas). Break-even = gas cost / fee rate.</text>`,
  );
  // Grid + axes
  for (const gwei of [0.1, 1, 10, 100]) {
    const gx = x(gwei);
    parts.push(
      `<line x1="${gx}" y1="${M.top}" x2="${gx}" y2="${M.top + plotH}" stroke="#e5e7eb" stroke-width="1"/>`,
      `<text x="${gx}" y="${M.top + plotH + 20}" ${FONT} font-size="11" fill="#6b7280" text-anchor="middle">${gwei}</text>`,
    );
  }
  for (const usd of [1, 10, 100, 1000, 10_000, 100_000]) {
    const gy = y(usd);
    parts.push(
      `<line x1="${M.left}" y1="${gy}" x2="${M.left + plotW}" y2="${gy}" stroke="#e5e7eb" stroke-width="1"/>`,
      `<text x="${M.left - 10}" y="${gy + 4}" ${FONT} font-size="11" fill="#6b7280" text-anchor="end">${fmtUsdTick(usd)}</text>`,
    );
  }
  parts.push(
    `<line x1="${M.left}" y1="${M.top + plotH}" x2="${M.left + plotW}" y2="${M.top + plotH}" stroke="#9ca3af" stroke-width="1"/>`,
    `<line x1="${M.left}" y1="${M.top}" x2="${M.left}" y2="${M.top + plotH}" stroke="#9ca3af" stroke-width="1"/>`,
    `<text x="${M.left + plotW / 2}" y="${H - 16}" ${FONT} font-size="12" fill="#374151" text-anchor="middle">gas price (gwei, log scale)</text>`,
    `<text transform="translate(28 ${M.top + plotH / 2}) rotate(-90)" ${FONT} font-size="12" fill="#374151" text-anchor="middle">break-even item price (USD, log scale)</text>`,
  );
  // 10 gwei reference line
  const refX = x(10);
  parts.push(
    `<line x1="${refX}" y1="${M.top}" x2="${refX}" y2="${M.top + plotH}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="4 4"/>`,
    `<text x="${refX + 6}" y="${M.top + 14}" ${FONT} font-size="11" fill="#6b7280">10 gwei</text>`,
  );
  // Series
  const samples = 60;
  for (const environment of ["sepolia", "local"] as const) {
    const happyGas = environment === "sepolia" ? sepoliaHappyGas : localHappyGas;
    for (const fee of FEE_TIERS) {
      const points: string[] = [];
      for (let i = 0; i < samples; i += 1) {
        const gwei =
          Math.pow(10, Math.log10(xMin) + (i / (samples - 1)) * (Math.log10(xMax) - Math.log10(xMin)));
        const price = breakEvenPriceUsd(happyGas, gwei, ETH_USD, fee);
        points.push(`${i === 0 ? "M" : "L"}${x(gwei).toFixed(1)},${y(price).toFixed(1)}`);
      }
      parts.push(
        `<path d="${points.join(" ")}" fill="none" stroke="${colors[fee]}" stroke-width="${environment === "sepolia" ? 3 : 2}" ${environment === "local" ? 'stroke-dasharray="7 5"' : ""} stroke-linecap="round"/>`,
      );
    }
  }
  // Annotate Sepolia points at 10 gwei
  const annotations = FEE_TIERS.map((fee) => ({
    fee,
    price: breakEvenPriceUsd(sepoliaHappyGas, 10, ETH_USD, fee),
  })).sort((a, b) => b.price - a.price);
  annotations.forEach(({ fee, price }) => {
    const cx = x(10);
    const cy = y(price);
    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="4" fill="${colors[fee]}" stroke="#ffffff" stroke-width="2"/>`,
    );
  });
  // Legend
  const lx = W - M.right + 18;
  let ly = M.top + 6;
  parts.push(
    `<text x="${lx}" y="${ly}" ${FONT} font-size="12" font-weight="700" fill="#111827">Fee tier</text>`,
  );
  ly += 22;
  for (const fee of FEE_TIERS) {
    parts.push(
      `<line x1="${lx}" y1="${ly - 4}" x2="${lx + 28}" y2="${ly - 4}" stroke="${colors[fee]}" stroke-width="3"/>`,
      `<text x="${lx + 36}" y="${ly}" ${FONT} font-size="12" fill="#374151">${fee}% fee</text>`,
    );
    ly += 22;
  }
  ly += 10;
  parts.push(
    `<line x1="${lx}" y1="${ly - 4}" x2="${lx + 28}" y2="${ly - 4}" stroke="#6b7280" stroke-width="2" stroke-dasharray="7 5"/>`,
    `<text x="${lx + 36}" y="${ly}" ${FONT} font-size="11" fill="#4b5563">dashed = local</text>`,
  );
  ly += 30;
  parts.push(
    `<text x="${lx}" y="${ly}" ${FONT} font-size="12" font-weight="700" fill="#111827">At 10 gwei (Sepolia)</text>`,
  );
  for (const { fee, price } of annotations) {
    ly += 20;
    parts.push(
      `<text x="${lx}" y="${ly}" ${FONT} font-size="12" fill="${colors[fee]}">${fee}%: ${fmtUsd(price)}</text>`,
    );
  }
  parts.push(
    `<text x="${lx}" y="${ly + 22}" ${FONT} font-size="10" fill="#6b7280">break-even item price</text>`,
  );
  parts.push(
    `<text x="${M.left}" y="${H - 62}" ${FONT} font-size="11" fill="#6b7280">Test ETH has no real value. ETH/USD is an assumption, not a testnet price.</text>`,
    `<text x="${M.left}" y="${H - 46}" ${FONT} font-size="11" fill="#6b7280">Below a curve, gas costs less than the fee; above it, gas dominates.</text>`,
  );
  parts.push("</svg>");
  return parts.join("\n");
}

fs.writeFileSync(path.join(OUT, "gas-by-operation.svg"), `${renderGasChart()}\n`);
fs.writeFileSync(path.join(OUT, "fee-breakeven.svg"), `${renderBreakEvenChart()}\n`);

// ---------------------------------------------------------------------------
// Summary JSON
// ---------------------------------------------------------------------------
const allSepoliaTxs = [...sepolia.transactions, ...completionTxs];
const originalSepoliaFeeWei = sepolia.transactions.reduce(
  (sum, tx) => sum + BigInt(tx.feeWei),
  0n,
);
const completionSepoliaFeeWei = completionTxs.reduce(
  (sum, tx) => sum + BigInt(tx.feeWei),
  0n,
);
const totalSepoliaFeeWei = originalSepoliaFeeWei + completionSepoliaFeeWei;
const gasPricesWei = allSepoliaTxs.map((tx) => Number(tx.gasPrice));
const minGasPriceWei = Math.min(...gasPricesWei);
const maxGasPriceWei = Math.max(...gasPricesWei);
const codeCommit = execSync("git rev-parse --short HEAD", { cwd: ROOT })
  .toString()
  .trim();
const summary = {
  experiment: "E1",
  generatedAt: new Date().toISOString(),
  codeCommit,
  environment: {
    local: {
      network: local.network,
      chainId: local.chainId,
      contract: local.contract,
      hardfork: "Osaka (Hardhat 2.29.1 default)",
      gasPriceWei: local.gasPriceWei,
      note: "Fixed 1 gwei reporting price; setup transactions excluded.",
    },
    sepolia: {
      network: sepolia.network,
      chainId: sepolia.chainId,
      contract: sepolia.contract,
      deploymentBlock: sepolia.deploymentBlock,
      smokeGeneratedAt: sepolia.generatedAt,
      completionSmokeGeneratedAt: completion?.generatedAt ?? null,
      completionListingIds: completion?.listingIds ?? null,
      note: completion
        ? "Receipt gasUsed from the 2026-11-06 smoke plus the E1 completion smoke (claimAccepted, finalizeClaim, expireOrder, withdraw). Sepolia exhibited Amsterdam-era gas rules and EIP-7708 ETH-transfer logs during these runs."
        : "Receipt gasUsed from the existing smoke run. Sepolia exhibited Amsterdam-era gas rules and EIP-7708 ETH-transfer logs during this run.",
    },
  },
  happyPath: {
    operations: HAPPY_PATH,
    localGas: localHappyGas,
    sepoliaGas: sepoliaHappyGas,
    note: "withdraw is excluded from the happy-path sum because it is a post-settlement payout; it is measured separately on both environments.",
  },
  assumptions: {
    ethUsd: ETH_USD,
    gasPriceScenariosGwei: SCENARIO_GWEI,
    feeTiersPct: FEE_TIERS,
    note: "ETH/USD and fee tiers are illustrative; test ETH has no real value.",
  },
  observedSepolia: {
    gasPriceWeiPerGas: `${minGasPriceWei}-${maxGasPriceWei}`,
    originalSmokeFeeWei: originalSepoliaFeeWei.toString(),
    completionSmokeFeeWei: completionSepoliaFeeWei.toString(),
    totalSmokeFeeWei: totalSepoliaFeeWei.toString(),
    totalSmokeFeeEth: (Number(totalSepoliaFeeWei) / 1e18).toFixed(18),
    note: "Observed during idle Sepolia periods; not representative of market gas prices.",
  },
  breakEven: breakEvenRows,
  feeSources,
  gasRuleSources: [
    {
      name: "Ethereum Foundation — EIP-8037 / EIP-8038 (state gas repricing)",
      url: "https://blog.ethereum.org/2026/11/06/glamsterdam-8037-8038",
      note: "New state slot ~20,000 -> ~97,920 gas; state access repriced.",
    },
    {
      name: "Hardhat — Amsterdam hardfork support",
      url: "https://hardhat.org/docs/reference/amsterdam-support",
      note: "Amsterdam is opt-in; Osaka is the default/latest stable hardfork on the docs page.",
    },
    {
      name: "EIP-7708 — ETH transfers emit a log",
      url: "https://eips.sh/eip/7708",
      note: "Protocol Transfer log from the system address 0xffff…fffe for value transfers.",
    },
  ],
  caveats: [
    "Local Hardhat defaults to Osaka; Sepolia exhibited Amsterdam-era gas rules (EIP-8037 state creation repricing, EIP-7708 ETH transfer logs). Values are reported separately and must not be mixed.",
    completion
      ? "Sepolia gas combines the 2026-11-06 smoke with the E1 completion smoke (claimAccepted, finalizeClaim, expireOrder, withdraw)."
      : "The Sepolia smoke run did not include claimAccepted, finalizeClaim, expireOrder or withdraw.",
    `The observed Sepolia gas price (${minGasPriceWei}-${maxGasPriceWei} wei) is an idle-testnet artifact; break-even uses 1, 10 and 50 gwei scenarios.`,
    "Platform fee tiers 1% / 2.5% / 5% are hypothetical sensitivity inputs; competitor rates are sourced separately.",
    "Test ETH has no real value; USD figures are for economic illustration only.",
  ],
};
fs.writeFileSync(path.join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------
console.log("E1 dataset written to experiments/e1/");
console.log(`ETH assumption: $${ETH_USD}`);
console.log(`Happy path gas: local ${fmtInt(localHappyGas)}, Sepolia ${fmtInt(sepoliaHappyGas)}`);
for (const fee of FEE_TIERS) {
  const localBe = breakEvenPriceUsd(localHappyGas, 10, ETH_USD, fee);
  const sepBe = breakEvenPriceUsd(sepoliaHappyGas, 10, ETH_USD, fee);
  console.log(
    `  ${fee}% fee @ 10 gwei: local break-even ${fmtUsd(localBe)}, Sepolia ${fmtUsd(sepBe)}`,
  );
}
console.log(
  `Sepolia observed gas price: ${minGasPriceWei}-${maxGasPriceWei} wei; total smoke fee ${totalSepoliaFeeWei.toString()} wei`,
);
