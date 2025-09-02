const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const applyCors = require('./cors');

module.exports = (req, res) => {
    applyCors(req, res, async () => {
        // ✅ Consenti solo POST
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        const { userId, code } = req.body;

        if (!userId || !code) {
            return res.status(400).json({ error: 'Invalid data. userId and code are required.' });
        }

        try {
            // 1) Trova la competizione
            const { data: competition, error: compError } = await supabase
                .from('competitions')
                .select('*')
                .eq('code', code)
                .single();

            if (compError || !competition) {
                console.error('Competition not found:', compError?.message);
                return res.status(404).json({ error: compError?.message || 'Competition not found' });
            }

            if (competition.management === 'admin') {
                return res.status(403).json({
                    error: 'This competition is managed by admin and cannot be joined.',
                    code: 'admin-managed'
                });
            }

            // 2) Trova il playerId di questo utente
            const { data: profile, error: profileError } = await supabase
                .from('v_user_profile')
                .select('player_id')
                .eq('user_id', userId)
                .single();

            if (profileError || !profile) {
                return res.status(404).json({ error: 'Player not found for this user' });
            }
            const playerId = profile.player_id;

            // 3) Inserisci relazione in competitions_players
            const { data: relation, error: relError } = await supabase
                .from('competitions_players')
                .insert([
                    {
                        player_id: playerId,
                        competition_id: competition.id
                    }
                ])
                .select()
                .single();

            if (relError) {
                console.error('Error inserting relation:', relError.message);
                return res.status(400).json({ error: relError.message });
            }

            // 4) Carica tutti i giocatori iscritti alla competizione
            const { data: players, error: playersError } = await supabase
                .from('players')
                .select('id, name, lastname, nickname, image_url, auth_user_id')
                .in(
                    'id',
                    await supabase
                        .from('competitions_players')
                        .select('player_id')
                        .eq('competition_id', competition.id)
                        .then(r => (r.data || []).map(x => x.player_id))
                );

            if (playersError) {
                console.error('Error fetching players:', playersError.message);
                return res.status(400).json({ error: playersError.message });
            }

            // 5) Carica lo user_state SOLO dell'utente attuale
            const { data: userState, error: userStateError } = await supabase
                .from('user_state')
                .select('*')
                .eq('user_id', userId)
                .single();

            if (userStateError) {
                console.error('Error fetching user_state:', userStateError.message);
                // non blocca la join, semplicemente ritorna null
            }

            // ✅ Risposta finale pulita
            return res.status(200).json({
                message: 'Joined competition successfully',
                competition: {
                    id: competition.id,
                    name: competition.name,
                    type: competition.type,
                    sets_type: competition.sets_type,
                    points_type: competition.points_type,
                    start_date: competition.start_date,
                    created_at: competition.created_at,
                    management: competition.management,
                    players
                },
                user_state: userState || null,
                relation
            });
        } catch (error) {
            console.error('Error joining competition:', error.message);
            return res.status(500).json({ error: 'Failed to join competition' });
        }
    });
};
