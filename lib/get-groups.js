const applyCors = require('./cors');
const supabase = require('../services/db');

module.exports = (req, res) => {
    applyCors(req, res, async () => {
        if (req.method !== 'GET') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        const { competitionId } = req.query || {};
        if (competitionId == null || `${competitionId}`.trim() === '') {
            return res.status(400).json({ error: 'Missing competitionId' });
        }

        const trimmedCompetitionId = `${competitionId}`.trim();
        const numericCompetitionId = Number(trimmedCompetitionId);
        const resolvedCompetitionId = Number.isNaN(numericCompetitionId)
            ? trimmedCompetitionId
            : numericCompetitionId;

        try {
            // 1. Ottieni dati flat da Supabase
            const { data, error } = await supabase
                .rpc('fn_get_groups_with_stats', { p_competition_id: resolvedCompetitionId });

            if (error) throw error;

            // 2. Raggruppa per group_id
            const grouped = (data || []).reduce((acc, row) => {
                let group = acc.find(g => g.id === row.group_id);
                if (!group) {
                    group = {
                        id: row.group_id,
                        name: row.group_name,
                        competitionId: row.competition_id,
                        players: []
                    };
                    acc.push(group);
                }

                group.players.push({
                    id: row.player_id,
                    name: row.name,
                    lastname: row.lastname,
                    nickname: row.nickname,
                    imageUrl: row.image_url,
                    matches_played: row.matches_played,
                    wins: row.wins,
                    losses: row.losses,
                    draws: row.draws,
                    score_difference: row.score_difference,
                    points: row.points,
                    ranking: row.ranking
                });

                return acc;
            }, []);

            // 3. Risposta pulita
            return res.status(200).json(grouped);
        } catch (err) {
            console.error('Error fetching groups with stats:', err?.message || err);
            return res.status(500).json({ error: 'Failed to fetch groups data.' });
        }
    });
};
