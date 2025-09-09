const uniqueBy = (arr, key = 'id') => {
  const map = new Map();
  for (const item of arr || []) {
    if (!item || item[key] == null) continue;
    if (!map.has(item[key])) map.set(item[key], item);
  }
  return Array.from(map.values());
};

module.exports = uniqueBy;
