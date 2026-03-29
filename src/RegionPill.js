import React from 'react';

export function regionSlug(region) {
  if (!region || region === '—') return '';
  return String(region).toLowerCase().replace(/\s+/g, '-');
}

export function RegionPill({ region }) {
  const slug = regionSlug(region);
  if (!slug) return <>{region ?? '—'}</>;
  return <span className={`draft-region-pill draft-region-pill--${slug}`}>{region}</span>;
}
