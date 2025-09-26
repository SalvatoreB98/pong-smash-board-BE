const applyCors = require('../cors');
const supabase = require('../../services/db');

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
            const { data, error } = await supabase.rpc(
                'fn_get_groups_with_stats',
                { p_competition_id: resolvedCompetitionId }
            );

            if (error) throw error;

            return res.status(200).json(data || []);
        } catch (err) {
            console.error('Error fetching groups with stats:', err?.message || err);
            return res.status(500).json({ error: 'Failed to fetch groups data.' });
        }
    });
};
