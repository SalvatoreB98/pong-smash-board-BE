const applyCors = require('./cors');
const supabase = require('../services/db');

const getBearer = (req) => {
    const h = req.headers?.authorization || req.headers?.Authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    return h.slice('Bearer '.length).trim();
};

module.exports = (req, res) => {
    applyCors(req, res, async () => {
        if (req.method !== 'GET') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        try {
            // 1) Auth via Bearer
            const token = getBearer(req);
            if (!token) {
                return res.status(401).json({ error: 'Missing Bearer token' });
            }

            const { data: userData, error: userErr } = await supabase.auth.getUser(token);
            if (userErr || !userData?.user) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            const authUserId = userData.user.id;

            // 2) Ricava competizione attiva da user_state
            const { data: state, error: stateErr } = await supabase
                .from('user_state')
                .select('active_competition_id')
                .eq('user_id', authUserId)
                .maybeSingle();

            if (stateErr) throw stateErr;
            if (!state?.active_competition_id) {
                return res.status(404).json({ error: 'No active competition' });
            }

            // 3) Recupera i giocatori iscritti a quella competizione
            const { data: players, error: playersErr } = await supabase
                .from('competitions_players')
                .select(
                    `
          player:players (
            id,
            name,
            lastname,
            nickname,
            image_url
          )
          `
                )
                .eq('competition_id', state.active_competition_id);

            if (playersErr) throw playersErr;

            // normalizzo: [{player: {...}}, ...] → [{...}, ...]
            const result = (players || []).map((p) => p.player);

            return res.status(200).json(result);
        } catch (err) {
            console.error('Error get-players:', err?.message || err);
            return res.status(500).json({ error: 'Failed to fetch players' });
        }
    });
};
