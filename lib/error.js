const handleError = (res, err, message = 'Internal Server Error') => {
  const status = err.status || 500;
  console.error(message, err?.message || err);
  return res.status(status).json({ error: message });
};

module.exports = handleError;
