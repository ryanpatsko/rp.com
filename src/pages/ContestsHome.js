import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as contestApi from '../contestApi';
import './Contests.css';

const CURRENT_CONTEST_ID = '2026-1';

export default function ContestsHome() {
  const navigate = useNavigate();
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminSubmitting, setAdminSubmitting] = useState(false);

  const handleAdminSubmit = async (e) => {
    e.preventDefault();
    setAdminError('');
    setAdminSubmitting(true);
    try {
      const { token } = await contestApi.adminLogin(CURRENT_CONTEST_ID, adminPassword);
      contestApi.setStoredAdminToken(CURRENT_CONTEST_ID, token);
      navigate(`/contests/pp/${CURRENT_CONTEST_ID}/admin`);
    } catch (err) {
      setAdminError(err.message || 'Invalid password');
    } finally {
      setAdminSubmitting(false);
    }
  };

  return (
    <div className="contests-page contests-home">
      <header className="contests-header">
        <Link to="/" className="contests-back">← Back to rp.com</Link>
        <h1>Contests</h1>
      </header>
      <main className="contests-main">
        <Link to={`/contests/pp/${CURRENT_CONTEST_ID}`} className="contests-card">
          <h2>
            <span className="contests-card-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="cardIconGradBball" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#4facfe" />
                    <stop offset="100%" stopColor="#00f2fe" />
                  </linearGradient>
                </defs>
                <circle cx="12" cy="12" r="10" stroke="url(#cardIconGradBball)" strokeWidth="1.5" fill="none" />
                <path d="M6 5 Q14 12 6 19" stroke="url(#cardIconGradBball)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                <path d="M18 5 Q10 12 18 19" stroke="url(#cardIconGradBball)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
            </span>
            {' '}2026 March Madness Player Pool
          </h2>
          <p>Draft board and team rosters for the 2026 contest.</p>
        </Link>

        <Link to="/contests/block/2026" className="contests-card">
          <h2>
            <span className="contests-card-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="cardIconGradGrid" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#4facfe" />
                    <stop offset="100%" stopColor="#00f2fe" />
                  </linearGradient>
                </defs>
                <rect x="3" y="3" width="18" height="18" rx="2" stroke="url(#cardIconGradGrid)" strokeWidth="1.5" fill="none" />
                <path d="M3 9h18M3 15h18M9 3v18M15 3v18" stroke="url(#cardIconGradGrid)" strokeWidth="1.2" />
              </svg>
            </span>
            {' '}2026 March Madness Block Pool
          </h2>
          <p>View blocks and winners for the 2026 contest.</p>
        </Link>

        <hr className="contests-home-divider" />

        <div className="contests-card contests-admin-card">
          <h2>
            <span className="contests-card-icon" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="cardIconGradLock" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#4facfe" />
                    <stop offset="100%" stopColor="#00f2fe" />
                  </linearGradient>
                </defs>
                <rect x="5" y="11" width="14" height="10" rx="2" ry="2" stroke="url(#cardIconGradLock)" strokeWidth="1.5" fill="none" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="url(#cardIconGradLock)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </svg>
            </span>
            {' '}Contest Admin
          </h2>
          <p>Password required to manage the contest (import players, enter draft picks).</p>
          <form onSubmit={handleAdminSubmit} className="contests-admin-form">
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Password"
              className="contests-admin-input"
              autoComplete="current-password"
              disabled={adminSubmitting}
            />
            <button type="submit" className="contests-admin-submit" disabled={adminSubmitting}>
              {adminSubmitting ? 'Checking…' : 'Enter admin'}
            </button>
          </form>
          {adminError && <p className="contests-admin-error">{adminError}</p>}
        </div>
      </main>
    </div>
  );
}
