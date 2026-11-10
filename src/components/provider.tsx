"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_SETTINGS, SETTINGS_KEY, settingsSchema } from "@/lib/settings";
import type { Settings } from "@/lib/types";
const Context = createContext<{
  demo: boolean;
  settings: Settings;
  ready: boolean;
  save: (settings: Settings) => boolean;
}>({
  demo: false,
  settings: DEFAULT_SETTINGS,
  ready: false,
  save: () => false,
});
export function AppProvider({
  children,
  demo,
}: {
  children: ReactNode;
  demo: boolean;
}) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const value = localStorage.getItem(SETTINGS_KEY);
        if (value) {
          const parsed = settingsSchema.safeParse(JSON.parse(value));
          if (parsed.success) setSettings(parsed.data);
        }
      } catch {
        /* Armazenamento indisponível: padrões da sessão. */
      }
      setReady(true);
    });
  }, []);
  function save(value: Settings) {
    const parsed = settingsSchema.safeParse(value);
    if (!parsed.success) return false;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed.data));
      setSettings(parsed.data);
      return true;
    } catch {
      return false;
    }
  }
  return (
    <Context.Provider value={{ demo, settings, ready, save }}>
      {children}
    </Context.Provider>
  );
}
export const useApp = () => useContext(Context);
