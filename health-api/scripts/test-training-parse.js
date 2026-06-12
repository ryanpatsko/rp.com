const path = require('path');
const fs = require('fs');
const { parseTrainingDataWithSummary } = require('../scrapers/training');

const file =
  process.argv[2] ||
  path.join(process.env.USERPROFILE || '', 'Downloads', '100 Miler Training Plan - Training Schedule.csv');

const text = fs.readFileSync(file, 'utf8');
const result = parseTrainingDataWithSummary(text);
console.log('format:', result.format);
console.log('weeks:', result.weeks.length, 'entries:', result.entries.length);
console.log('first week:', result.weeks[0]);
console.log('sample entries:', result.entries.slice(0, 5));
console.log('weekly mileage (last 3):', result.weeklyMileage?.slice(-3));
