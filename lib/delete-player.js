const applyCors = require('./cors');
const supabase = require('../services/db');

async function getNearestBracketSize(n) {
    const total = typeof n === 'number' ? n : 0;
    const safe = Math.max(total, 1);
    const exponent = Math.ceil(Math.log2(safe));
    const size = Math.pow(2, exponent);
    return size < 2 ? 2 : size;
}

function getKnockoutStageName(bracketSize, roundIndex) {
    const playersInRound = bracketSize / Math.pow(2, roundIndex);

    if (playersInRound <= 2) return 'final';
    if (playersInRound <= 4) return 'semifinals';
    if (playersInRound <= 8) return 'quarterfinals';
    if (playersInRound <= 16) return 'round_of_16';
    if (playersInRound <= 32) return 'round_of_32';
    if (playersInRound <= 64) return 'round_of_64';

    return `round_${roundIndex + 1}`;
}

function buildFullKnockoutStructure(playerIds, bracketSize) {
    const uniquePlayerIds = [];
    const seen = new Set();

    for (const id of playerIds) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        uniquePlayerIds.push(id);
    }

    const effectiveBracketSize = Math.max(bracketSize || 0, 2);
    const byesNeeded = Math.max(effectiveBracketSize - uniquePlayerIds.length, 0);
    const seededPlayers = [...uniquePlayerIds];

    for (let i = 0; i < byesNeeded; i++) {
        seededPlayers.push(null);
    }

    const totalRounds = Math.log2(effectiveBracketSize);
    const rounds = [];
    let matchesInRound = effectiveBracketSize / 2;

    for (let roundIndex = 0; roundIndex < totalRounds; roundIndex++) {
        const roundName = getKnockoutStageName(effectiveBracketSize, roundIndex);
        const matches = [];

        for (let matchIndex = 0; matchIndex < matchesInRound; matchIndex++) {
            const baseIndex = matchIndex * 2;
            const player1 = roundIndex === 0 ? seededPlayers[baseIndex] ?? null : null;
            const player2 = roundIndex === 0 ? seededPlayers[baseIndex + 1] ?? null : null;

            matches.push({
                player1_id: player1,
                player2_id: player2,
            });
        }

        rounds.push({
            roundName,
            roundOrder: roundIndex + 1,
            matches,
        });

        if (roundIndex < totalRounds - 1) {
            matchesInRound = Math.floor(matchesInRound / 2);
        }
    }

    return rounds;
}

async function cleanEmptyKnockoutMatches(competitionId) {
    console.log(`🧹 Verifica knockout corrente per competizione ${competitionId}`);

    const { data, error } = await supabase
        .from('knockout_matches')
        .select('id, winner_id')
        .eq('competition_id', competitionId);

    if (error) {
        console.error('❌ Errore durante la lettura dei match knockout:', error);
        throw error;
    }

    if (!data?.length) {
        console.log('ℹ️ Nessun match knockout presente da rimuovere.');
        return { hasWinners: false, removedMatches: false };
    }

    const hasWinners = data.some((match) => match.winner_id !== null);

    if (hasWinners) {
        console.log('⚠️ Vincitori già registrati: salta la cancellazione dei match knockout.');
        return { hasWinners: true, removedMatches: false };
    }

    const { error: deleteErr } = await supabase
        .from('knockout_matches')
        .delete()
        .eq('competition_id', competitionId);

    if (deleteErr) {
        console.error('❌ Errore durante la cancellazione dei match knockout:', deleteErr);
        throw deleteErr;
    }

    console.log(`🧼 Knockout precedente cancellato (nessun vincitore registrato).`);
    return { hasWinners: false, removedMatches: true };
}

async function regenerateKnockout(competitionId, playerIds, bracketSize) {
    const { hasWinners } = await cleanEmptyKnockoutMatches(competitionId);

    if (hasWinners) {
        console.log('⚠️ Rigenerazione completa annullata per preservare i risultati esistenti.');
        return;
    }

    const rounds = buildFullKnockoutStructure(playerIds, bracketSize);
    const roundNames = rounds.map((round) => round.roundName).join(' → ');

    console.log(`🎯 Bracket generato: ${bracketSize} slot, ${rounds.length} round totali`);
    if (roundNames) {
        console.log(`🏗️ Tabellone completo ricreato (rounds: ${roundNames})`);
    }

    for (const round of rounds) {
        const payload = round.matches.map((match) => ({
            competition_id: competitionId,
            round_name: round.roundName,
            round_order: round.roundOrder,
            player1_id: match.player1_id,
            player2_id: match.player2_id,
        }));

        console.log(`⚙️ Round: ${round.roundName}, match generati: ${payload.length}`);

        if (!payload.length) continue;

        const { error } = await supabase.from('knockout_matches').insert(payload);

        if (error) {
            console.error('❌ Errore durante l\'inserimento dei match knockout:', error);
            throw error;
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

            // 🔄 Gestione knockout dopo rimozione giocatore
            const totalPlayers = remainingPlayerIds.length;
            console.log(`📊 Giocatori rimasti: ${totalPlayers}`);

            if (competition?.type === 'elimination' || competition?.type === 'group_knockout') {
                const bracketSize = await getNearestBracketSize(totalPlayers);
                await regenerateKnockout(competitionId, remainingPlayerIds, bracketSize);
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
