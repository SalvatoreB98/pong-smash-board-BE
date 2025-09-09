const supabase = require('../lib/supabase');
const { formatDateForDB } = require('../utils/utils');
const applyCors = require('./cors');
const handleError = require('../lib/error');


module.exports = (req, res) => {
    // ✅ Apply CORS headers with `next()`
    applyCors(req, res, async () => {
        // ✅ Ensure only POST requests are processed
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        const { date, player1, player2, p1Score, p2Score, setsPoints, competitionId } = req.body;

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
                        competition_id: competitionId
                    }
                ])
                .select();
            if (matchError) throw matchError;
            if (!match) {
                throw new Error('Insert su matches fallito: match null');
            } else {
                await supabase.rpc('fn_apply_match_elo', {
                    p_competition_id: match.competition_id,
                    p_player1_id: match.player1_id,
                    p_player2_id: match.player2_id,
                    p_score1: match.player1_score,
                    p_score2: match.player2_score,
                    p_k: 32
                });
            }

            // ✅ Insert match sets into "match_sets" table
            const setsData = setsPoints.map(set => ({
                match_id: match.id,
                player1_score: set.player1Points,
                player2_score: set.player2Points
            }));

            const { error: setsError } = await supabase.from('match_sets').insert(setsData);
            if (setsError) throw setsError;

            return res.status(200).json({ message: 'Match added successfully', match });
        } catch (error) {
            return handleError(res, error, 'Failed to add match');
        }
    });
};
