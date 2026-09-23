"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { logout as requestLogout } from "./auth-client";

export function useAuthActions() {
  const queryClient = useQueryClient();
  const logout = useCallback(async () => {
    try {
      await requestLogout();
    } finally {
      queryClient.clear();
      if (typeof window !== "undefined") {
        for (const key of Object.keys(window.localStorage)) {
          if (key === "langreport-project-id" || key.startsWith("langreport-conversation-")) window.localStorage.removeItem(key);
        }
        window.dispatchEvent(new Event("langreport:generation-abort"));
        window.location.assign("/login");
      }
    }
  }, [queryClient]);

  return { logout };
}
