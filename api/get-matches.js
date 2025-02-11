const supabase = require('../services/db');
const { parseData } = require('../utils/stats.js');

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // ✅ Fetch matches with related match_sets
        const { data: matches, error: matchesError } = await supabase
            .from('matches')
            .select(`
                id, player1_id, player2_id, score_p1, score_p2, tournament_id, created, 
                match_sets (id, match_id, player1_score, player2_score)
            `);

        if (matchesError || !matches) {
            throw new Error(matchesError?.message || 'No match data found.');
        }
        console.log('Matches:', matches);
        // ✅ Ensure `match_sets` is always an array
        const formattedMatches = matches.map(match => ({
            ...match,
            match_sets: Array.isArray(match.match_sets) ? match.match_sets : [] // ✅ Convert to array if null
        }));

        // Fetch players
        const { data: players, error: playersError } = await supabase
            .from('players')
            .select('*');

        if (playersError || !players) {
            throw new Error(playersError?.message || 'No player data found.');
        }

        // Process match data
        const { wins, totPlayed, points, monthlyWinRates, badges } = parseData(formattedMatches);

        // Construct response
        res.status(200).json({
            players,
            matches: formattedMatches,
            wins,
            totPlayed,
            points,
            monthlyWinRates,
            badges
        });
    } catch (error) {
        console.error('Error fetching matches or players:', error.message);
        res.status(500).json({ error: 'Failed to fetch match or player data.' });
    }
};
