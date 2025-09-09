const applyCors = require('./cors');
const supabase = require('../lib/supabase');
const handleError = require('../lib/error');

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
                return res.status(400).json({ error: joinErr.message });
            }

            return res.status(200).json({
                message: 'Players added successfully',
                players: newPlayers,
                relations: joined,
            });
        } catch (err) {
            return handleError(res, err, 'Failed to add players');
        }
    });
};
    