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
          <h2>March Madness Player Pool</h2>
          <p>Draft board and team lineups for the 2026 contest.</p>
        </Link>

        <div className="contests-card contests-admin-card">
          <h2>Contest admin</h2>
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
