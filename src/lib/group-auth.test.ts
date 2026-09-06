import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn(), invoke: vi.fn() }));
vi.mock("./supabase", () => ({ supabase: { auth: mocks, functions: { invoke: mocks.invoke } } }));
import { groupAction } from "./group-swipe";
const session = (access_token = "old-token", id = "user-a") => ({ access_token, user: { id } });
const auth = (value = session()) => ({ data: { session: value }, error: null });
const denied = (status = 401, detail = { error: "Sign in to use this feature." }) => ({ data: null, error: { context: new Response(JSON.stringify(detail), { status }) } });
const success = { data: { id: "room-a" }, error: null };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue(auth());
  mocks.refreshSession.mockResolvedValue(auth(session("new-token")));
  mocks.invoke.mockResolvedValue(success);
});
describe("room authentication recovery", () => {
  it("uses the signed-in token without refreshing a working session", async () => {
    await expect(groupAction("create", { count: 8 })).resolves.toEqual(success.data);
    expect(mocks.invoke.mock.calls[0][1].headers.Authorization).toBe("Bearer old-token");
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });
  it("refreshes a rejected token and retries the same create once", async () => {
    mocks.invoke.mockResolvedValueOnce(denied());
    await expect(groupAction("create", { count: 8 })).resolves.toEqual(success.data);
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke.mock.calls[1][1]).toMatchObject({ body: { action: "create", payload: { count: 8 } }, headers: { Authorization: "Bearer new-token" } });
  });
  it("uses a token already refreshed by the foreground listener", async () => {
    mocks.invoke.mockResolvedValueOnce(denied());
    mocks.getSession.mockResolvedValueOnce(auth()).mockResolvedValue(auth(session("foreground-token")));
    await groupAction("join", { code: "TACO1234" });
    expect(mocks.refreshSession).not.toHaveBeenCalled();
    expect(mocks.invoke.mock.calls[1][1].headers.Authorization).toBe("Bearer foreground-token");
  });
  it("shares refresh when polling and creating fail together", async () => {
    let resolve!: (value: ReturnType<typeof auth>) => void;
    mocks.refreshSession.mockImplementation(() => new Promise(r => { resolve = r; }));
    mocks.invoke.mockImplementation((_name, options) => Promise.resolve(options.headers.Authorization === "Bearer old-token" ? denied() : success));
    const requests = Promise.all([groupAction("list"), groupAction("create")]);
    await vi.waitFor(() => expect(mocks.refreshSession).toHaveBeenCalledTimes(1));
    resolve(auth(session("new-token")));
    await requests;
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(4);
  });
  it("never sends an anonymous room request when no session exists", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(groupAction("create")).rejects.toThrow("Please sign in again");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it.each(["lookup", "refresh"])("reports a %s outage as a connection problem", async stage => {
    const failure = { data: { session: null }, error: { name: "AuthRetryableFetchError", status: 503 } };
    if (stage === "lookup") mocks.getSession.mockResolvedValue(failure);
    else { mocks.invoke.mockResolvedValueOnce(denied()); mocks.refreshSession.mockResolvedValue(failure); }
    await expect(groupAction("create")).rejects.toThrow("Check your connection");
    expect(mocks.invoke).toHaveBeenCalledTimes(stage === "lookup" ? 0 : 1);
  });
  it("asks for sign-in only when refresh confirms an ended session", async () => {
    mocks.invoke.mockResolvedValueOnce(denied());
    mocks.refreshSession.mockResolvedValue({ data: { session: null }, error: { code: "refresh_token_not_found" } });
    await expect(groupAction("create")).rejects.toThrow("Please sign in again");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it("stops after a second 401 without claiming the signed-in user is signed out", async () => {
    mocks.invoke.mockImplementation(() => Promise.resolve(denied()));
    await expect(groupAction("create")).rejects.toThrow("Couldn’t reconnect your session");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
  });
  it.each([403, 429, 500, 503])("never repeats mutations after HTTP %s", async status => {
    mocks.invoke.mockResolvedValue(denied(status, { error: "Request failed" }));
    await expect(groupAction("create")).rejects.toThrow("Request failed");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });
  it("never repeats a create after a transport failure", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error("Network failed") });
    await expect(groupAction("create")).rejects.toThrow("Couldn’t connect to the room");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it.each(["before", "during"])("does not replay an action for an account changed %s refresh", async stage => {
    mocks.invoke.mockResolvedValueOnce(denied());
    if (stage === "before") mocks.getSession.mockResolvedValueOnce(auth()).mockResolvedValue(auth(session("other-token", "user-b")));
    else mocks.refreshSession.mockResolvedValue(auth(session("other-token", "user-b")));
    await expect(groupAction("create")).rejects.toThrow("Please sign in again");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it("bounds session recovery when the phone's network hangs", async () => {
    vi.useFakeTimers();
    try {
      mocks.getSession.mockReturnValue(new Promise(() => {}));
      const result = expect(groupAction("create")).rejects.toThrow("Check your connection");
      await vi.advanceTimersByTimeAsync(20_000);
      await result;
      expect(mocks.invoke).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
