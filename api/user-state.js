// /api/user-state.js
const applyCors = require('./cors');
const supabase = require('../lib/supabase');
const { requireUser } = require('../lib/auth');
const handleError = require('../lib/error');

module.exports = (req, res) => {
  applyCors(req, res, async () => {
    try {
      // Consenti solo GET e POST (OPTIONS è gestito dentro applyCors)
      if (!['GET', 'POST'].includes(req.method)) {
        return res.status(405).json({ error: 'Method Not Allowed' });
      }

      // 1) Auth via Bearer
      const user = await requireUser(req);

      if (req.method === 'GET') {
        // 2) Read user_state per utente
        const { data, error } = await supabase
          .from('v_user_profile')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) throw error;

        // Cache privata, varia per Authorization (come in get-competitions)
        res.setHeader('Cache-Control', 'private, max-age=60');
        res.setHeader('Vary', 'Authorization');

        return res.status(200).json(data ?? {});
      }

      if (req.method === 'POST') {
        const { state, active_competition_id = null } = req.body || {};

        // 3) Upsert su chiave unica user_id (assicurati che esista UNIQUE(user_id) sulla tabella)
        const { data, error } = await supabase
          .from('user_state')
          .upsert(
            {
              user_id: user.id,
              ...(state !== undefined ? { state } : {}),
              active_competition_id,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' } // richiede un vincolo UNIQUE su user_id
          )
          .select('id, user_id, state, active_competition_id, updated_at, created_at')
          .single();

        if (error) throw error;

        return res.status(200).json(data);
      }
    } catch (e) {
      return handleError(res, e, 'Failed to handle user_state');
    }
  });
};
