const applyCors = require('./cors');
const supabase = require('../lib/supabase');
const { requireUser } = require('../lib/auth');
const handleError = require('../lib/error');

module.exports = (req, res) => {
    applyCors(req, res, async () => {
        if (req.method !== 'GET') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        try {
            // 1) Auth via Bearer
            const user = await requireUser(req);

            // 2) RPC per ottenere i giocatori della competizione attiva
            const { data: players, error } = await supabase.rpc('fn_get_active_competition_players', {
                p_user_id: user.id,
            });
            if (error) throw error;

            return res.status(200).json(players || []);
        } catch (err) {
            return handleError(res, err, 'Failed to fetch players');
        }
    });
};
