const applyCors = require('./cors');
const supabase = require('../services/db');

// 🔹 Helpers presi da add_players

async function createGroups(competitionId, players, maxPlayers) {
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    const numGroups = Math.ceil(shuffled.length / maxPlayers);
    const groups = [];

    for (let i = 0; i < numGroups; i++) {
        const name = `Girone ${String.fromCharCode(65 + i)}`;
        const { data: g, error: gErr } = await supabase
            .from('groups')
            .insert({ competition_id: competitionId, name })
            .select()
            .single();

        if (gErr) throw gErr;
        groups.push(g);

        for (const [idx, playerId] of shuffled.entries()) {
            if (idx % numGroups === i) {
                await supabase.from('groups_players')
                    .insert({ group_id: g.id, player_id: playerId });
            }
        }
    }
    return groups;
}

async function rebuildGroups(competitionId, players, maxPlayers) {
    const { data: oldGroups } = await supabase
        .from('groups')
        .select('id')
        .eq('competition_id', competitionId);

    if (oldGroups?.length) {
        const groupIds = oldGroups.map(g => g.id);
        await supabase.from('groups_players').delete().in('group_id', groupIds);
        await supabase.from('groups').delete().eq('competition_id', competitionId);
    }

    return await createGroups(competitionId, players, maxPlayers);
}

module.exports = (req, res) => {
    applyCors(req, res, async () => {
        if (req.method !== 'DELETE') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        const { competitionId, playerId } = req.body;
        if (!competitionId || !playerId) {
            return res.status(400).json({ error: 'Missing competitionId or playerId' });
        }

        try {
            // 1️⃣ Elimina dalla competitions_players
            const { error: compPlayerErr } = await supabase
                .from('competitions_players')
                .delete()
                .eq('competition_id', competitionId)
                .eq('player_id', playerId);

            if (compPlayerErr) {
                console.error('Error deleting from competitions_players:', compPlayerErr);
                return res.status(400).json({ error: compPlayerErr.message });
            }

            // 2️⃣ Controlla se il player ha auth_user_id
            const { data: playerData, error: playerFetchErr } = await supabase
                .from('players')
                .select('auth_user_id')
                .eq('id', playerId)
                .single();

            if (playerFetchErr) {
                console.error('Error fetching player:', playerFetchErr);
                return res.status(400).json({ error: playerFetchErr.message });
            }

            // 3️⃣ Se non ha auth_user_id, elimina anche dalla tabella players
            if (!playerData.auth_user_id) {
                const { error: playerDelErr } = await supabase
                    .from('players')
                    .delete()
                    .eq('id', playerId);

                if (playerDelErr) {
                    console.error('Error deleting player:', playerDelErr);
                    return res.status(400).json({ error: playerDelErr.message });
                }
            }

            // 4️⃣ Se la competizione è di tipo "group_knockout", ricrea i gironi
            const { data: competition, error: compErr } = await supabase
                .from('competitions')
                .select('type')
                .eq('id', competitionId)
                .single();

            if (compErr) {
                console.error('Error fetching competition type:', compErr);
                return res.status(400).json({ error: compErr.message });
            }

            let groups = null;
            if (competition?.type === 'group_knockout') {
                // Recupera tutti i giocatori rimasti nella competizione
                const { data: compPlayers, error: cpErr } = await supabase
                    .from('competitions_players')
                    .select('player_id')
                    .eq('competition_id', competitionId);

                if (cpErr) throw cpErr;
                const players = compPlayers.map(cp => cp.player_id);

                // Se ci sono ancora giocatori, ricrea i gironi
                if (players.length) {
                    groups = await rebuildGroups(competitionId, players, 4);
                    console.log(`✅ Ricreati i gironi per competizione ${competitionId}`);
                } else {
                    console.log(`ℹ️ Nessun giocatore rimasto, nessun gruppo ricreato.`);
                }
            }

            return res.status(200).json({
                message: 'Player removed successfully',
                groups: groups ?? [],
            });

        } catch (err) {
            console.error('Unexpected error deleting player:', err);
            return res.status(500).json({ error: 'Failed to delete player' });
        }
    });
};
