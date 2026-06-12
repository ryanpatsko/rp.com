import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';

/** Wraps /health routes with noindex for personal data. */
export default function HealthNoIndexLayout() {
  useEffect(() => {
    let meta = document.querySelector('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'robots');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', 'noindex, nofollow');
    return () => {
      meta.remove();
    };
  }, []);

  return <Outlet />;
}
