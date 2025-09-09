// /api/get-competitions.js
const applyCors = require('./cors');
const supabase = require('../lib/supabase');
const { requireUser } = require('../lib/auth');
const uniqueBy = require('../lib/uniqueBy');
const handleError = require('../lib/error');

module.exports = (req, res) => {
  applyCors(req, res, async () => {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
      // 1) Auth via Bearer
      const user = await requireUser(req);

      // 2) Usa una RPC per ottenere tutte le competizioni correlate all'utente
      const { data, error } = await supabase.rpc('fn_get_user_competitions', {
        p_user_id: user.id,
      });
      if (error) throw error;

      const competitions = uniqueBy(data || []).sort((a, b) => {
        const da = a?.start_date || a?.startDate || '';
        const db = b?.start_date || b?.startDate || '';
        return (db || '').localeCompare(da || '');
      });

      return res.status(200).json({ competitions });
    } catch (err) {
      return handleError(res, err, 'Failed to fetch competitions.');
    }
  });
};
