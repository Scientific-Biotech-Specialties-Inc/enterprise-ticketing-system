import React, { createContext, useContext, useState, useCallback } from "react";
import { ToastContainer } from "@/components/ui/toast";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(({ type = "info", title, message, duration = 4000 }) => {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newToast = { id, type, title, message, duration };
    setToasts((prev) => [...prev, newToast]);
    return id;
  }, []);

  const toast = React.useMemo(() => ({
    success: (message, title = "SUCCESS") => addToast({ type: "success", title, message }),
    error: (message, title = "ERROR") => addToast({ type: "error", title, message }),
    warning: (message, title = "WARNING") => addToast({ type: "warning", title, message }),
    info: (message, title = "NOTICE") => addToast({ type: "info", title, message }),
    dismiss: dismissToast,
  }), [addToast, dismissToast]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    // Graceful fallback if used outside provider
    return {
      success: (m) => console.log("[Toast Success]", m),
      error: (m) => console.error("[Toast Error]", m),
      warning: (m) => console.warn("[Toast Warning]", m),
      info: (m) => console.info("[Toast Info]", m),
      dismiss: () => {},
    };
  }
  return context;
}
