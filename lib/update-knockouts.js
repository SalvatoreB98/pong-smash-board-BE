const applyCors = require('./cors');
const supabase = require('../services/db');

module.exports = (req, res) => {
    applyCors(req, res, async () => {
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        const {
            id,
            player1Id,
            player2Id,
            player1Score,
            player2Score,
            winnerId,
            roundName,
            competitionId,
        } = req.body;

        if (!id || !competitionId) {
            return res.status(400).json({ error: 'Missing knockout match ID or competitionId.' });
        }

        try {
            const { error: updateError } = await supabase
                .from('knockout_matches')
                .update({
                    player1_id: player1Id ?? null,
                    player2_id: player2Id ?? null,
                    player1_score: player1Score ?? null,
                    player2_score: player2Score ?? null,
                    winner_id: winnerId ?? null,
                    round_name: roundName ?? null,
                })
                .eq('id', id)
                .eq('competition_id', competitionId);

            if (updateError) throw updateError;

            return res.status(200).json({ success: true });
        } catch (err) {
            console.error('Error updating knockout match:', err);
            return res.status(500).json({ error: 'Failed to update knockout match.' });
        }
    });
};
