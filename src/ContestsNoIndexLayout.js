import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';

/**
 * Wraps all /contests routes and sets meta robots noindex, nofollow
 * so search engines do not crawl or index the Contests section.
 */
export default function ContestsNoIndexLayout() {
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
