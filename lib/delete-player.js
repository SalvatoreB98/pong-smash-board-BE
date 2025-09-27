const { createClient } = require('@supabase/supabase-js');
const applyCors = require('./cors');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

module.exports = (req, res) => {
    applyCors(req, res, async () => {
        if (req.method !== 'DELETE') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        const { competitionId, playerId } = req.body;
        if (!competitionId || !playerId) {
            return res.status(400).json({ error: 'Missing competitionId or playerId' });
        }

        try {
            // 1) Elimina dalla tabella competitions_players
            const { error: compPlayerErr } = await supabase
                .from('competitions_players')
                .delete()
                .eq('competition_id', competitionId)
                .eq('player_id', playerId);

            if (compPlayerErr) {
                console.error('Error deleting from competitions_players:', compPlayerErr);
                return res.status(400).json({ error: compPlayerErr.message });
            }

            // 2) Controlla se il player ha auth_user_id
            const { data: playerData, error: playerFetchErr } = await supabase
                .from('players')
                .select('auth_user_id')
                .eq('id', playerId)
                .single();

            if (playerFetchErr) {
                console.error('Error fetching player:', playerFetchErr);
                return res.status(400).json({ error: playerFetchErr.message });
            }

            // 3) Se non ha auth_user_id, elimina anche dalla tabella players
            if (!playerData.auth_user_id) {
                const { error: playerDelErr } = await supabase
                    .from('players')
                    .delete()
                    .eq('id', playerId);

                if (playerDelErr) {
                    console.error('Error deleting player:', playerDelErr);
                    return res.status(400).json({ error: playerDelErr.message });
                }
            }

            return res.status(200).json({
                message: 'Player removed from competition (and deleted if admin-created)'
            });
        } catch (err) {
            console.error('Unexpected error deleting player:', err);
            return res.status(500).json({ error: 'Failed to delete player' });
        }
    });
};
