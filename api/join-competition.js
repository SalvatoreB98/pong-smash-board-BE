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
            // ✅ Trova la competizione con quel codice
            const { data: competition, error: compError } = await supabase
                .from('competitions')
                .select('id, name')
                .eq('code', code)
                .single();

            const { data: profile, error: profileError } = await supabase
                .from('v_user_profile')
                .select('player_id')
                .eq('user_id', userId)
                .single();

            if (compError || !competition) {
                console.error('Competition not found:', compError?.message);
                return res.status(404).json({ error: 'Competition not found' });
            }

            if (profileError || !profile) {
                return res.status(404).json({ error: 'Player not found for this user' });
            }
            const playerId = profile.player_id;

            // ✅ Inserisci relazione in players_competitions
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

            return res.status(200).json({
                message: 'Joined competition successfully',
                competition: {
                    id: competition.id,
                    name: competition.name,
                },
                relation
            });
        } catch (error) {
            console.error('Error joining competition:', error.message);
            return res.status(500).json({ error: 'Failed to join competition' });
        }
    });
};
