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
            // 1️⃣ Ottieni i match del knockout per competizione
            const { data, error } = await supabase
                .from('knockout_matches')
                .select(`
                    id,
                    competition_id,
                    round_name,
                    round_order,
                    player1:player1_id ( id, nickname, imageUrl ),
                    player2:player2_id ( id, nickname, imageUrl ),
                    player1_score,
                    player2_score,
                    winner:winner_id ( id, nickname, imageUrl ),
                    next_match_id
                `)
                .eq('competition_id', resolvedCompetitionId)
                .order('round_order', { ascending: true });

            if (error) throw error;

            // 2️⃣ Raggruppa per round_name
            const rounds = (data || []).reduce((acc, row) => {
                let round = acc.find(r => r.name === row.round_name);
                if (!round) {
                    round = {
                        name: row.round_name,
                        order: row.round_order,
                        matches: []
                    };
                    acc.push(round);
                }

                round.matches.push({
                    id: row.id,
                    player1: row.player1 ? {
                        id: row.player1.id,
                        nickname: row.player1.nickname,
                        imageUrl: row.player1.imageUrl
                    } : null,
                    player2: row.player2 ? {
                        id: row.player2.id,
                        nickname: row.player2.nickname,
                        imageUrl: row.player2.imageUrl
                    } : null,
                    score: {
                        player1: row.player1_score,
                        player2: row.player2_score
                    },
                    winner: row.winner ? {
                        id: row.winner.id,
                        nickname: row.winner.nickname,
                        imageUrl: row.winner.imageUrl
                    } : null,
                    nextMatchId: row.next_match_id
                });

                return acc;
            }, []);

            // Ordina i round in modo crescente (es. Quarterfinals → Final)
            rounds.sort((a, b) => a.order - b.order);

            // 3️⃣ Risposta pulita
            return res.status(200).json({ competitionId: resolvedCompetitionId, rounds });
        } catch (err) {
            console.error('Error fetching knockout data:', err?.message || err);
            return res.status(500).json({ error: 'Failed to fetch knockout data.' });
        }
    });
};
