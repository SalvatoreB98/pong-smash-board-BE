const supabase = require('../services/db');

module.exports = async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const competitionId = req.query?.competitionId
            ? parseInt(req.query.competitionId, 10)
            : undefined;

        if (!competitionId) {
            return res.status(400).json({ error: 'Missing competitionId parameter' });
        }

        // 🔹 1. Recupera solo i gruppi di questa competizione
        const { data: groups, error: groupsErr } = await supabase
            .from('groups')
            .select('id, name')
            .eq('competition_id', competitionId);

        if (groupsErr) throw groupsErr;

        const groupIds = groups.map(g => g.id);
        if (groupIds.length === 0) {
            return res.status(200).json({
                competitionId,
                generated: 0,
                nextMatches: [],
                message: 'No groups found for this competition',
            });
        }

        // 🔹 2. Recupera match già esistenti (solo per questi gruppi)
        const { data: existingMatches, error: existingErr } = await supabase
            .from('matches')
            .select('id, group_id, player1_id, player2_id')
            .in('group_id', groupIds)
            .eq('competition_id', competitionId);

        if (existingErr) throw existingErr;

        const existingPairs = new Set(
            existingMatches.map(
                m =>
                    `${m.group_id}-${Math.min(m.player1_id, m.player2_id)}-${Math.max(
                        m.player1_id,
                        m.player2_id
                    )}`
            )
        );

        // 🔹 3. Recupera i giocatori per gruppo
        const { data: groupPlayers, error: gpErr } = await supabase
            .from('groups_players')
            .select('group_id, player_id')
            .in('group_id', groupIds);

        if (gpErr) throw gpErr;

        // 🔹 4. Genera nuove combinazioni mancanti
        const newMatches = [];
        for (const groupId of groupIds) {
            const players = groupPlayers
                .filter(gp => gp.group_id === groupId)
                .map(gp => gp.player_id);

            for (let i = 0; i < players.length; i++) {
                for (let j = i + 1; j < players.length; j++) {
                    const key = `${groupId}-${Math.min(players[i], players[j])}-${Math.max(
                        players[i],
                        players[j]
                    )}`;
                    if (!existingPairs.has(key)) {
                        newMatches.push({
                            competition_id: competitionId,
                            group_id: groupId,
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

        if (newMatches.length > 0) {
            const { error: insertErr } = await supabase.from('matches').insert(newMatches);
            if (insertErr) throw insertErr;
        }

        // 🔹 5. Recupera solo i match "futuri" (mai giocati, senza date e con gruppo valido)
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
        created,
        groups ( name )
      `)
            .eq('competition_id', competitionId)
            .is('player1_score', null)
            .is('player2_score', null)
            .is('created', null)
            .not('group_id', 'is', null) // 🔸 escludi partite fuori gruppo
            .order('group_id', { ascending: true });

        if (nextErr) throw nextErr;

        // 🔹 6. Deduplica eventuali coppie invertite
        const uniqueKeys = new Set();
        const filteredMatches = [];
        for (const m of nextMatchesRaw) {
            const key = `${m.group_id}-${Math.min(m.player1_id, m.player2_id)}-${Math.max(
                m.player1_id,
                m.player2_id
            )}`;
            if (!uniqueKeys.has(key)) {
                uniqueKeys.add(key);
                filteredMatches.push(m);
            }
        }

        // 🔹 7. Recupera i giocatori coinvolti
        const playerIds = Array.from(
            new Set(filteredMatches.flatMap(m => [m.player1_id, m.player2_id]))
        );

        const { data: playersData, error: playersErr } = await supabase
            .from('players')
            .select('id, nickname, image_url')
            .in('id', playerIds);

        if (playersErr) throw playersErr;

        const playerMap = Object.fromEntries(
            playersData.map(p => [p.id, { nickname: p.nickname, image: p.image_url }])
        );

        const formattedMatches = filteredMatches.map(m => ({
            id: m.id,
            group_id: m.group_id,
            group_name: m.groups?.name || null,
            date: m.date
                ? new Date(m.date).toISOString().slice(0, 19).replace('T', ' ')
                : null,
            player1: {
                id: m.player1_id,
                name: playerMap[m.player1_id]?.nickname || 'Unknown',
                img: playerMap[m.player1_id]?.image || '/default-player.jpg',
            },
            player2: {
                id: m.player2_id,
                name: playerMap[m.player2_id]?.nickname || 'Unknown',
                img: playerMap[m.player2_id]?.image || '/default-player.jpg',
            },
        }));

        return res.status(200).json({
            competitionId,
            generated: newMatches.length,
            nextMatches: formattedMatches,
        });
    } catch (err) {
        console.error('Error generating next matches:', err);
        return res.status(500).json({ error: 'Failed to generate or fetch next matches' });
    }
};
