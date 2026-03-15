const applyCors = require('./cors');
const supabase = require('../services/db');

module.exports = (req, res) => {
    applyCors(req, res, async () => {
        if (req.method !== 'GET') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        const { competitionId } = req.query || {};
        if (!competitionId) {
            return res.status(400).json({ error: 'Missing competitionId' });
        }

        try {
            // 1️⃣ Match di girone con data impostata
            const { data: regularMatches, error: regularErr } = await supabase
                .from('matches')
                .select(`
                    id,
                    date,
                    player1:player1_id ( id, nickname ),
                    player2:player2_id ( id, nickname ),
                    player1_score,
                    player2_score,
                    competition_id,
                    stage,
                    round_order,
                    match_sets ( player1_score, player2_score )
                `)
                .eq('competition_id', competitionId)
                .order('date', { ascending: true, nullsFirst: false });

            if (regularErr) throw regularErr;

            // 2️⃣ Match di knockout con data impostata
            const { data: knockoutMatches, error: knockoutErr } = await supabase
                .from('knockout_matches')
                .select(`
                    id,
                    date,
                    round_name,
                    round_order,
                    player1:player1_id ( id, nickname ),
                    player2:player2_id ( id, nickname ),
                    player1_score,
                    player2_score,
                    competition_id
                `)
                .eq('competition_id', competitionId)
                .order('date', { ascending: true, nullsFirst: false });

            if (knockoutErr) throw knockoutErr;

            // 3️⃣ Normalizza i match di girone
            const normalizedRegular = (regularMatches || []).map((m) => ({
                id: m.id,
                type: 'regular',
                date: m.date,
                player1_name: m.player1?.nickname ?? null,
                player2_name: m.player2?.nickname ?? null,
                player1_score: m.player1_score ?? 0,
                player2_score: m.player2_score ?? 0,
                setsPoints: (m.match_sets || []).map((s) => ({
                    player1: s.player1_score,
                    player2: s.player2_score,
                })),
                competition_id: m.competition_id,
                roundLabel: m.stage ?? `Round ${m.round_order ?? ''}`,
            }));

            // 4️⃣ Normalizza i match di knockout
            const normalizedKnockout = (knockoutMatches || []).map((m) => ({
                id: m.id,
                type: 'knockout',
                date: m.date,
                player1_name: m.player1?.nickname ?? null,
                player2_name: m.player2?.nickname ?? null,
                player1_score: m.player1_score ?? 0,
                player2_score: m.player2_score ?? 0,
                setsPoints: [],
                competition_id: m.competition_id,
                roundLabel: formatRoundLabel(m.round_name),
            }));

            // 5️⃣ Unisci e ordina per data (quelle senza data vanno in fondo)
            const all = [...normalizedRegular, ...normalizedKnockout].sort((a, b) => {
                if (!a.date && !b.date) return 0;
                if (!a.date) return 1;
                if (!b.date) return -1;
                return new Date(a.date) - new Date(b.date);
            });

            return res.status(200).json({ competitionId, matches: all });
        } catch (err) {
            console.error('❌ Error in get-calendar:', err);
            return res.status(500).json({ error: 'Failed to get calendar.' });
        }
    });
};

function formatRoundLabel(roundName) {
    const labels = {
        final: 'Finale',
        semifinals: 'Semifinali',
        quarterfinals: 'Quarti di finale',
        one_eighth_finals: 'Ottavi di finale',
        one_sixteenth_finals: 'Sedicesimi di finale',
    };
    return labels[roundName] ?? roundName ?? 'Knockout';
}
