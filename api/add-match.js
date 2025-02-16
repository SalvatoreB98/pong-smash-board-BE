const supabase = require('../services/db');
const { formatDateForDB } = require('../utils/utils');
const applyCors = require('./cors');


module.exports = (req, res) => {
    // ✅ Apply CORS headers with `next()`
    applyCors(req, res, async () => {
        // ✅ Ensure only POST requests are processed
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        const { matchId, date, player1, player2, p1Score, p2Score, setsPoints } = req.body;

        if (!date || !player1 || !player2 || p1Score === undefined || p2Score === undefined) {
            return res.status(400).json({ error: 'Invalid data. Ensure all fields are provided.' });
        }

        try {
            // ✅ Insert match into Supabase "matches" table
            const { data: match, error: matchError } = await supabase
                .from('matches')
                .insert([
                    {
                        created: formatDateForDB(date),
                        player1_id: player1,
                        player2_id: player2,
                        player1_score: p1Score,
                        player2_score: p2Score,
                        tournament_id: 1 // Adjust based on your logic
                    }
                ])
                .select()
                .single();

            if (matchError) throw matchError;

            // ✅ Insert match sets into "match_sets" table
            const setsData = setsPoints.map(set => ({
                match_id: match.id,
                player1_score: set.player1,
                player2_score: set.player2
            }));

            const { error: setsError } = await supabase.from('match_sets').insert(setsData);
            if (setsError) throw setsError;

            return res.status(200).json({ message: 'Match added successfully', match });
        } catch (error) {
            console.error('Error inserting match data:', error.message);
            return res.status(500).json({ error: 'Failed to add match' });
        }
    });
};
