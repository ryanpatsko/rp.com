import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as healthApi from '../healthApi';
import { TRAINING_ABBREVIATIONS, displayWorkout } from '../data/trainingAbbreviations';
import './Health.css';

const ACTIVITY_LEVELS = [
  { value: '', label: 'Select…' },
  { value: 'sedentary', label: 'Sedentary' },
  { value: 'light', label: 'Light (1–2 days/week)' },
  { value: 'moderate', label: 'Moderate (3–5 days/week)' },
  { value: 'active', label: 'Active (6–7 days/week)' },
  { value: 'very_active', label: 'Very active (athlete / 2× day)' },
];

const GENDERS = [
  { value: '', label: 'Select…' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other / prefer not to say' },
];

const DASHBOARD_SECTIONS = [
  { id: 'summary', statusId: 'analysis', tabLabel: 'Summary', title: 'Health Summary', refreshLabel: 'Run Analysis', phase: 4, scrape: null },
  { id: 'bloodwork', tabLabel: 'Blood Work', title: 'Blood Work', refreshLabel: 'Refresh Blood Work', phase: 2, scrape: 'bloodwork' },
  { id: 'garmin', tabLabel: 'Fitness', title: 'Fitness & Activity', refreshLabel: 'Sync Garmin', phase: 2, scrape: 'garmin' },
  { id: 'training', tabLabel: 'Training', title: 'Training Log', refreshLabel: 'Sync Training Log', phase: 2, scrape: 'training' },
  { id: 'nutrition', tabLabel: 'Nutrition', title: 'Nutrition', refreshLabel: null, phase: 3, scrape: null },
  { id: 'supplements', tabLabel: 'Supplements', title: 'Supplements', refreshLabel: null, phase: 3, scrape: null },
  { id: 'recovery', tabLabel: 'Recovery', title: 'Recovery', refreshLabel: null, phase: 3, scrape: null },
  { id: 'goals', tabLabel: 'Goals', title: 'Goals & Focus Areas', refreshLabel: null, phase: 3, scrape: null },
  {
    id: 'recommendations',
    statusId: 'analysis',
    tabLabel: 'AI',
    title: 'AI Recommendations',
    refreshLabel: 'Run Analysis',
    phase: 4,
    scrape: null,
  },
];

const TABS = [
  { id: 'profile', tabLabel: 'Profile', title: 'User Profile' },
  ...DASHBOARD_SECTIONS.map((s) => ({ id: s.id, tabLabel: s.tabLabel, title: s.title })),
];

const TAB_STORAGE_KEY = 'health_dashboard_tab';

const SCRAPE_FN = {
  training: healthApi.scrapeTraining,
  garmin: healthApi.scrapeGarmin,
  bloodwork: healthApi.scrapeBloodwork,
};

const DATA_FN = {
  training: healthApi.getDataTraining,
  garmin: healthApi.getDataGarmin,
  bloodwork: healthApi.getDataBloodwork,
};

const EMPTY_PROFILE = {
  gender: '',
  age: '',
  heightIn: '',
  weightLb: '',
  activityLevel: '',
};

function formatUpdated(iso) {
  if (!iso) return 'Never synced';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function panelEmptyMessage(section, hasData) {
  if (section.phase === 4) return 'AI analysis — coming in Phase 4.';
  if (section.phase === 3) return 'Manual entry forms — coming in Phase 3.';
  if (section.phase === 2 && !hasData) {
    return section.refreshLabel ? `No data yet. Use “${section.refreshLabel}” above.` : 'No data yet.';
  }
  return 'No data to display.';
}

function tabHasIndicator(tabId, statusById, profileComplete) {
  if (tabId === 'profile') return profileComplete ? 'ok' : 'warn';
  const section = DASHBOARD_SECTIONS.find((s) => s.id === tabId);
  if (!section) return null;
  const status = statusById[section.statusId || section.id];
  if (status?.hasData) return 'ok';
  return null;
}

function HealthLogin({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { token } = await healthApi.healthLogin(password);
      healthApi.setStoredToken(token);
      onSuccess(token);
    } catch (err) {
      setError(err.message || 'Invalid password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="health-login-card">
      <p>Personal health data is password protected. Enter your dashboard password to continue.</p>
      <form onSubmit={handleSubmit}>
        <div className="health-form-row">
          <label htmlFor="health-password">Password</label>
          <input
            id="health-password"
            type="password"
            className="health-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={submitting}
          />
        </div>
        <button type="submit" className="health-btn" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <p className="health-error">{error}</p>}
      </form>
    </div>
  );
}

function ProfileForm({ initial, onSaved }) {
  const [form, setForm] = useState({ ...EMPTY_PROFILE, ...initial });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm({ ...EMPTY_PROFILE, ...initial });
  }, [initial]);

  const update = (field) => (e) => {
    setSaved(false);
    setForm((f) => ({ ...f, [field]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {
        gender: form.gender,
        age: Number(form.age),
        heightIn: Number(form.heightIn),
        weightLb: Number(form.weightLb),
        activityLevel: form.activityLevel,
      };
      const res = await healthApi.putProfile(payload);
      onSaved(res.profile, res.complete);
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="health-profile-panel" onSubmit={handleSubmit}>
      <p className="health-section-meta" style={{ marginBottom: '0.75rem' }}>
        Required before AI analysis (Phase 4). Baseline context for all recommendations.
        {saved && (
          <>
            {' '}
            <span className="health-badge health-badge-complete">Saved</span>
          </>
        )}
      </p>
      <div className="health-profile-grid">
        <div className="health-form-row">
          <label htmlFor="profile-gender">Gender</label>
          <select id="profile-gender" className="health-select" value={form.gender} onChange={update('gender')}>
            {GENDERS.map((g) => (
              <option key={g.value || 'empty'} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <div className="health-form-row">
          <label htmlFor="profile-age">Age</label>
          <input
            id="profile-age"
            type="number"
            min="1"
            max="120"
            className="health-input"
            value={form.age}
            onChange={update('age')}
          />
        </div>
        <div className="health-form-row">
          <label htmlFor="profile-height">Height (in)</label>
          <input
            id="profile-height"
            type="number"
            min="48"
            max="96"
            step="0.5"
            className="health-input"
            value={form.heightIn}
            onChange={update('heightIn')}
          />
        </div>
        <div className="health-form-row">
          <label htmlFor="profile-weight">Weight (lb)</label>
          <input
            id="profile-weight"
            type="number"
            min="50"
            max="500"
            step="0.5"
            className="health-input"
            value={form.weightLb}
            onChange={update('weightLb')}
          />
        </div>
        <div className="health-form-row" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="profile-activity">Activity level</label>
          <select
            id="profile-activity"
            className="health-select"
            value={form.activityLevel}
            onChange={update('activityLevel')}
          >
            {ACTIVITY_LEVELS.map((a) => (
              <option key={a.value || 'empty'} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button type="submit" className="health-btn" style={{ marginTop: '0.5rem' }} disabled={saving}>
        {saving ? 'Saving…' : 'Save profile'}
      </button>
      {error && <p className="health-error">{error}</p>}
    </form>
  );
}

function GarminPreview({ data }) {
  const s = data?.summary || {};
  const stats = [
    ['VO2 Max', s.vo2Max != null ? `${s.vo2Max}` : '—'],
    ['Sleep score', s.sleepScore != null ? `${s.sleepScore}` : '—'],
    ['HRV', s.hrvMs != null ? `${s.hrvMs} ms` : '—'],
    ['Resting HR', s.restingHeartRate != null ? `${s.restingHeartRate} bpm` : '—'],
    ['Steps', s.steps != null ? `${s.steps}` : '—'],
    ['Body battery', s.bodyBatteryHigh != null ? `${s.bodyBatteryHigh}` : '—'],
  ];
  return (
    <div className="health-stats-grid">
      {stats.map(([label, value]) => (
        <div key={label} className="health-stat-card">
          <div className="health-stat-label">{label}</div>
          <div className="health-stat-value">{value}</div>
        </div>
      ))}
    </div>
  );
}

function TrainingPreview({ data }) {
  const entries = (data?.entries || []).slice(-21).reverse();
  const legend = data?.abbreviationLegend || TRAINING_ABBREVIATIONS;
  if (!entries.length) return <p className="health-section-placeholder">No entries in sheet.</p>;
  return (
    <div className="health-table-wrap">
      {data?.format === 'weekly' && (
        <p className="health-section-meta" style={{ marginBottom: '0.5rem' }}>
          Weekly schedule · {data.weekCount} weeks · showing last {entries.length} workouts
        </p>
      )}
      <table className="health-data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Day</th>
            <th>Workout</th>
            <th>Week mi</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e, i) => {
            const expanded = displayWorkout(e);
            const raw = e.workout || '—';
            const showRaw = expanded !== raw && raw !== '—';
            return (
              <tr key={`${e.rowIndex}-${e.day}-${e.date}-${i}`}>
                <td>{e.date || '—'}</td>
                <td>{e.day || '—'}</td>
                <td>
                  {expanded}
                  {showRaw && (
                    <span className="health-workout-raw" title="Sheet abbreviation">
                      {raw}
                    </span>
                  )}
                </td>
                <td>{e.weeklyMileage != null ? e.weeklyMileage : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <details className="health-abbrev-legend">
        <summary>Workout abbreviations</summary>
        <ul>
          {Object.entries(legend).map(([abbr, meaning]) => (
            <li key={abbr}>
              <strong>{abbr}</strong> — {meaning}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function TabPanel({ section, statusRow, sectionData, onRefresh, refreshing, refreshError }) {
  const updated = statusRow?.updatedAt;
  const hasData = statusRow?.hasData;
  const canRefresh = section?.phase === 2 && section?.scrape;

  const hasContent =
    (section.id === 'garmin' && sectionData?.summary) ||
    (section.id === 'training' && sectionData?.entries?.length) ||
    (section.id === 'bloodwork' && sectionData?.markers?.length);

  return (
    <div className="health-panel">
      <div className="health-panel-toolbar">
        <h2>{section.title}</h2>
        <span className="health-panel-meta">
          {formatUpdated(updated)}
          {hasData ? ' · synced' : ' · empty'}
        </span>
        {section.refreshLabel && (
          <button
            type="button"
            className="health-btn health-btn-secondary health-btn-sm"
            disabled={!canRefresh || refreshing}
            onClick={canRefresh ? onRefresh : undefined}
            title={canRefresh ? undefined : `Phase ${section.phase}`}
          >
            {refreshing ? 'Syncing…' : section.refreshLabel}
          </button>
        )}
      </div>
      {refreshError && <p className="health-error">{refreshError}</p>}
      <div className="health-panel-body">
        {section.id === 'garmin' && sectionData?.summary && <GarminPreview data={sectionData} />}
        {section.id === 'training' && sectionData?.entries?.length > 0 && <TrainingPreview data={sectionData} />}
        {section.id === 'bloodwork' && sectionData?.markers?.length > 0 && (
          <p className="health-section-placeholder">{sectionData.markers.length} markers loaded</p>
        )}
        {!hasContent && <div className="health-panel-empty">{panelEmptyMessage(section, hasData)}</div>}
      </div>
    </div>
  );
}

function HealthTabBar({ activeTab, onTabChange, statusById, profileComplete }) {
  return (
    <nav className="health-tab-bar" aria-label="Health dashboard sections">
      {TABS.map((tab) => {
        const indicator = tabHasIndicator(tab.id, statusById, profileComplete);
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`health-tab${activeTab === tab.id ? ' health-tab--active' : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.tabLabel}
            {indicator && <span className={`health-tab-dot health-tab-dot--${indicator}`} aria-hidden />}
          </button>
        );
      })}
    </nav>
  );
}

export default function HealthPage() {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [profileComplete, setProfileComplete] = useState(false);
  const [sectionStatus, setSectionStatus] = useState([]);
  const [sectionData, setSectionData] = useState({});
  const [refreshingId, setRefreshingId] = useState(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [refreshErrors, setRefreshErrors] = useState({});
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = sessionStorage.getItem(TAB_STORAGE_KEY);
      if (saved && TABS.some((t) => t.id === saved)) return saved;
    } catch (_) {
      /* ignore */
    }
    return 'profile';
  });

  const changeTab = (id) => {
    setActiveTab(id);
    try {
      sessionStorage.setItem(TAB_STORAGE_KEY, id);
    } catch (_) {
      /* ignore */
    }
  };

  const loadSectionData = useCallback(async () => {
    const ids = ['garmin', 'training', 'bloodwork'];
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const fn = DATA_FN[id];
          const res = await fn();
          return [id, res.data];
        } catch {
          return [id, null];
        }
      })
    );
    setSectionData(Object.fromEntries(results));
  }, []);

  const loadDashboard = useCallback(async () => {
    const [profileRes, statusRes] = await Promise.all([healthApi.getProfile(), healthApi.getStatus()]);
    setProfile(profileRes.profile);
    setProfileComplete(profileRes.complete);
    setSectionStatus(statusRes.sections || []);
    await loadSectionData();
  }, [loadSectionData]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = healthApi.getStoredToken();
      if (!token) {
        if (!cancelled) setLoading(false);
        return;
      }
      const ok = await healthApi.healthVerify(token);
      if (!ok) {
        healthApi.setStoredToken(null);
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        await loadDashboard();
        if (!cancelled) setAuthed(true);
      } catch (err) {
        console.error(err);
        healthApi.setStoredToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDashboard]);

  const handleRefresh = async (sectionId) => {
    const scrape = DASHBOARD_SECTIONS.find((s) => s.id === sectionId)?.scrape;
    if (!scrape || !SCRAPE_FN[scrape]) return;
    setRefreshingId(sectionId);
    setRefreshErrors((e) => ({ ...e, [sectionId]: null }));
    try {
      await SCRAPE_FN[scrape]();
      await loadDashboard();
    } catch (err) {
      setRefreshErrors((e) => ({ ...e, [sectionId]: err.message }));
    } finally {
      setRefreshingId(null);
    }
  };

  const handleSyncAll = async () => {
    setSyncingAll(true);
    setRefreshErrors({});
    try {
      const result = await healthApi.scrapeAll();
      const errors = {};
      if (result.training?.ok === false) errors.training = result.training.error;
      if (result.garmin?.ok === false) errors.garmin = result.garmin.error;
      if (result.bloodwork?.ok === false) errors.bloodwork = result.bloodwork.error;
      setRefreshErrors(errors);
      await loadDashboard();
    } catch (err) {
      setRefreshErrors({ _all: err.message });
    } finally {
      setSyncingAll(false);
    }
  };

  const handleLogin = async () => {
    setLoading(true);
    try {
      await loadDashboard();
      setAuthed(true);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    healthApi.setStoredToken(null);
    setAuthed(false);
    setProfile(null);
    setProfileComplete(false);
    setSectionStatus([]);
    setSectionData({});
  };

  const statusById = Object.fromEntries((sectionStatus || []).map((s) => [s.id, s]));

  if (loading) {
    return (
      <div className="health-page health-page--login">
        <div className="health-cp-shell">
          <p className="health-section-placeholder" style={{ padding: '2rem 0.75rem' }}>
            Loading…
          </p>
        </div>
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="health-page health-page--login">
        <div className="health-cp-shell">
          <Link to="/" className="health-back">
            ← Back to rp.com
          </Link>
          <h1 style={{ margin: '0.5rem 0 1rem', fontSize: '1.35rem' }}>Health Dashboard</h1>
          <HealthLogin onSuccess={handleLogin} />
        </div>
      </div>
    );
  }

  const profileInitial = profile
    ? {
        gender: profile.gender || '',
        age: profile.age ?? '',
        heightIn:
          profile.heightIn ??
          (profile.heightCm != null ? Math.round((Number(profile.heightCm) / 2.54) * 10) / 10 : ''),
        weightLb:
          profile.weightLb ??
          (profile.weightKg != null ? Math.round(Number(profile.weightKg) * 2.20462 * 10) / 10 : ''),
        activityLevel: profile.activityLevel || '',
      }
    : EMPTY_PROFILE;

  const activeSection = DASHBOARD_SECTIONS.find((s) => s.id === activeTab);

  return (
    <div className="health-page">
      <div className="health-cp-shell">
        <header className="health-cp-topbar">
          <div className="health-cp-topbar-title">
            <Link to="/" className="health-back">
              ← rp.com
            </Link>
            <h1>Health Dashboard</h1>
          </div>
          {profileComplete ? (
            <span className="health-badge health-badge-complete">Profile OK</span>
          ) : (
            <span className="health-badge health-badge-required">Profile required</span>
          )}
          <div className="health-cp-topbar-actions">
            <button
              type="button"
              className="health-btn health-btn-secondary health-btn-sm"
              disabled={syncingAll}
              onClick={handleSyncAll}
            >
              {syncingAll ? 'Syncing…' : 'Sync All'}
            </button>
            <button type="button" className="health-btn health-btn-sm" disabled title="Phase 4">
              Run Analysis
            </button>
            <button type="button" className="health-btn health-btn-secondary health-btn-sm" onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </header>

        {refreshErrors._all && <p className="health-error" style={{ margin: '0.25rem 0.75rem 0' }}>{refreshErrors._all}</p>}

        <HealthTabBar
          activeTab={activeTab}
          onTabChange={changeTab}
          statusById={statusById}
          profileComplete={profileComplete}
        />

        <div className="health-cp-panel" role="tabpanel">
          {activeTab === 'profile' && (
            <div className="health-panel">
              <div className="health-panel-toolbar">
                <h2>User Profile</h2>
              </div>
              <div className="health-panel-body">
                <ProfileForm
                  initial={profileInitial}
                  onSaved={(p, complete) => {
                    setProfile(p);
                    setProfileComplete(complete);
                  }}
                />
              </div>
            </div>
          )}
          {activeSection && (
            <TabPanel
              section={activeSection}
              statusRow={statusById[activeSection.statusId || activeSection.id]}
              sectionData={sectionData[activeSection.id]}
              onRefresh={() => handleRefresh(activeSection.id)}
              refreshing={refreshingId === activeSection.id || syncingAll}
              refreshError={refreshErrors[activeSection.id]}
            />
          )}
        </div>
      </div>
    </div>
  );
}
