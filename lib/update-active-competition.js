// /api/update-active-competition.js
const { createClient } = require('@supabase/supabase-js');
const applyCors = require('./cors');

// Client con SERVICE KEY (necessario per scrivere in sicurezza)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ---- helpers
const getBearer = (req) => {
    const h = req.headers?.authorization || req.headers?.Authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    return h.slice('Bearer '.length).trim();
};

module.exports = (req, res) => {
    applyCors(req, res, async () => {
        try {
            // Consenti solo POST (OPTIONS è gestito dentro applyCors)
            if (req.method !== 'POST') {
                return res.status(405).json({ error: 'Method Not Allowed' });
            }

            // 1) Auth via Bearer
            const token = getBearer(req);
            if (!token) return res.status(401).json({ error: 'Missing Bearer token' });

            const { data: userData, error: userErr } = await supabase.auth.getUser(token);
            if (userErr || !userData?.user) {
                return res.status(401).json({ error: 'Invalid token' });
            }
            const user = userData.user;

            // 2) Payload
            const { competitionId } = req.body || {};
            if (!competitionId) {
                return res.status(400).json({ error: 'Missing competitionId in request body' });
            }

            // 3) Aggiorna la competizione attiva
            const { data, error } = await supabase
                .from('user_state')
                .upsert(
                    {
                        user_id: user.id,
                        active_competition_id: competitionId,
                        updated_at: new Date().toISOString(),
                    },
                    { onConflict: 'user_id' } // richiede vincolo UNIQUE su user_id
                )
                .select('id, user_id, active_competition_id, updated_at, created_at')
                .single();

            if (error) throw error;

            return res.status(200).json(data);
        } catch (e) {
            console.error('/api/update-active-competition error:', e?.message || e);
            return res.status(500).json({ error: 'Failed to update active competition' });
        }
    });
};
