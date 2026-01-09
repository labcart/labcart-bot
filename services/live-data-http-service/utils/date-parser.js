/**
 * Natural date parsing utility
 * Handles: "today", "yesterday", "last sunday", "2024-12-30", etc.
 */

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Parse natural language date to YYYYMMDD format (for ESPN API)
 */
export function parseDate(input, format = 'YYYYMMDD') {
  const now = new Date();
  const lower = input?.toLowerCase()?.trim();

  let targetDate;

  if (!lower || lower === 'today') {
    targetDate = now;
  } else if (lower === 'yesterday') {
    targetDate = addDays(now, -1);
  } else if (lower === 'tomorrow') {
    targetDate = addDays(now, 1);
  } else if (lower.startsWith('last ')) {
    // "last sunday", "last monday", etc.
    const dayName = lower.replace('last ', '').trim();
    targetDate = getLastDayOfWeek(dayName, now);
  } else if (lower.startsWith('this ')) {
    // "this sunday" - could be past or future within current week
    const dayName = lower.replace('this ', '').trim();
    targetDate = getThisDayOfWeek(dayName, now);
  } else {
    // Try parsing as date string (ISO, etc.)
    // IMPORTANT: For date-only strings like "2026-01-01", JavaScript parses as UTC midnight
    // which causes timezone issues when formatting with local getDate()/getMonth()
    // Solution: Parse YYYY-MM-DD strings directly to avoid UTC interpretation
    const isoDateMatch = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateMatch) {
      // Parse as local date to avoid timezone shift
      const [, year, month, day] = isoDateMatch;
      targetDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    } else {
      const parsed = new Date(input);
      if (!isNaN(parsed.getTime())) {
        targetDate = parsed;
      } else {
        // Default to today if unparseable
        console.warn(`Could not parse date: "${input}", defaulting to today`);
        targetDate = now;
      }
    }
  }

  return formatDate(targetDate, format);
}

/**
 * Add days to a date
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Get the most recent occurrence of a day of week
 * e.g., "last sunday" from Wednesday Dec 25 → Sunday Dec 22
 */
function getLastDayOfWeek(dayName, fromDate) {
  const dayIndex = DAY_NAMES.indexOf(dayName.toLowerCase());
  if (dayIndex === -1) {
    console.warn(`Unknown day name: "${dayName}"`);
    return fromDate;
  }

  const result = new Date(fromDate);
  const currentDay = result.getDay();

  // Calculate days to go back
  let daysBack = currentDay - dayIndex;
  if (daysBack <= 0) {
    daysBack += 7; // Go back to previous week
  }

  result.setDate(result.getDate() - daysBack);
  return result;
}

/**
 * Get the day within the current week (could be past or future)
 */
function getThisDayOfWeek(dayName, fromDate) {
  const dayIndex = DAY_NAMES.indexOf(dayName.toLowerCase());
  if (dayIndex === -1) {
    console.warn(`Unknown day name: "${dayName}"`);
    return fromDate;
  }

  const result = new Date(fromDate);
  const currentDay = result.getDay();
  const diff = dayIndex - currentDay;

  result.setDate(result.getDate() + diff);
  return result;
}

/**
 * Format date to specified format
 */
export function formatDate(date, format = 'YYYYMMDD') {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  switch (format) {
    case 'YYYYMMDD':
      return `${year}${month}${day}`;
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'ISO':
      return date.toISOString();
    default:
      return `${year}${month}${day}`;
  }
}

/**
 * Get current date in various formats
 */
export function getCurrentDate(format = 'YYYYMMDD') {
  return formatDate(new Date(), format);
}

/**
 * Check if a date string represents today
 */
export function isToday(dateStr) {
  const today = getCurrentDate('YYYYMMDD');
  const parsed = parseDate(dateStr, 'YYYYMMDD');
  return today === parsed;
}

export default {
  parseDate,
  formatDate,
  getCurrentDate,
  isToday,
};
