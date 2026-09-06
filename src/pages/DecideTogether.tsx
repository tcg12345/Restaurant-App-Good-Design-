import { usePageBack } from '../lib/usePageBack';
import { Capacitor } from "@capacitor/core";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Heart,
  Loader2,
  MapPin,
  Plus,
  Share2,
  ShieldX,
  Sparkles,
  Users,
  X,
  Crown,
  Utensils,
  Trash2,
} from "lucide-react";
import { useSignInModal } from "../contexts/SignInModalContext";
import { useAuth } from "../contexts/AuthContext";
import { useHomeLocation } from "../contexts/HomeLocationContext";
import { HomeLocationBar } from "../components/HomeLocationBar";
import { ShareDialog } from "../components/ShareDialog";
import {
  canonicalShareUrl,
  copyToClipboard,
  shareExternally,
} from "../lib/native-share";
import { homeHaptic } from "../lib/haptics";
import { supabase } from "../lib/supabase";
import {
  groupAction,
  normalizeGroupPreferences,
  GroupError,
  swipeVote,
  tiedPlaces,
  type GroupRoom,
  type GroupPreferences,
  type GroupVote,
  type GroupPlace,
} from "../lib/group-swipe";
import { GroupCuisinePicker } from "../components/GroupCuisinePicker";
import { GroupDiscovery } from "../components/GroupDiscovery";
import { GroupPairwise } from "../components/GroupPairwise";
import "./DecideTogether.css";
type RoomSummary = Pick<GroupRoom, "id" | "code" | "host" | "status" | "location">;
export const DecideTogether: React.FC = () => {
  const navigate = useNavigate();
  const goBack = usePageBack('/');
  const { requireSignIn } = useSignInModal();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const home = useHomeLocation();
  const reduced = useReducedMotion();
  const [room, setRoom] = useState<GroupRoom | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [mode, setMode] = useState<"intro" | "create" | "join">("intro");
  const [code, setCode] = useState(params.get("code") || "");
  const [count, setCount] = useState(8);
  const [radius, setRadius] = useState(5000);
  const [locationOpen, setLocationOpen] = useState(false);
  const [preferences, setPreferences] = useState<GroupPreferences>(() => normalizeGroupPreferences(null));
  const [editing, setEditing] = useState(false);
  const [settings, setSettings] = useState(false);
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState("");
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [upgrade, setUpgrade] = useState(false);
  const [notice, setNotice] = useState("");
  const [connected, setConnected] = useState(false);
  const [confirm, setConfirm] = useState<"veto" | "cancel" | "delete" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoomSummary | null>(null);
  const roomsRequest = useRef(0);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (confirm) {
      confirmDialog.current?.showModal();
    }
    return () => confirmDialog.current?.close();
  }, [confirm]);
  const request = useRef(0);
  const member = room && user ? room.members[user.id] : null;
  const host = room?.host === user?.id;
  const current = room?.deck.find((p) => !member?.votes[p.id]);
  const [dragLabel, setDragLabel] = useState("");
  const accept = useCallback(
    (next: GroupRoom) => {
      setRoom(next);
      setSyncError("");
      setParams({ code: next.code }, { replace: true });
    },
    [setParams],
  );
  const run = async (action: string, payload: Record<string, unknown> = {}) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(action);
    setError("");
    setUpgrade(false);
    request.current++;
    try {
      const next = await groupAction(action, {
        ...(room ? { id: room.id } : {}),
        ...payload,
      });
      if (!mounted.current) return;
      if (next.status === "closed") setRooms(items => items.filter(item => item.id !== next.id));
      accept(next);
      homeHaptic();
      if (action === "preferences") setEditing(false);
      if (action === "settings") setSettings(false);
      return next;
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : "Please try again.");
      setUpgrade(e instanceof GroupError && e.upgrade);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy("");
    }
  };
  useEffect(() => {
    if (!user) return;
    let live = true;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      const sequence = ++roomsRequest.current;
      groupAction<RoomSummary[]>("list").then(items => {
        if (live && sequence === roomsRequest.current) setRooms(items.filter(item => item.status !== "closed"));
      }).catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [user?.id, room?.id]);
  const deleteRoom = async (target: RoomSummary) => {
    if (lock.current) return;
    lock.current = true;
    setBusy("delete");
    setError("");
    ++roomsRequest.current;
    try {
      await groupAction("cancel", { id: target.id });
      ++roomsRequest.current;
      if (!mounted.current) return;
      setRooms(items => items.filter(item => item.id !== target.id));
      setNotice("Room deleted");
      homeHaptic();
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Couldn’t delete this room. Try again.");
    } finally {
      lock.current = false;
      if (mounted.current) setBusy("");
    }
  };
  const autoJoin = useRef("");
  useEffect(() => {
    const c = params.get("code");
    if (user && c && room?.code !== c && autoJoin.current !== c) {
      autoJoin.current = c;
      setMode("join");
      setCode(c);
      void run("join", { code: c });
    }
  }, [user?.id, params]);
  useEffect(() => {
    if (!room?.id || room.status === "closed" || room.status === "results") return;
    let live = true;
    const refresh = async () => {
      if (lock.current || document.visibilityState === "hidden") return;
      const seq = ++request.current;
      try {
        const next = await groupAction("snapshot", { id: room.id });
        if (live && seq === request.current) {
          setRoom(next);
          setSyncError("");
        }
      } catch (e) {
        if (live && seq === request.current)
          setSyncError(e instanceof Error ? e.message : "Reconnecting…");
      }
    };
    const channel = supabase
      .channel(`group:${room.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "group_room_events",
          filter: `id=eq.${room.id}`,
        },
        () => void refresh(),
      )
      .subscribe((status) => {
        if (live) setConnected(status === "SUBSCRIBED");
      });
    const timer = setInterval(refresh, 4000);
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      void supabase.removeChannel(channel);
    };
  }, [room?.id, room?.status, room?.round]);
  useEffect(() => {
    setPreferences(normalizeGroupPreferences(member?.preferences));
  }, [room?.id, member?.ready]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 2400);
    return () => clearTimeout(t);
  }, [notice]);
  const toggle = (key: "cuisines" | "prices" | "dietary", v: string | number) =>
    setPreferences((p) => ({
      ...p,
      [key]: (p[key] as (string | number)[]).includes(v)
        ? (p[key] as (string | number)[]).filter((x) => x !== v)
        : [...p[key], v],
    }));
  const vote = (v: GroupVote) => {
    if (!current || busy) return;
    if (v === "veto") {
      if (member?.vetoUsed) return;
      setConfirm("veto");
    } else void run("vote", { place: current.id, vote: v, round: room?.round });
  };
  const roomUrl = room ? canonicalShareUrl(`/decide?code=${room.code}`) : "";
  const invite = room
    ? `Join my GoodEats room. Code: ${room.code}\n${roomUrl}`
    : "";
  const leaveView = () => {
    setRoom(null);
    setParams({}, { replace: true });
    autoJoin.current = "";
    setMode("intro");
    setError("");
  };
  const choosingMood = busy !== "generate" && room?.status === "lobby" && !settings && (!member?.ready || editing);
  const leaveRoom = () => host ? setConfirm("cancel") : void run("leave").then(next => { if (next) leaveView(); });
  const saveMood = () => void run("preferences", { preferences: { ...preferences, dietary: [] } });
  const primary = (label: string, onClick: () => void, disabled = false) => (
    <button
      className="gs-primary"
      disabled={disabled || !!busy}
      onClick={onClick}
    >
      {busy ? <Loader2 className="gs-spin" size={19} /> : null}
      {label}
      {!busy && <ArrowRight size={18} />}
    </button>
  );
  const members: [string, GroupRoom["members"][string]][] = room
    ? Object.entries(room.members)
    : [];
  const done = members.filter(
    ([, m]) => m.ranking?.done,
  ).length;
  const featurePhoto = (p: GroupPlace, cls = "") => (
    <div className={`gs-photo ${cls}`}>
      {p.photoUrl ? (
        <img src={p.photoUrl} alt={p.name} />
      ) : (
        <div className="gs-no-photo">
          <Utensils size={64} strokeWidth={1} />
          <span>{p.cuisine}</span>
        </div>
      )}
      {p.photoUrl && p.attributions?.length ? (
        <span className="gs-photo-credit">
          {p.attributions.map((a) => a.displayName).join(", ")}
        </span>
      ) : null}
    </div>
  );
  return (
    <main className={`gs-page${choosingMood ? " is-mood" : ""}`}>
      <header className="gs-header">
        <button
          className="gs-glass"
          aria-label="Back to Home"
          onClick={() => goBack()}
        >
          <ArrowLeft size={21} />
        </button>
        <span>Decide together</span>
        {choosingMood ? <button className="gs-glass gs-header-close" disabled={!!busy} aria-label={host ? "Close room" : "Leave room"} onClick={leaveRoom}><X size={18} /></button> : <span className="gs-live">
          <i className={connected ? "online" : ""} />
          {room ? "Live room" : "Group Swipe"}
        </span>}
      </header>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          className="gs-body"
          key={
            room
              ? `${busy === "generate" ? "generating" : room.status}-${room.round}-${member?.ready && !editing ? "ready" : "prefs"}`
              : mode
          }
          initial={{ opacity: 0, y: reduced ? 0 : 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduced ? 0 : -10 }}
          transition={{ duration: reduced ? 0 : 0.24 }}
        >
          {!user ? (
            <section className="gs-intro">
              <Users size={60} />
              <h1>Better together.</h1>
              <p>Sign in to join your friends.</p>
              {primary("Sign in", () =>
                requireSignIn("Sign in to decide together"),
              )}
              {!Capacitor.isNativePlatform() && code && (
                <a
                  className="gs-secondary"
                  href={`com.tylergorin.restaurantapp://decide?code=${code}`}
                >
                  Open in GoodEats
                </a>
              )}
            </section>
          ) : !room ? (
            <>
              {mode === "intro" ? (
                <section className="gs-intro">
                  <div className="gs-orbit" aria-hidden="true">
                    {["🍝", "🍣", "🌮"].map((x, i) => (
                      <motion.span
                        key={x}
                        animate={reduced ? {} : { y: [0, -9, 0] }}
                        transition={{
                          duration: 3,
                          repeat: Infinity,
                          delay: i * 0.5,
                        }}
                      >
                        {x}
                      </motion.span>
                    ))}
                    <div>
                      <Users size={48} strokeWidth={1.3} />
                    </div>
                  </div>
                  <span className="gs-eyebrow">YOUR PEOPLE. YOUR PLACE.</span>
                  <h1>
                    A good night.
                    <br />
                    Decided together.
                  </h1>
                  <p>Bring your tastes. Find your common ground.</p>
                  <div className="gs-entry-actions">
                    {primary("Create a room", () => setMode("create"))}
                    <button
                      className="gs-secondary"
                      onClick={() => setMode("join")}
                    >
                      Join with a code
                    </button>
                  </div>
                  <small>One free room a week. Unlimited with Pro.</small>
                  {rooms.length > 0 && (
                    <div className="gs-recent">
                      <h2>Your rooms</h2>
                      {rooms.map((r) => (
                        <div className="gs-recent-room" key={r.id}>
                          <button className="gs-resume-room" disabled={!!busy} onClick={() => void run("join", { code: r.code })}>
                            <span>{r.location.label}<small>{r.code} · {r.status}</small></span><ArrowRight size={18} />
                          </button>
                          {r.host === user.id && <button className="gs-delete-room" disabled={!!busy} aria-label={`Delete room ${r.code}`} onClick={() => { setDeleteTarget(r); setConfirm("delete"); }}><Trash2 size={18} /></button>}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ) : mode === "join" ? (
                <section className="gs-form">
                  <button className="gs-text" onClick={() => setMode("intro")}>
                    <ArrowLeft size={16} /> Back
                  </button>
                  <span className="gs-hero-icon">
                    <Users />
                  </span>
                  <h1>You’re invited.</h1>
                  <p>Enter your friend’s room code.</p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run("join", { code });
                    }}
                  >
                    <input
                      aria-label="Room code"
                      className="gs-code-input"
                      value={code}
                      onChange={(e) =>
                        setCode(
                          e.target.value
                            .toUpperCase()
                            .replace(/[^A-Z0-9]/g, "")
                            .slice(0, 8),
                        )
                      }
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={8}
                      placeholder="A1B2 C3D4"
                    />
                    {primary(
                      "Join room",
                      () => void run("join", { code }),
                      code.length !== 8,
                    )}
                  </form>
                  <small>
                    Joining uses your GoodEats taste profile to find places for
                    this group.
                  </small>
                </section>
              ) : (
                <section className="gs-form">
                  <button className="gs-text" onClick={() => setMode("intro")}>
                    <ArrowLeft size={16} /> Back
                  </button>
                  <span className="gs-hero-icon">
                    <Plus />
                  </span>
                  <h1>Make a night of it.</h1>
                  <p>Pick the area. We’ll find the possibilities.</p>
                  <label>Where are we eating?</label>
                  <button
                    className="gs-location"
                    onClick={() => setLocationOpen(true)}
                  >
                    <MapPin size={21} />
                    <span>{home?.location?.label || "Choose a location"}</span>
                    <ChevronDown size={17} />
                  </button>
                  <label>Search radius</label>
                  <div className="gs-chips">
                    {[
                      [2000, "1 mi"],
                      [5000, "3 mi"],
                      [15000, "9 mi"],
                      [30000, "18 mi"],
                    ].map(([v, l]) => (
                      <button
                        key={v}
                        aria-pressed={radius === v}
                        onClick={() => setRadius(Number(v))}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  <label htmlFor="gs-count">
                    Places to swipe <strong>{count}</strong>
                  </label>
                  <input
                    id="gs-count"
                    type="range"
                    min={5}
                    max={15}
                    value={count}
                    onChange={(e) => setCount(+e.target.value)}
                  />
                  <div className="gs-range-label">
                    <span>Quick decision · 5</span>
                    <span>More choice · 15</span>
                  </div>
                  {primary(
                    "Create room",
                    () =>
                      void run("create", {
                        location: home?.location,
                        count,
                        radius,
                      }),
                    !home?.location,
                  )}
                  <small>
                    Your taste profile helps personalize this group’s
                    suggestions.
                  </small>
                </section>
              )}
            </>
          ) : room.status === "closed" ? (
            <section className="gs-center">
              <Users size={52} />
              <h1>This room has closed.</h1>
              {primary("Back to rooms", leaveView)}
            </section>
          ) : room.status === "generating" || busy === "generate" ? (
            <section className="gs-center gs-building">
              <GroupDiscovery location={room.location.label} count={room.count} names={members.map(([, m]) => m.name)} />
              {host && !busy && <button className="gs-text" onClick={() => void run("generate")}>Retry search</button>}
              {host && !busy && <button className="gs-text gs-leave" onClick={() => setConfirm("cancel")}>Close room</button>}
            </section>
          ) : room.status === "lobby" ? (
            <>
              <section className="gs-room-heading">
                <span className="gs-eyebrow">INVITE YOUR PEOPLE</span>
                <button
                  className="gs-room-code"
                  onClick={async () => {
                    setNotice(
                      (await copyToClipboard(room.code))
                        ? "Room code copied"
                        : "Couldn’t copy. Share the code above.",
                    );
                    homeHaptic();
                  }}
                  aria-label={`Copy room code ${room.code}`}
                >
                  {room.code.slice(0, 4)} {room.code.slice(4)}
                  <Copy size={18} />
                </button>
                <div className="gs-share-row">
                  <button
                    className="gs-secondary"
                    onClick={() => setShare(true)}
                  >
                    <Users size={17} /> In GoodEats
                  </button>
                  <button
                    className="gs-secondary"
                    onClick={async () => {
                      const result = await shareExternally({
                        title: "Decide together",
                        text: invite,
                        url: roomUrl,
                      });
                      if (result === "copied") setNotice("Invite copied");
                      if (result === "unsupported")
                        setNotice("Share the room code with your friends.");
                    }}
                  >
                    <Share2 size={17} /> Share invite
                  </button>
                </div>
                <div className="gs-room-meta">
                  <MapPin size={14} />
                  {room.location.label}
                  <span>· {room.count} places</span>
                  {host && (
                    <button
                      className="gs-text"
                      onClick={() => {
                        home?.setLocation(room.location);
                        setCount(room.count);
                        setRadius(room.radius);
                        setSettings(!settings);
                      }}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </section>
              {settings && host && (
                <section className="gs-form gs-room-settings">
                  <h2>Room settings</h2>
                  <button
                    className="gs-location"
                    onClick={() => setLocationOpen(true)}
                  >
                    <MapPin size={19} />
                    <span>{home?.location?.label}</span>
                    <ChevronDown size={16} />
                  </button>
                  <label>Search radius</label>
                  <div className="gs-chips">
                    {[
                      [2000, "1 mi"],
                      [5000, "3 mi"],
                      [15000, "9 mi"],
                      [30000, "18 mi"],
                    ].map(([v, l]) => (
                      <button
                        key={v}
                        aria-pressed={radius === v}
                        onClick={() => setRadius(Number(v))}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  <label htmlFor="gs-edit-count">
                    Places to swipe <strong>{count}</strong>
                  </label>
                  <input
                    id="gs-edit-count"
                    type="range"
                    min={5}
                    max={15}
                    value={count}
                    onChange={(e) => setCount(+e.target.value)}
                  />
                  {primary(
                    "Save settings",
                    () =>
                      void run("settings", {
                        location: home?.location,
                        count,
                        radius,
                      }),
                    !home?.location,
                  )}
                </section>
              )}
              {settings ? null : !member?.ready || editing ? (
                <section className="gs-preferences">
                  <div className="gs-section-heading">
                    <h1>Your mood tonight.</h1>
                    <span>Just for this room</span>
                  </div>
                  <label>Cuisine</label>
                  <GroupCuisinePicker selected={preferences.cuisines} onChange={cuisines => setPreferences(p => ({ ...p, cuisines }))} />
                  <label>
                    Budget <small>Any, if left open</small>
                  </label>
                  <div className="gs-chips">
                    {[1, 2, 3, 4].map((p) => (
                      <button
                        key={p}
                        aria-pressed={preferences.prices.includes(p)}
                        onClick={() => toggle("prices", p)}
                      >
                        {"$".repeat(p)}
                      </button>
                    ))}
                  </div>
                  <label htmlFor="gs-mood-notes">Anything else? <small>Optional</small></label>
                  <textarea
                    id="gs-mood-notes"
                    aria-label="What are you in the mood for?"
                    value={preferences.notes}
                    onChange={(e) =>
                      setPreferences((p) => ({ ...p, notes: e.target.value }))
                    }
                    maxLength={500}
                    placeholder="A cozy patio, something spicy, a great date spot…"
                    rows={2}
                  />

                </section>
              ) : (
                <section className="gs-members">
                  <div className="gs-section-heading">
                    <h2>Everyone’s here.</h2>
                    <button
                      className="gs-text"
                      onClick={() => setEditing(true)}
                    >
                      Edit my mood
                    </button>
                  </div>
                  {members.map(([id, m], i) => (
                    <div className="gs-member" key={id}>
                      <span className={`gs-avatar color-${i % 4}`}>
                        {m.name.slice(0, 1)}
                      </span>
                      <span>
                        <strong>{id === user.id ? "You" : m.name}</strong>
                        <small>
                          {id === room.host
                            ? "Host"
                            : m.ready
                              ? "Ready to go"
                              : "Choosing their mood"}
                        </small>
                      </span>
                      {m.ready ? (
                        <Check size={18} />
                      ) : (
                        <span className="gs-pulse-dot" />
                      )}
                      {host && id !== user.id && (
                        <button
                          className="gs-text"
                          aria-label={`Remove ${m.name}`}
                          onClick={() => void run("remove", { member: id })}
                        >
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                  {host ? (
                    primary(
                      "Find our places",
                      () => void run("generate"),
                      members.length < 2 || members.some(([, m]) => !m.ready),
                    )
                  ) : (
                    <p className="gs-wait-copy">
                      Your host will find the group’s places when everyone is
                      ready.
                    </p>
                  )}
                  {members.length < 2 && (
                    <small>Invite a friend to get started.</small>
                  )}
                </section>
              )}
              {!choosingMood && <button className="gs-text gs-leave" disabled={!!busy} onClick={leaveRoom}>{host ? "Close room" : "Leave room"}</button>}
            </>
          ) : room.status === "ready" ? (
            <section className="gs-center gs-building">
              <span className="gs-eyebrow">YOUR SHORTLIST IS READY</span>
              <h1>{room.deck.length} possibilities.<br />One good night.</h1>
              <div className="gs-deck-preview">{room.deck.slice(0, 3).map(p => <div key={p.id}>{featurePhoto(p)}</div>)}</div>
              <p>Swipe your yeses. Then rank your favorites.</p>
              {host ? primary("Start swiping", () => void run("start")) : <small>Waiting for your host to start.</small>}
              {host && <button className="gs-text gs-leave" onClick={() => setConfirm("cancel")}>Close room</button>}
            </section>
          ) : room.status === "swiping" && !current && member?.ranking && !member.ranking.done ? (
            <GroupPairwise ranking={member.ranking} deck={room.deck} busy={!!busy} photo={featurePhoto}
              choose={payload => { void run("rank", { ...payload, round: room.round }); }} />
          ) : room.status === "swiping" ? (
            <section className="gs-swiping">
              <div className="gs-section-heading">
                <span>
                  {current ? "1 · Find your yes" : "Your ranking is saved"}
                </span>
                <span>
                  {Math.min(
                    Object.keys(member?.votes || {}).length + 1,
                    room.deck.length,
                  )}{" "}
                  / {room.deck.length}
                </span>
              </div>
              <div className="gs-progress">
                <i
                  style={{
                    width: `${(Object.keys(member?.votes || {}).length / room.deck.length) * 100}%`,
                  }}
                />
              </div>
              {current ? (
                <>
                  <AnimatePresence mode="wait">
                    <motion.article
                      key={current.id}
                      className="gs-swipe-card"
                      drag={!busy}
                      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
                      dragElastic={0.6}
                      onDrag={(_, info) =>
                        setDragLabel(
                          swipeVote(info.offset.x, info.offset.y) || "",
                        )
                      }
                      onDragEnd={(_, info) => {
                        setDragLabel("");
                        const v = swipeVote(info.offset.x, info.offset.y);
                        if (v) vote(v);
                      }}
                      initial={{ opacity: 0, scale: reduced ? 1 : 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: reduced ? 1 : 0.94 }}
                      transition={{ duration: 0.18 }}
                      style={{ touchAction: "none" }}
                    >
                      {featurePhoto(current)}
                      <div className="gs-card-shade" />
                      <span className="gs-fit">
                        <Sparkles size={13} />
                        {current.fit}% taste fit
                      </span>
                      {dragLabel && (
                        <span className={`gs-drag-label ${dragLabel}`}>
                          {dragLabel === "yes"
                            ? "YES"
                            : dragLabel === "no"
                              ? "PASS"
                              : member?.vetoUsed
                                ? "VETO USED"
                                : "VETO"}
                        </span>
                      )}
                      <div className="gs-card-copy">
                        <span>
                          {current.cuisine}{" "}
                          {current.priceLevel > 0
                            ? `· ${"$".repeat(current.priceLevel)}`
                            : ""}
                        </span>
                        <h1>{current.name}</h1>
                        <p>{current.reason}</p>
                        <small>
                          {(current.distance / 1609).toFixed(1)} mi away{" "}
                          {current.rating > 0
                            ? `· ${current.rating} Google rating`
                            : ""}
                        </small>
                      </div>
                    </motion.article>
                  </AnimatePresence>
                  <div className="gs-live-votes" aria-live="polite">
                    {members
                      .filter(([, m]) => m.votes[current.id])
                      .map(([id, m]) => (
                        <span key={id}>
                          {m.name.split(" ")[0]}{" "}
                          {m.votes[current.id] === "yes"
                            ? "♥"
                            : m.votes[current.id] === "veto"
                              ? "⊘"
                              : "−"}
                        </span>
                      ))}
                    {members.every(([, m]) => !m.votes[current.id]) && (
                      <span>Your group’s votes appear here</span>
                    )}
                  </div>
                  <div className="gs-vote-actions">
                    <button
                      aria-label="Pass on restaurant"
                      disabled={!!busy}
                      onClick={() => vote("no")}
                    >
                      <X />
                      <span>Pass</span>
                    </button>
                    <button
                      className="gs-veto"
                      aria-label="Veto restaurant"
                      disabled={!!busy || member?.vetoUsed}
                      onClick={() => vote("veto")}
                    >
                      <ShieldX />
                      <span>{member?.vetoUsed ? "Used" : "Veto · 1"}</span>
                    </button>
                    <button
                      className="gs-yes"
                      aria-label="Like restaurant"
                      disabled={!!busy}
                      onClick={() => vote("yes")}
                    >
                      <Heart />
                      <span>Yes</span>
                    </button>
                  </div>
                  <small className="gs-swipe-hint">
                    ← Pass · Swipe right to like · ↓ Veto
                  </small>
                </>
              ) : (
                <div className="gs-center">
                  <span className="gs-hero-icon">
                    <Check />
                  </span>
                  <h1>You’re all set.</h1>
                  {member?.ranking?.ordered?.length ? <ol className="gs-personal-ranking">{member.ranking.ordered.map(id => <li key={id}>{room.deck.find(p => p.id === id)?.name}</li>)}</ol> : <small>No yeses this time. Your passes still count.</small>}
                  <p>
                    {done} of {members.length} finished. Your pick is on its
                    way.
                  </p>
                  <div className="gs-avatar-row">
                    {members.map(([id, m], i) => (
                      <span
                        title={`${m.name}: ${m.ranking?.done ? "Finished" : "Still deciding"}`}
                        className={`gs-avatar color-${i % 4}`}
                        key={id}
                      >
                        {m.ranking?.done ? (
                          <Check size={20} />
                        ) : (
                          m.name[0]
                        )}
                      </span>
                    ))}
                  </div>
                  {host && (
                    <button
                      className="gs-text gs-leave"
                      onClick={() => setConfirm("cancel")}
                    >
                      End session
                    </button>
                  )}
                </div>
              )}
            </section>
          ) : (
            <section className="gs-results">
              <span className="gs-eyebrow">
                {room.results.length && (room.results[0].score ?? 0) > 0
                  ? "TONIGHT, SORTED"
                  : "A LITTLE MORE COMMON GROUND"}
              </span>
              <h1>
                {!room.results.length
                  ? "Every place was vetoed."
                  : room.results[0].score === 0
                    ? "No shared yes yet."
                    : tiedPlaces(room).length > 1 && room.round === 1
                      ? "A close call."
                      : "Here’s your place."}
              </h1>
              <p>
                {!room.results.length
                  ? "Try a fresh room with a different mood."
                  : room.results[0].score === 0
                    ? "These places are still options, but nobody liked them."
                    : tiedPlaces(room).length > 1
                      ? "Equal rankings. Your group’s taste fit puts this one first."
                      : "A little of everyone, in one good pick."}
              </p>
              {room.results[0] && (
                <>
                  <div className="gs-winner">
                    {featurePhoto(room.results[0])}
                    <span className="gs-winner-badge">
                      <Crown size={16} />
                      {room.results[0].score} / 100 group fit
                    </span>
                  </div>
                  <div className="gs-winner-copy">
                    <h2>{room.results[0].name}</h2>
                    <p>
                      {room.results[0].cuisine} · {room.results[0].likes}/
                      {members.length} said yes
                    </p>
                    <span>{room.results[0].fit}% predicted taste fit</span>
                  </div>
                  {primary("See the place", () =>
                    navigate(`/restaurant/${room.results[0].id}`),
                  )}
                  <div className="gs-runners">
                    <h2>Also in the running</h2>
                    {room.results.slice(1).map((p, i) => (
                      <button
                        key={p.id}
                        onClick={() => navigate(`/restaurant/${p.id}`)}
                      >
                        <span className="gs-rank">{i + 2}</span>
                        {featurePhoto(p)}
                        <span>
                          <strong>{p.name}</strong>
                          <small>
                            {p.likes}/{members.length} yes · {p.score}/100 group fit
                          </small>
                        </span>
                        <ArrowRight size={16} />
                      </button>
                    ))}
                  </div>
                </>
              )}
              {room.vetoed.length > 0 && (
                <small>
                  {room.vetoed.length} vetoed{" "}
                  {room.vetoed.length === 1 ? "place" : "places"} excluded.
                </small>
              )}
              <details className="gs-scoring">
                <summary>How your pick is decided</summary>
                <p>
                  Your pairwise choices rank your yeses from 100 for your favorite
                  to 60 for your last choice. A single yes scores 100; a pass scores 0.
                  Group fit combines 60% of the average with 40% of the lowest score.
                  Any veto removes a place. Equal scores use your group’s predicted taste fit.
                </p>
              </details>
              <button
                className="gs-secondary"
                onClick={async () => {
                  const result = await shareExternally({
                    title: "Our GoodEats pick",
                    text: room.results[0]
                      ? `Our pick: ${room.results[0].name}\n${canonicalShareUrl(`/restaurant/${room.results[0].id}`)}`
                      : invite,
                  });
                  if (result === "copied") setNotice("Copied");
                }}
              >
                <Share2 size={17} /> Share result
              </button>
              <button className="gs-text gs-leave" onClick={leaveView}>
                Back to rooms
              </button>
            </section>
          )}
        </motion.div>
      </AnimatePresence>
      {choosingMood && <footer className="gs-mood-footer">
        {primary("I’m ready", saveMood)}
      </footer>}
      {(error || syncError) && (
        <div className="gs-error" role="alert">
          <span>{error || syncError}</span>
          {upgrade && (
            <button onClick={() => navigate("/pro")}>
              Explore Pro <ArrowRight size={15} />
            </button>
          )}
          <button
            aria-label="Dismiss error"
            onClick={() => {
              setError("");
              setSyncError("");
            }}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {notice && (
        <div className="gs-notice" role="status">
          {notice}
        </div>
      )}
      {confirm && (
        <dialog
          ref={confirmDialog}
          className="gs-confirm-backdrop"
          onCancel={() => setConfirm(null)}
        >
          <section className="gs-confirm" aria-labelledby="gs-confirm-title">
            <ShieldX size={32} />
            <h2 id="gs-confirm-title">
              {confirm === "veto" ? "Use your one veto?" : confirm === "delete" ? "Delete this room?" : "Close this room?"}
            </h2>
            <p>
              {confirm === "veto"
                ? "This removes the restaurant for everyone, including the deciding round."
                : "This ends the session for everyone and removes it from Your rooms."}
            </p>
            <button
              className="gs-primary"
              autoFocus
              onClick={() => {
                const c = confirm;
                setConfirm(null);
                if (c === "delete") { if (deleteTarget) void deleteRoom(deleteTarget); return; }
                void run(
                  c === "veto" ? "vote" : "cancel",
                  c === "veto"
                    ? { place: current?.id, vote: "veto", round: room?.round }
                    : {},
                );
              }}
            >
              {confirm === "veto" ? "Veto this place" : confirm === "delete" ? "Delete room" : "Close room"}
            </button>
            <button className="gs-secondary" onClick={() => setConfirm(null)}>
              Keep going
            </button>
          </section>
        </dialog>
      )}
      {home && (
        <HomeLocationBar
          variant="headless"
          open={locationOpen}
          onOpenChange={setLocationOpen}
          location={home.location}
          onChange={home.setLocation}
          onUseCurrent={home.useCurrent}
        />
      )}
      <ShareDialog
        open={share}
        onClose={() => setShare(false)}
        title="Invite to your room"
        payload={{ text: invite }}
        externalShareUrl={roomUrl}
      />
    </main>
  );
};
