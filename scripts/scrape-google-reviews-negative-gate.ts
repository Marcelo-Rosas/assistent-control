/**
 * Paginate Google Maps reviews via SearchAPI MCP HTTP (same as user-gymsite-searchapi).
 * Reads MCP token from Cursor mcp.json gymsite-searchapi URL.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const PLACE_ID = "ChIJQy2AvuzfmwARP5T2npZCSIc";
const DATE_GATE = "2025-08-31T00:00:00.000Z";
const REFERENCE_DATE = "2026-08-31";
const PAGE_SIZE = 20;
const PAGE_DELAY_MS = 300;
const MCP_URL = "https://www.searchapi.io/mcp";

type SortBy = "lowest_rating" | "newest" | "most_relevant";

interface Review {
  review_id: string;
  user: { name: string };
  rating: number;
  iso_date?: string;
  text?: string | null;
  link?: string;
}

interface ApiResponse {
  reviews?: Review[];
  pagination?: { next_page_token?: string };
}

function loadMcpToken(): string {
  const mcpJson = readFileSync(
    resolve(homedir(), ".cursor", "mcp.json"),
    "utf8"
  );
  const cfg = JSON.parse(mcpJson) as {
    mcpServers?: Record<string, { url?: string }>;
  };
  const url = cfg.mcpServers?.["gymsite-searchapi"]?.url ?? "";
  const match = url.match(/token=([^&]+)/);
  if (!match) throw new Error("gymsite-searchapi MCP token not found in mcp.json");
  return match[1];
}

const MCP_TOKEN = loadMcpToken();

async function fetchPage(
  sortBy: SortBy,
  nextPageToken?: string
): Promise<ApiResponse> {
  const args: Record<string, unknown> = {
    place_id: PLACE_ID,
    sort_by: sortBy,
    num: PAGE_SIZE,
    hl: "pt",
    gl: "br",
  };
  if (nextPageToken) args.next_page_token = nextPageToken;

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: { name: "google_maps_reviews", arguments: args },
  });

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "X-MCP-Token": MCP_TOKEN,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`MCP ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    result?: { content?: Array<{ type: string; text?: string }> };
    error?: { message?: string };
  };

  if (json.error) throw new Error(json.error.message ?? "MCP error");
  const text = json.result?.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("Empty MCP response");
  return JSON.parse(text) as ApiResponse;
}

function inGate(isoDate?: string): boolean {
  return !!isoDate && isoDate >= DATE_GATE;
}

function isNegative(rating: number): boolean {
  return rating >= 1 && rating <= 3;
}

async function paginateLowestRating() {
  const collected: Review[] = [];
  let token: string | undefined;
  let pages = 0;

  for (;;) {
    pages++;
    const data = await fetchPage("lowest_rating", token);
    const batch = data.reviews ?? [];
    if (batch.length === 0) break;
    collected.push(...batch);
    token = data.pagination?.next_page_token;
    if (!token) break;
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  return { reviews: collected, pages };
}

async function paginateNewest() {
  const collected: Review[] = [];
  let token: string | undefined;
  let pages = 0;
  let stoppedEarly = false;

  for (;;) {
    pages++;
    const data = await fetchPage("newest", token);
    const batch = data.reviews ?? [];
    if (batch.length === 0) break;
    collected.push(...batch);

    if (batch.every((r) => r.iso_date && r.iso_date < DATE_GATE)) {
      stoppedEarly = true;
      break;
    }

    token = data.pagination?.next_page_token;
    if (!token) break;
    await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
  }

  return { reviews: collected, pages, stoppedEarly };
}

async function paginateMostRelevant(maxPages: number) {
  const collected: Review[] = [];
  let token: string | undefined;
  let pages = 0;

  while (pages < maxPages) {
    pages++;
    const data = await fetchPage("most_relevant", token);
    const batch = data.reviews ?? [];
    if (batch.length === 0) break;
    collected.push(...batch);
    token = data.pagination?.next_page_token;
    if (!token) break;
    if (pages < maxPages) {
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }
  }

  return { reviews: collected, pages };
}

async function main() {
  const byId = new Map<string, Review>();
  const meta: Record<
    string,
    { pages: number; count: number; stoppedEarly?: boolean }
  > = {};

  console.log("1/3 sort_by=lowest_rating (full exhaust)...");
  const lowest = await paginateLowestRating();
  for (const r of lowest.reviews) {
    if (r.review_id) byId.set(r.review_id, r);
  }
  meta.lowest_rating = { pages: lowest.pages, count: lowest.reviews.length };
  console.log(
    `  ${lowest.pages} pages, ${lowest.reviews.length} raw, unique ${byId.size}`
  );

  console.log("2/3 sort_by=newest (until date gate)...");
  const newest = await paginateNewest();
  for (const r of newest.reviews) {
    if (r.review_id) byId.set(r.review_id, r);
  }
  meta.newest = {
    pages: newest.pages,
    count: newest.reviews.length,
    stoppedEarly: newest.stoppedEarly,
  };
  console.log(
    `  ${newest.pages} pages, ${newest.reviews.length} raw, unique ${byId.size}, stoppedEarly=${newest.stoppedEarly}`
  );

  console.log("3/3 sort_by=most_relevant (3 pages for dedup)...");
  const relevant = await paginateMostRelevant(3);
  for (const r of relevant.reviews) {
    if (r.review_id) byId.set(r.review_id, r);
  }
  meta.most_relevant = { pages: relevant.pages, count: relevant.reviews.length };
  console.log(
    `  ${relevant.pages} pages, ${relevant.reviews.length} raw, unique ${byId.size}`
  );

  const allUnique = [...byId.values()];
  const negativeInGate = allUnique
    .filter((r) => isNegative(r.rating) && inGate(r.iso_date))
    .sort((a, b) => (b.iso_date ?? "").localeCompare(a.iso_date ?? ""));

  const output = {
    place_id: PLACE_ID,
    title: "Academia Perfect Body — Cassino Bangu",
    filters: {
      rating: "1-3",
      date_gate: "iso_date >= 2025-08-31",
      reference_date: REFERENCE_DATE,
    },
    fetched_at: new Date().toISOString(),
    google_reviews_total: 606,
    pagination_meta: meta,
    unique_reviews_fetched: allUnique.length,
    count_negative_in_gate: negativeInGate.length,
    reviews_negative_in_gate: negativeInGate.map((r) => ({
      review_id: r.review_id,
      user: r.user.name,
      rating: r.rating,
      iso_date: r.iso_date,
      text: r.text ?? null,
      link: r.link,
    })),
  };

  const outPath = resolve(
    "data/processed/wellhub-pass2-google-reviews-negative-gate.json"
  );
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");

  console.log("\n--- RESULT ---");
  console.log(`count_negative_in_gate: ${output.count_negative_in_gate}`);
  console.log(`unique_reviews_fetched: ${output.unique_reviews_fetched}`);
  console.log(
    `users in gate: ${output.reviews_negative_in_gate.map((r) => r.user).join(", ")}`
  );
  console.log(`file: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
