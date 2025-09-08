const { createClient } = require('@supabase/supabase-js');
const applyCors = require('./cors');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

module.exports = (req, res) => {
    applyCors(req, res, async () => {
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        const { players, competitionId } = req.body;
        if (!players || !competitionId) {
            return res.status(400).json({ error: 'Missing players or competitionId' });
        }

        try {
            // 1) Inserisci i giocatori in `players`
            const { data: newPlayers, error: playersErr } = await supabase
                .from('players')
                .insert(
                    players.map(p => ({
                        name: p.name ?? '',
                        lastname: p.surname ?? '',
                        nickname: p.nickname,
                        image_url: p.imageUrl,
                        auth_user_id: null // admin-created player
                    }))
                )
                .select();

            if (playersErr) {
                console.error('Error inserting players:', playersErr);
                return res.status(400).json({ error: playersErr.message });
            }

            // 2) Inserisci join in competitions_players
            const joins = newPlayers.map(pl => ({
                competition_id: competitionId,
                player_id: pl.id,
            }));

            const { data: joined, error: joinErr } = await supabase
                .from('competitions_players')
                .insert(joins)
                .select();

            if (joinErr) {
                console.error('Error inserting competition players:', joinErr);
                return res.status(400).json({ error: joinErr.message });
            }

            return res.status(200).json({
                message: 'Players added successfully',
                players: newPlayers,
                relations: joined,
            });
        } catch (err) {
            console.error('Unexpected error inserting players:', err);
            return res.status(500).json({ error: 'Failed to add players' });
        }
    });
};
    