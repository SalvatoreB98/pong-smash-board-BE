const { formatDateForDB } = require('../utils/utils');

const normalizeDate = (d) => {
  if (!d) return null;
  try {
    return formatDateForDB ? formatDateForDB(d) : new Date(d).toISOString().slice(0, 10);
  } catch {
    return null;
  }
};

module.exports = normalizeDate;
