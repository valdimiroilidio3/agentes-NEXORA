'use client';

import { useEffect } from 'react';
import { useOfficeStore } from '@/store/officeStore';

export function Toast() {
  const toast = useOfficeStore((state) => state.toast);
  const dismiss = useOfficeStore((state) => state.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(dismiss, 6500);
    return () => window.clearTimeout(timer);
  }, [toast, dismiss]);

  if (!toast) return null;

  return (
    <div className={`toast toast--${toast.level}`} role="status" aria-live="polite">
      <span className="toast__message">{toast.message}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss notification">
        ✕
      </button>
    </div>
  );
}
