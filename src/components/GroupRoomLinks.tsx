import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { canonicalShareUrl } from "../lib/native-share";
import { groupRoomPath } from "../lib/group-room-link";
export function GroupRoomLinks() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    const open = (url: string) => {
      if (!active) return;
      try {
        const u = new URL(url);
        if (
          ["https:", "http:"].includes(u.protocol) &&
          u.origin !== new URL(canonicalShareUrl("/")).origin
        )
          return;
      } catch {
        return;
      }
      const path = groupRoomPath(url);
      if (path) navigate(path);
    };
    const listener = App.addListener("appUrlOpen", ({ url }) => open(url));
    void App.getLaunchUrl().then((r) => {
      if (r?.url) open(r.url);
    });
    return () => {
      active = false;
      void listener.then((l) => l.remove());
    };
  }, [navigate]);
  return null;
}
