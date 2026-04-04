import React from 'react';

export function TeamLogo({ url, title, className = '' }) {
  if (!url) return null;
  return (
    <img
      src={url}
      alt=""
      className={['player-team-logo', className].filter(Boolean).join(' ')}
      loading="lazy"
      decoding="async"
      title={title || undefined}
    />
  );
}

export function TeamLabel({ logoUrl, text }) {
  const label = text || '—';
  return (
    <span className="team-cell-with-logo">
      <TeamLogo url={logoUrl} title={label} />
      <span>{label}</span>
    </span>
  );
}
