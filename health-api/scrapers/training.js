const http = require('http');
const https = require('https');
const { ABBREVIATIONS, expandWorkoutText } = require('./training-abbreviations');

const DAY_OFFSET_FROM_SATURDAY = {
  m: -5,
  t: -4,
  w: -3,
  th: -2,
  f: -1,
  sa: 0,
  su: 1,
};

/** GET URL as text (Node https — works on all Lambda Node runtimes). */
function fetchText(url, timeoutMs = 20000, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      reject(new Error(`Invalid TRAINING_SHEET_CSV_URL: ${e.message}`));
      return;
    }
    const lib = parsed.protocol === 'http:' ? http : https;
    const req = lib.get(
      parsed,
      {
        headers: {
          'User-Agent': 'rp-health-api/1.0',
          Accept: 'text/csv,text/plain,*/*',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          const next = new URL(res.headers.location, parsed).href;
          fetchText(next, timeoutMs, redirectsLeft - 1).then(resolve).catch(reject);
          return;
        }
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
          if (data.length > 5_000_000) {
            req.destroy();
            reject(new Error('Sheet response too large (>5MB)'));
          }
        });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            reject(
              new Error(
                `Sheet fetch failed (HTTP ${res.statusCode}). Publish the sheet to web and use the csv export link.`
              )
            );
            return;
          }
          resolve(data);
        });
      }
    );
    req.on('error', (e) => reject(new Error(`Sheet fetch network error: ${e.message}`)));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Sheet fetch timed out (20s). Increase Lambda timeout to 30s if needed.'));
    });
  });
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '');
}

function findCol(headers, candidates) {
  const norm = headers.map(normalizeHeader);
  for (const c of candidates) {
    const idx = norm.indexOf(normalizeHeader(c));
    if (idx >= 0) return idx;
  }
  for (let i = 0; i < norm.length; i++) {
    if (candidates.some((c) => norm[i].includes(normalizeHeader(c)))) return i;
  }
  return -1;
}

function parseNumber(val) {
  if (val == null || val === '') return null;
  const n = Number(String(val).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function parseSheetDate(s) {
  const m = String(s || '')
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  const month = parseInt(m[1], 10) - 1;
  const day = parseInt(m[2], 10);
  const d = new Date(year, month, day);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatSheetDate(d) {
  if (!d) return '';
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

function addDays(date, n) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return { cells };
  });
  return { headers, rows };
}

function indexDayColumns(headers, startIdx = 0, endIdx = headers.length) {
  const days = [];
  const end = Math.min(endIdx, headers.length);
  for (let i = Math.max(0, startIdx); i < end; i++) {
    const n = normalizeHeader(headers[i]);
    if (DAY_OFFSET_FROM_SATURDAY[n] != null) {
      days.push({ day: n, label: String(headers[i] || n).trim().toUpperCase(), idx: i });
    }
  }
  return days;
}

function isWeeklyScheduleFormat(headers) {
  const satDate = findCol(headers, ['sat date', 'saturday date', 'week date']);
  const miles = findCol(headers, ['miles', 'weekly miles', 'mileage']);
  const conflicts = findCol(headers, ['conflicts']);
  const dayStart = conflicts >= 0 ? conflicts + 1 : 4;
  const dayEnd = miles >= 0 ? miles : headers.length;
  const days = indexDayColumns(headers, dayStart, dayEnd);
  return satDate >= 0 && miles >= 0 && days.length >= 4;
}

function parseWeeklySchedule(rows, headers) {
  const weekIdx = normalizeHeader(headers[0]) === 'w' ? 0 : findCol(headers, ['week']);
  const satDateIdx = findCol(headers, ['sat date', 'saturday date']);
  const raceIdx = findCol(headers, ['race run', 'race', 'race / run']);
  const conflictsIdx = findCol(headers, ['conflicts']);
  const milesIdx = findCol(headers, ['miles', 'weekly miles']);
  const commentsIdx = findCol(headers, ['comments', 'comment', 'notes']);
  const dayStart = conflictsIdx >= 0 ? conflictsIdx + 1 : 4;
  const dayEnd = milesIdx >= 0 ? milesIdx : headers.length;
  const dayCols = indexDayColumns(headers, dayStart, dayEnd);

  const entries = [];
  const weeks = [];

  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].cells;
    const pick = (idx) => (idx >= 0 && idx < cells.length ? String(cells[idx] ?? '').trim() : '');

    const weekNum = parseNumber(pick(weekIdx));
    const satDateStr = pick(satDateIdx);
    const weekStart = parseSheetDate(satDateStr);
    const weeklyMileage = parseNumber(pick(milesIdx));
    const comments = pick(commentsIdx);
    const race = pick(raceIdx);
    const conflicts = pick(conflictsIdx);

    if (!weekStart && weeklyMileage == null && !comments && dayCols.every((d) => !pick(d.idx))) {
      continue;
    }

    weeks.push({
      rowIndex: r + 2,
      week: weekNum,
      weekStartDate: satDateStr,
      weeklyMileage,
      comments,
      race,
      conflicts,
    });

    for (const { day, label, idx } of dayCols) {
      const workout = pick(idx);
      if (!workout) continue;
      const offset = DAY_OFFSET_FROM_SATURDAY[day];
      const dayDate = weekStart ? addDays(weekStart, offset) : null;
      const workoutExpanded = expandWorkoutText(workout);
      entries.push({
        rowIndex: r + 2,
        week: weekNum,
        weekStartDate: satDateStr,
        day: label,
        date: dayDate ? formatSheetDate(dayDate) : satDateStr,
        workout,
        workoutExpanded: workoutExpanded !== workout ? workoutExpanded : undefined,
        weeklyMileage,
        feel: comments,
        race: race || undefined,
        conflicts: conflicts || undefined,
      });
    }
  }

  return { entries, weeks };
}

