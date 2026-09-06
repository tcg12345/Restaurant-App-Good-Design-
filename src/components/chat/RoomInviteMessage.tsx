import React from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Users } from "lucide-react";
/** Room links become native navigation, rather than opening a second browser session. */
export function RoomInviteMessage({ text }: { text: string }) {
  const navigate = useNavigate();
  const code = text.match(/\/decide\?code=([A-Z0-9]{8})(?:\b|$)/)?.[1];
  if (!code) return <>{text}</>;
  return (
    <>
      <span>
        {text
          .split("\n")
          .filter((line) => !line.includes("/decide?code="))
          .join("\n")}
      </span>
      <button
        type="button"
        onClick={() => navigate(`/decide?code=${code}`)}
        className="mt-3 flex items-center gap-3 w-full rounded-2xl px-4 py-3 bg-black/10 dark:bg-white/10 text-inherit"
      >
        <Users size={20} />
        <span className="flex-1 text-left text-sm font-semibold">
          Join room · {code}
        </span>
        <ArrowUpRight size={17} />
      </button>
    </>
  );
}
