const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { formatDateForDB } = require('../utils/utils');
const applyCors = require('./cors');
const { fetchCompetitionData } = require('../services/matches');

module.exports = (req, res) => {
    applyCors(req, res, async () => {
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        const {
            date,
            player1,
            player2,
            p1Score,
            p2Score,
            setsPoints,
            competitionId,
            groupId,
        } = req.body;

        if (!date || !player1 || !player2 || p1Score === undefined || p2Score === undefined) {
            return res.status(400).json({ error: 'Invalid data. Ensure all fields are provided.' });
        }

        try {
            // 1. Insert match
            const { data: inserted, error: matchError } = await supabase
                .from('matches')
                .insert([
                    {
                        created: formatDateForDB(date),
                        player1_id: player1,
                        player2_id: player2,
                        player1_score: p1Score,
                        player2_score: p2Score,
                        competition_id: competitionId,
                        group_id: groupId ?? null,
                    },
                ])
                .select();

            if (matchError) throw matchError;
            const match = inserted?.[0];
            if (!match) throw new Error('Insert su matches fallito: match null');

            // 2. Apply ELO
            await supabase.rpc('fn_apply_match_elo', {
                p_competition_id: match.competition_id,
                p_player1_id: match.player1_id,
                p_player2_id: match.player2_id,
                p_score1: match.player1_score,
                p_score2: match.player2_score,
                p_k: 32,
            });

            // 3. Insert match sets
            if (Array.isArray(setsPoints) && setsPoints.length) {
                const setsData = setsPoints.map((set) => ({
                    match_id: match.id,
                    player1_score: set.player1Points,
                    player2_score: set.player2Points,
                }));

                const { error: setsError } = await supabase.from('match_sets').insert(setsData);
                if (setsError) throw setsError;
            }

            // 4. Return the same payload as get-matches
            const competitionData = await fetchCompetitionData(competitionId);
            return res.status(200).json(competitionData);
        } catch (error) {
            console.error('Error inserting match data:', error.message);
            return res.status(500).json({ error: 'Failed to add match' });
        }
    });
};
