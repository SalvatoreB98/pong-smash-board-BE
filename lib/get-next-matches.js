// /api/get-next-matches.js
const supabase = require('../services/db');

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const competitionIdParam = req.query?.competitionId
            ? parseInt(req.query.competitionId, 10)
            : undefined;

        if (!competitionIdParam) {
            return res.status(400).json({ error: 'Missing competitionId parameter' });
        }

        // 🔹 Step 1: Recupera tutti i gruppi della competizione
        const { data: groups, error: groupsErr } = await supabase
            .from('groups')
            .select('id, competition_id, name')
            .eq('competition_id', competitionIdParam);

        if (groupsErr) throw groupsErr;

        // 🔹 Step 2: Recupera i giocatori per ogni gruppo
        const { data: groupPlayers, error: gpErr } = await supabase
            .from('groups_players')
            .select('group_id, player_id');

        if (gpErr) throw gpErr;

        // 🔹 Step 3: Recupera le partite esistenti
        const { data: existingMatches, error: matchErr } = await supabase
            .from('matches')
            .select('id, player1_id, player2_id, group_id, player1_score, player2_score, date, competition_id')
            .eq('competition_id', competitionIdParam);

        if (matchErr) throw matchErr;

        const existingPairs = new Set(
            existingMatches.map(
                m => `${m.group_id}-${m.player1_id}-${m.player2_id}`
            )
        );

        // 🔹 Step 4: Genera tutte le combinazioni mancanti (round robin per gruppo)
        const newMatches = [];

        for (const group of groups) {
            const players = groupPlayers
                .filter(gp => gp.group_id === group.id)
                .map(gp => gp.player_id);

            for (let i = 0; i < players.length; i++) {
                for (let j = i + 1; j < players.length; j++) {
                    const key = `${group.id}-${players[i]}-${players[j]}`;
                    if (!existingPairs.has(key)) {
                        newMatches.push({
                            competition_id: competitionIdParam,
                            group_id: group.id,
                            player1_id: players[i],
                            player2_id: players[j],
                            player1_score: null,
                            player2_score: null,
                            date: null,
                            created: null,
                        });
                    }
                }
            }
        }

        // 🔹 Step 5: Inserisci solo se ci sono nuovi match
        if (newMatches.length > 0) {
            const { error: insertErr } = await supabase
                .from('matches')
                .insert(newMatches);

            if (insertErr) throw insertErr;
        }

        // 🔹 Step 6: Recupera tutte le "prossime partite" (senza punteggio)
        const { data: nextMatchesRaw, error: nextErr } = await supabase
            .from('matches')
            .select(`
        id,
        player1_id,
        player2_id,
        group_id,
        date,
        player1_score,
        player2_score,
        groups ( name )
      `)
            .eq('competition_id', competitionIdParam)
            .is('player1_score', null)
            .is('player2_score', null)
            .order('date', { ascending: true });

        if (nextErr) throw nextErr;

        // 🔹 Step 7: Aggiungi dati dei giocatori
        const playerIds = Array.from(
            new Set(nextMatchesRaw.flatMap(m => [m.player1_id, m.player2_id]))
        );

        const { data: playersData, error: playersErr } = await supabase
            .from('players')
            .select('id, nickname, image_url');

        if (playersErr) throw playersErr;

        const playerMap = Object.fromEntries(
            playersData.map(p => [p.id, { nickname: p.nickname, image: p.image_url }])
        );

        const formattedMatches = nextMatchesRaw.map(m => ({
            id: m.id,
            group_id: m.group_id,
            group_name: m.groups?.name || null,
            date: m.date ? new Date(m.date).toISOString().slice(0, 19).replace('T', ' ') : null,
            player1: {
                id: m.player1_id,
                name: playerMap[m.player1_id]?.nickname || 'Unknown',
                img: playerMap[m.player1_id]?.image || '/default-player.jpg'
            },
            player2: {
                id: m.player2_id,
                name: playerMap[m.player2_id]?.nickname || 'Unknown',
                img: playerMap[m.player2_id]?.image || '/default-player.jpg'
            }
        }));

        return res.status(200).json({
            competitionId: competitionIdParam,
            generated: newMatches.length,
            nextMatches: formattedMatches,
        });
    } catch (err) {
        console.error('Error generating next matches:', err);
        return res.status(500).json({ error: 'Failed to generate or fetch next matches' });
    }
};
