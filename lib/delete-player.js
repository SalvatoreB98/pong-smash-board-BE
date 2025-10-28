const applyCors = require('./cors');
const supabase = require('../services/db');

// 🔹 Helpers presi da add_players

function getNearestBracketSize(n) {
    if (n < 2) return 2;
    return Math.pow(2, Math.floor(Math.log2(n)));
}

function getKnockoutStageName(totalPlayers, roundIndex) {
    const playersInRound = totalPlayers / Math.pow(2, roundIndex);

    if (playersInRound <= 2) return 'final';
    if (playersInRound <= 4) return 'semifinals';
    if (playersInRound <= 8) return 'quarterfinals';
    if (playersInRound <= 16) return 'one_eighth_finals';
    if (playersInRound <= 32) return 'one_sixteenth_finals';
    if (playersInRound <= 64) return 'one_thirtysecond_finals';

    return `round_${roundIndex + 1}`;
}

async function cleanEmptyKnockoutMatches(competitionId) {
    console.log(`🧹 Pulizia match vuoti per competizione ${competitionId}`);

    const { error } = await supabase
        .from('knockout_matches')
        .delete({ count: 'exact' })
        .eq('competition_id', competitionId)
        .is('player1_id', null)
        .is('player2_id', null)
        .is('winner_id', null);

    if (error) {
        console.error('❌ Errore durante la pulizia dei match vuoti:', error);
        throw error;
    }

    console.log(`✅ Match vuoti rimossi per competizione ${competitionId}`);
}

function buildReducedKnockoutStructure(playerIds, targetBracketSize) {
    const unique = [];
    const seen = new Set();

    for (const id of playerIds) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        unique.push(id);
    }

    if (unique.length === 0) {
        return [];
    }

    const bracketSize = targetBracketSize || getNearestBracketSize(unique.length);
    const selected = unique.slice(0, bracketSize);

    if (unique.length > selected.length) {
        console.log(
            `⚠️ Riduzione tabellone: utilizzo ${selected.length} giocatori su ${unique.length} disponibili`
        );
    }

    const byes = bracketSize - selected.length;
    const seededPlayers = [...selected, ...Array(byes).fill(null)];

    const totalRounds = Math.log2(bracketSize);
    const rounds = [];
    let matchesInRound = bracketSize / 2;

    for (let roundIndex = 0; roundIndex < totalRounds; roundIndex++) {
        const roundName = getKnockoutStageName(bracketSize, roundIndex);
        const matches = [];

        for (let matchIndex = 0; matchIndex < matchesInRound; matchIndex++) {
            const key = `R${roundIndex + 1}M${matchIndex + 1}`;
            const player1 = roundIndex === 0 ? seededPlayers[matchIndex * 2] ?? null : null;
            const player2 = roundIndex === 0 ? seededPlayers[matchIndex * 2 + 1] ?? null : null;

            matches.push({
                key,
                roundIndex,
                matchIndex,
                player1,
                player2,
                nextMatchKey:
                    matchesInRound > 1
                        ? `R${roundIndex + 2}M${Math.floor(matchIndex / 2) + 1}`
                        : null,
            });
        }

        rounds.push({
            name: roundName,
            order: roundIndex + 1,
            matches,
        });

        if (roundIndex < totalRounds - 1) {
            matchesInRound = Math.floor(matchesInRound / 2);
        }
    }

    console.log(
        `🏗️ Tabellone ridotto generato con ${rounds[0]?.matches.length || 0} match nel primo round (${bracketSize} slot)`
    );

    return rounds;
}

async function regenerateReducedKnockout(competitionId, playerIds, bracketSize) {
    console.log(`♻️ Rigenerazione knockout ridotto per competizione ${competitionId}`);

    const rounds = buildReducedKnockoutStructure(playerIds, bracketSize);

    if (!rounds.length) {
        console.log('⚠️ Nessun giocatore sufficiente per rigenerare il knockout.');
        return;
    }

    const storedMatches = [];

    for (const round of rounds) {
        const payload = round.matches.map((match) => ({
            competition_id: competitionId,
            round_name: round.name,
            round_order: round.order,
            player1_id: match.player1 ?? null,
            player2_id: match.player2 ?? null,
        }));

        if (!payload.length) continue;

        const { data: inserted, error } = await supabase
            .from('knockout_matches')
            .insert(payload)
            .select('id');

        if (error) {
            console.error('❌ Errore durante l\'inserimento dei match rigenerati:', error);
            throw error;
        }

        inserted.forEach((row, idx) => {
            const match = round.matches[idx];
            match.id = row.id;
            storedMatches.push(match);
        });
    }

    const linkUpdates = storedMatches
        .filter((match) => match.nextMatchKey)
        .map((match) => {
            const next = storedMatches.find((m) => m.key === match.nextMatchKey);
            return next
                ? {
                    id: match.id,
                    competition_id: competitionId,
                    next_match_id: next.id,
                }
                : null;
        })
        .filter(Boolean);

    if (linkUpdates.length) {
        const { error } = await supabase
            .from('knockout_matches')
            .upsert(linkUpdates, { onConflict: 'id' });

        if (error) {
            console.error('❌ Errore durante il linking dei match rigenerati:', error);
            throw error;
        }
    }

    console.log(`✅ Knockout ridotto rigenerato per competizione ${competitionId}`);
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
            console.log(
                `📊 Giocatori rimasti nella competizione ${competitionId}: ${totalPlayers}`
            );

            const { data: knockoutMatches, error: knockoutErr } = await supabase
                .from('knockout_matches')
                .select('id, round_order, player1_id, player2_id, winner_id')
                .eq('competition_id', competitionId);

            if (knockoutErr) throw knockoutErr;

            if (knockoutMatches?.length) {
                const firstRoundOrder = knockoutMatches.reduce((min, match) => {
                    if (match.round_order == null) return min;
                    return Math.min(min, match.round_order);
                }, Infinity);

                const firstRoundMatches = knockoutMatches.filter(
                    (match) => match.round_order === firstRoundOrder
                );

                const currentBracketSize = firstRoundMatches.length * 2;
                const newBracketSize = getNearestBracketSize(totalPlayers);

                console.log(
                    `🎯 Bracket attuale: ${currentBracketSize} | Nuova dimensione suggerita: ${newBracketSize}`
                );

                const hasWinners = knockoutMatches.some((match) => match.winner_id);

                if (newBracketSize < currentBracketSize && totalPlayers >= 2) {
                    if (hasWinners) {
                        console.log(
                            '⚠️ Match con vincitore presenti: salto la rigenerazione per evitare perdita di dati.'
                        );
                        await cleanEmptyKnockoutMatches(competitionId);
                    } else {
                        console.log('🧨 Riduzione tabellone knockout in corso...');
                        const { error: deleteErr } = await supabase
                            .from('knockout_matches')
                            .delete()
                            .eq('competition_id', competitionId);

                        if (deleteErr) throw deleteErr;

                        await regenerateReducedKnockout(
                            competitionId,
                            remainingPlayerIds,
                            newBracketSize
                        );
                    }
                } else {
                    await cleanEmptyKnockoutMatches(competitionId);
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
