import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
export type GroupPreferences = {
  cuisines: string[];
  prices: number[];
  dietary: string[];
  notes: string;
};
// New members have {} until they save their mood; other members' preferences
// are omitted from snapshots. Keep form state complete in either case.
export function normalizeGroupPreferences(value: unknown): GroupPreferences {
  const preferences = value && typeof value === "object"
    ? value as Partial<GroupPreferences>
    : {};
  return {
    cuisines: Array.isArray(preferences.cuisines)
      ? preferences.cuisines.filter((v) => typeof v === "string") : [],
    prices: Array.isArray(preferences.prices)
      ? preferences.prices.filter((v) => Number.isInteger(v) && v >= 1 && v <= 4) : [],
    dietary: Array.isArray(preferences.dietary)
      ? preferences.dietary.filter((v) => typeof v === "string") : [],
    notes: typeof preferences.notes === "string" ? preferences.notes : "",
  };
}
export type GroupVote = "yes" | "no" | "veto";
export interface GroupPlace {
  id: string;
  name: string;
  cuisine: string;
  address: string;
  photoUrl: string | null;
  rating: number;
  priceLevel: number;
  fit: number;
  reason: string;
  distance: number;
  score?: number;
  likes?: number;
  attributions?: { displayName: string; uri?: string }[];
}
export interface GroupRanking {
  ordered?: string[];
  remaining?: string[];
  lo?: number;
  hi?: number;
  comparisons?: number;
  done: boolean;
}
export interface GroupRoom {
  id: string;
  code: string;
  host: string;
  status: "lobby" | "generating" | "ready" | "swiping" | "results" | "closed";
  round: number;
  location: { label: string; lat: number; lng: number };
  count: number;
  radius: number;
  deck: GroupPlace[];
  results: GroupPlace[];
  vetoed: string[];
  members: Record<
    string,
    {
      name: string;
      ready: boolean;
      preferences?: Partial<GroupPreferences> | null;
      votes: Record<string, GroupVote>;
      vetoUsed: boolean;
      ranking?: GroupRanking;
    }
  >;
  personalization?: string;
}
export class GroupError extends Error {
  upgrade = false;
  constructor(message: string, upgrade = false) {
    super(message);
    this.upgrade = upgrade;
  }
}
const SESSION_UNAVAILABLE = "Couldn’t reconnect your session. Check your connection and try again.";
const SIGN_IN_AGAIN = "Your session has ended. Please sign in again.";
let pendingRefresh: Promise<Session> | null = null;

function sessionError(error: { name?: string; status?: number; code?: string }): GroupError {
  const ended = error.name === "AuthSessionMissingError" ||
    ["refresh_token_not_found", "refresh_token_already_used", "session_not_found"].includes(error.code || "");
  return new GroupError(ended ? SIGN_IN_AGAIN : SESSION_UNAVAILABLE);
}

async function currentSession(): Promise<Session> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw sessionError(error);
  if (!data.session?.access_token) throw new GroupError(SIGN_IN_AGAIN);
  return data.session;
}

async function recoverSession(rejected: Session): Promise<Session> {
  // A foreground refresh or another room request may already have repaired it.
  const current = await currentSession();
  if (current.user.id !== rejected.user.id) throw new GroupError(SIGN_IN_AGAIN);
  if (current.access_token !== rejected.access_token) return current;
  // Room polling and a Create tap can fail together. Rotate the refresh token once.
  if (!pendingRefresh) {
    pendingRefresh = (async () => {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) throw sessionError(error);
      if (!data.session?.access_token) throw new GroupError(SIGN_IN_AGAIN);
      return data.session;
    })().finally(() => { pendingRefresh = null; });
  }
  const refreshed = await pendingRefresh;
  if (refreshed.user.id !== rejected.user.id) throw new GroupError(SIGN_IN_AGAIN);
  return refreshed;
}

async function awaitSession(work: Promise<Session>): Promise<Session> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new GroupError(SESSION_UNAVAILABLE)), 20_000);
      }),
    ]);
  } catch (error) {
    if (error instanceof GroupError) throw error;
    throw new GroupError(SESSION_UNAVAILABLE);
  } finally {
    clearTimeout(timer!);
  }
}

export async function groupAction<T = GroupRoom>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const session = await awaitSession(currentSession());
  const invoke = (accessToken: string) => supabase.functions.invoke("group-swipe", {
    body: { action, payload },
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: action === "generate" ? 180_000 : 20_000,
  });
  let result = await invoke(session.access_token);
  // requireUser rejects 401s before any room mutation. Never replay a timed-out
  // or 5xx create/vote: the server may already have applied that action.
  if (result.error?.context?.status === 401) {
    const refreshed = await awaitSession(recoverSession(session));
    result = await invoke(refreshed.access_token);
  }
  const { data, error } = result;
  if (error) {
    if (error.context?.status === 401) throw new GroupError(SESSION_UNAVAILABLE);
    let detail;
    try {
      detail = await error.context?.json();
    } catch {}
    throw new GroupError(
      detail?.error || "Couldn’t connect to the room. Please try again.",
      detail?.upgrade,
    );
  }
  if (data?.error) throw new GroupError(data.error, data.upgrade);
  return data;
}
export function swipeVote(x: number, y: number): GroupVote | null {
  if (y > 100 && y > Math.abs(x) * 1.2) return "veto";
  if (Math.abs(x) > 90 && Math.abs(x) > Math.abs(y))
    return x > 0 ? "yes" : "no";
  return null;
}
export function tiedPlaces(room: GroupRoom): GroupPlace[] {
  return room.results.filter((p) => p.score === room.results[0]?.score);
}
