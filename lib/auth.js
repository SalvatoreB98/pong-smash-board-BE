const supabase = require('./supabase');

const getBearer = (req) => {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  return h.startsWith('Bearer ') ? h.slice('Bearer '.length).trim() : null;
};

const requireUser = async (req) => {
  const token = getBearer(req);
  if (!token) {
    const err = new Error('Missing Bearer token');
    err.status = 401;
    throw err;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    const err = new Error('Invalid token');
    err.status = 401;
    throw err;
  }
  return data.user;
};

module.exports = { getBearer, requireUser };
