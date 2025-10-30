const applyCors = require('./cors');
const supabase = require('../services/db');

// 🔹 Helpers

async function releaseKnockoutSlots(competitionId, playerIds = []) {
    const targets = Array.isArray(playerIds)
        ? playerIds.filter(Boolean)
        : [playerIds].filter(Boolean);

    if (!targets.length) {
        return;
    }

    for (const playerId of targets) {
        const { data: matches, error } = await supabase
            .from('knockout_matches')
            .select('id, player1_id, player2_id')
            .eq('competition_id', competitionId)
            .or(`player1_id.eq.${playerId},player2_id.eq.${playerId}`);

        if (error) {
            console.error(
                `❌ Errore recuperando match knockout per il giocatore ${playerId} nella competizione ${competitionId}:`,
                error.message
            );
            continue;
        }

        if (!matches?.length) {
            console.log(
                `ℹ️ Nessun match knockout da aggiornare per il giocatore ${playerId} nella competizione ${competitionId}`
            );
            continue;
        }

        for (const match of matches) {
            const slotsToClear = [];

            if (match.player1_id === playerId) {
                slotsToClear.push('player1_id');
            }

            if (match.player2_id === playerId) {
                slotsToClear.push('player2_id');
            }

            if (!slotsToClear.length) {
                continue;
            }

            const payload = {};
            slotsToClear.forEach((slot) => {
                payload[slot] = null;
            });

            const { error: updateErr } = await supabase
                .from('knockout_matches')
                .update(payload)
                .eq('competition_id', competitionId)
                .eq('id', match.id);

            if (updateErr) {
                console.error(
                    `❌ Errore aggiornando il match ${match.id} per rimuovere il giocatore ${playerId}:`,
                    updateErr.message
                );
                continue;
            }

            slotsToClear.forEach((slot) => {
                console.log(`🧼 Player ${playerId} removed from match ${match.id} slot ${slot}`);
            });
        }
    }
}

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

            const { data: compPlayers, error: remainingErr } = await supabase
                .from('competitions_players')
                .select('player_id')
                .eq('competition_id', competitionId)
                .order('player_id', { ascending: true });

            if (remainingErr) throw remainingErr;

            const remainingPlayerIds = (compPlayers || []).map(cp => cp.player_id);

            let groups = null;
            if (competition?.type === 'group_knockout') {
                // Se ci sono ancora giocatori, ricrea i gironi
                if (remainingPlayerIds.length) {
                    groups = await rebuildGroups(competitionId, remainingPlayerIds, 4);
                    console.log(`✅ Ricreati i gironi per competizione ${competitionId}`);
                } else {
                    console.log(`ℹ️ Nessun giocatore rimasto, nessun gruppo ricreato.`);
                }
            }

            const normalizedType = (competition?.type || '').toLowerCase();
            if (['elimination', 'group_knockout'].includes(normalizedType)) {
                await releaseKnockoutSlots(competitionId, playerId);
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
