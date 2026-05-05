"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

const STORAGE_KEY = "cyrene_panel_name";
const DEFAULT_NAME = "CyrenePanel";

interface PanelNameContextType {
  panelName: string;
  updatePanelName: (name: string) => void;
}

const PanelNameContext = createContext<PanelNameContextType>({
  panelName: DEFAULT_NAME,
  updatePanelName: () => {},
});

export function usePanelName() {
  return useContext(PanelNameContext);
}

export function PanelNameProvider({ children }: { children: React.ReactNode }) {
  const [panelName, setPanelName] = useState<string>(DEFAULT_NAME);

  useEffect(() => {
    // 读缓存
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem(STORAGE_KEY);
      if (cached) {
        setPanelName(cached);
        document.title = cached;
      }
    }

    // 拉最新
    const fetchName = async () => {
      try {
        const { data, error } = await (api as any).api.settings.get();
        if (!error && data?.success && data.settings?.panelName) {
          const name = data.settings.panelName;
          setPanelName(name);
          localStorage.setItem(STORAGE_KEY, name);
          document.title = name;
        }
      } catch {
        // ignore
      }
    };
    fetchName();
  }, []);

  const updatePanelName = useCallback((name: string) => {
    setPanelName(name);
    localStorage.setItem(STORAGE_KEY, name);
    document.title = name;
  }, []);

  return (
    <PanelNameContext.Provider value={{ panelName, updatePanelName }}>
      {children}
    </PanelNameContext.Provider>
  );
}