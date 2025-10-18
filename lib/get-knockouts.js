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
            // 1️⃣ Recupera knockout esistenti
            const { data: existing, error: existingError } = await supabase
                .from('knockout_matches')
                .select(`
          id,
          competition_id,
          round_name,
          round_order,
          player1:player1_id ( id, nickname, image_url ),
          player2:player2_id ( id, nickname, image_url ),
          player1_score,
          player2_score,
          winner:winner_id ( id, nickname, image_url ),
          next_match_id
        `)
                .eq('competition_id', competitionId)
                .order('round_order', { ascending: true });

            if (existingError) throw existingError;

            // 2️⃣ Recupera giocatori qualificati
            const { data: players, error: playersError } = await supabase.rpc(
                'fn_get_groups_with_stats',
                { p_competition_id: competitionId }
            );
            if (playersError) throw playersError;

            const qualified = (players || [])
                .filter((p) => p.ranking <= 2)
                .map((p) => ({
                    id: p.player_id,
                    nickname: p.nickname,
                    imageUrl: p.image_url,
                }));

            if (qualified.length < 2) {
                return res.status(400).json({ error: 'Non abbastanza giocatori qualificati.' });
            }

            // 3️⃣ Se già esistono knockout, controlla se sono ancora validi
            if (existing && existing.length > 0) {
                const distinctPlayers = new Set(
                    existing.flatMap((m) => [m.player1?.id, m.player2?.id]).filter(Boolean)
                );

                if (distinctPlayers.size === qualified.length) {
                    // Stesso numero di giocatori → restituisci i knockout salvati
                    const rounds = groupByRound(existing);
                    return res.status(200).json({ competitionId, rounds });
                } else {
                    // Numero giocatori cambiato → rigenera completamente
                    console.log(
                        `⚠️ Numero giocatori cambiato (${distinctPlayers.size} → ${qualified.length}), rigenero knockout...`
                    );
                    const { error: delErr } = await supabase
                        .from('knockout_matches')
                        .delete()
                        .eq('competition_id', competitionId);
                    if (delErr) throw delErr;
                }
            }

            // 4️⃣ Genera nuovo tabellone
            const rounds = buildKnockoutStructure(qualified);

            // 5️⃣ Salva nuovi match nel DB
            const allMatches = rounds.flatMap((r) =>
                r.matches.map((m) => ({
                    competition_id: competitionId,
                    round_name: r.name,
                    round_order: r.order,
                    player1_id: m.player1?.id ?? null,
                    player2_id: m.player2?.id ?? null,
                    next_match_id: null,
                }))
            );

            const { error: insertError } = await supabase.from('knockout_matches').insert(allMatches);
            if (insertError) throw insertError;

            console.log(`✅ Knockouts rigenerati per competizione ${competitionId}`);
            return res.status(200).json({ competitionId, rounds });
        } catch (err) {
            console.error('❌ Error in get-knockouts:', err);
            return res.status(500).json({ error: 'Failed to get or generate knockouts.' });
        }
    });
};

// =============================
// FUNZIONI DI SUPPORTO
// =============================
function buildKnockoutStructure(players) {
    const numPlayers = players.length;

    // 1️⃣ Calcola potenza di 2 successiva (es. 5 → 8)
    const nextPowerOfTwo = Math.pow(2, Math.ceil(Math.log2(numPlayers)));
    const byes = nextPowerOfTwo - numPlayers;

    // 2️⃣ Riempie i "bye" (slot null)
    const fullPlayers = [...players];
    for (let i = 0; i < byes; i++) {
        fullPlayers.push(null);
    }

    // 3️⃣ Crea round basati sulla potenza di 2
    const numRounds = Math.ceil(Math.log2(nextPowerOfTwo));
    const roundNames = ['Round of 16', 'Quarterfinals', 'Semifinals', 'Final'];
    const startIndex = roundNames.length - numRounds;
    const rounds = [];

    // 4️⃣ Primo round
    let current = [];
    for (let i = 0; i < fullPlayers.length; i += 2) {
        current.push({
            player1: fullPlayers[i],
            player2: fullPlayers[i + 1] ?? null,
        });
    }

    // 5️⃣ Crea round successivi (anche vuoti)
    for (let r = 0; r < numRounds; r++) {
        const matches = current.map((m, idx) => ({
            id: `${r + 1}-${idx}`,
            player1: m.player1,
            player2: m.player2,
            nextMatchId: null,
        }));

        const roundName = roundNames[startIndex + r] || `Round ${r + 1}`;
        rounds.push({ name: roundName, order: r + 1, matches });

        // Crea round successivo
        const next = [];
        for (let i = 0; i < matches.length; i += 2) {
            next.push({ player1: null, player2: null });
        }

        current = next;
    }

    return rounds;
}

function groupByRound(data) {
    return data.reduce((acc, row) => {
        let round = acc.find((r) => r.name === row.round_name);
        if (!round) {
            round = { name: row.round_name, order: row.round_order, matches: [] };
            acc.push(round);
        }

        round.matches.push({
            id: row.id,
            player1: row.player1
                ? { id: row.player1.id, nickname: row.player1.nickname, imageUrl: row.player1.image_url }
                : null,
            player2: row.player2
                ? { id: row.player2.id, nickname: row.player2.nickname, imageUrl: row.player2.image_url }
                : null,
            score: { player1: row.player1_score, player2: row.player2_score },
            winner: row.winner
                ? { id: row.winner.id, nickname: row.winner.nickname, imageUrl: row.winner.image_url }
                : null,
            nextMatchId: row.next_match_id,
        });

        return acc;
    }, []);
}