function toFlatTrainingEntries(rows, headers) {
  let dateIdx = findCol(headers, ['date', 'day', 'workout date']);
  let typeIdx = findCol(headers, ['workout', 'type', 'workout type', 'activity']);
  let descIdx = findCol(headers, ['description', 'notes', 'workout description', 'details']);
  let milesIdx = findCol(headers, ['mileage', 'miles', 'daily mileage', 'distance', 'mi']);
  let weeklyIdx = findCol(headers, ['weekly mileage', 'week miles', 'weekly miles']);
  let feelIdx = findCol(headers, ['feel', 'accomplishment', 'weekly feel', 'week notes', 'comments']);

  const usePositional = dateIdx < 0 && typeIdx < 0 && rows.length > 0;
  if (usePositional) {
    dateIdx = 0;
    typeIdx = 1;
    milesIdx = 2;
    feelIdx = 3;
  }

  return rows
    .map((row, i) => {
      const cells = row.cells;
      const pick = (idx) => (idx >= 0 && idx < cells.length ? cells[idx] : '');
      const date = dateIdx >= 0 ? pick(dateIdx) : '';
      const workout = typeIdx >= 0 ? pick(typeIdx) : '';
      const description = descIdx >= 0 ? pick(descIdx) : '';
      const mileage = milesIdx >= 0 ? parseNumber(pick(milesIdx)) : null;
      const weeklyMileage = weeklyIdx >= 0 ? parseNumber(pick(weeklyIdx)) : null;
      const feel = feelIdx >= 0 ? pick(feelIdx) : '';
      const hasContent = date || workout || description || mileage != null || feel || weeklyMileage != null;
      if (!hasContent) return null;
      const workoutStr = String(workout).trim();
      const workoutExpanded = expandWorkoutText(workoutStr);
      return {
        rowIndex: i + 2,
        date: String(date).trim(),
        workout: workoutStr,
        workoutExpanded: workoutExpanded !== workoutStr ? workoutExpanded : undefined,
        description: String(description).trim(),
        mileage,
        weeklyMileage,
        feel: String(feel).trim(),
      };
    })
    .filter(Boolean);
}

function weeklyMileageSummary(entries, weeks) {
  if (weeks && weeks.length) {
    return weeks
      .filter((w) => w.weeklyMileage != null && w.weekStartDate)
      .map((w) => ({
        label: w.weekStartDate,
        miles: w.weeklyMileage,
        week: w.week,
        comments: w.comments || '',
      }))
      .slice(-24);
  }
  const byWeek = {};
  for (const e of entries) {
    if (e.weeklyMileage != null && e.date) {
      byWeek[e.date] = e.weeklyMileage;
    }
  }
  return Object.entries(byWeek)
    .map(([label, miles]) => ({ label, miles }))
    .slice(-16);
}

function parseTrainingData(text) {
  const { headers, rows } = parseCsv(text);
  let entries = [];
  let weeks = [];
  let format = 'flat';

  if (isWeeklyScheduleFormat(headers)) {
    format = 'weekly';
    const parsed = parseWeeklySchedule(rows, headers);
    entries = parsed.entries;
    weeks = parsed.weeks;
  } else {
    entries = toFlatTrainingEntries(rows, headers);
  }

  if (!entries.length && !weeks.length) {
    const hint = headers.length
      ? `Found headers: ${headers.slice(0, 12).join(', ')}`
      : 'No header row found';
    throw new Error(`No training rows parsed. ${hint}`);
  }

  entries.sort((a, b) => {
    const da = parseSheetDate(a.date);
    const db = parseSheetDate(b.date);
    if (da && db) return da - db;
    return 0;
  });

  return { headers, entries, weeks, format };
}

async function fetchTrainingSheet(csvUrl) {
  const text = await fetchText(csvUrl);
  const trimmed = text.trim();
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<')) {
    throw new Error(
      'Sheet URL returned HTML, not CSV. In Google Sheets: File → Share → Publish to web → CSV, then use the export?format=csv URL.'
    );
  }
  const { headers, entries, weeks, format } = parseTrainingData(text);
  const syncedAt = new Date().toISOString();
  const weeklyMileage = weeklyMileageSummary(entries, weeks);
  return {
    syncedAt,
    sourceUrl: csvUrl,
    format,
    entryCount: entries.length,
    weekCount: weeks.length,
    entries: entries.slice(-200),
    weeks: weeks.slice(-52),
    weeklyMileage,
    abbreviationLegend: ABBREVIATIONS,
    rawHeaders: headers,
  };
}

function parseTrainingDataWithSummary(text) {
  const parsed = parseTrainingData(text);
  return { ...parsed, weeklyMileage: weeklyMileageSummary(parsed.entries, parsed.weeks) };
}

module.exports = {
  fetchTrainingSheet,
  parseTrainingData,
  parseTrainingDataWithSummary,
  fetchText,
};
