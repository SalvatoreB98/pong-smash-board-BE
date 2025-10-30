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
                    next_match_id,
                    match_id,
                    matches!fk_knockout_match_id ( id, created )  -- 👈 specifica chiara della relazione
                `)
                .eq('competition_id', competitionId)
                .order('round_order', { ascending: true })
                .order('id', { ascending: true });



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

            const sanitizedQualified = [];
            const seenPlayers = new Set();
            for (const player of qualified) {
                if (!player || !player.id || seenPlayers.has(player.id)) continue;
                seenPlayers.add(player.id);
                sanitizedQualified.push(player);
            }

            if (sanitizedQualified.length < 2) {
                return res.status(400).json({ error: 'Non abbastanza giocatori qualificati.' });
            }

            if (existing && existing.length > 0) {
                const distinctPlayers = new Set(
                    existing.flatMap((m) => [m.player1?.id, m.player2?.id]).filter(Boolean)
                );

                const qualifiedIds = new Set(sanitizedQualified.map(p => p.id));
                const existingIds = Array.from(distinctPlayers);

                // controlla differenze effettive tra vecchi e nuovi
                const removed = existingIds.filter(id => !qualifiedIds.has(id));
                const added = Array.from(qualifiedIds).filter(id => !distinctPlayers.has(id));

                const expectedRounds = getExpectedRoundMetadata(sanitizedQualified.length);
                const structureMismatch = hasStructureMismatch(existing, expectedRounds);

                if (!structureMismatch && removed.length === 0 && added.length === 0) {
                    // ✅ stessi giocatori — NON rigenerare
                    console.log(`✅ Knockouts già validi per competizione ${competitionId}`);
                    const rounds = groupByRound(existing);
                    return res.status(200).json({ competitionId, rounds });
                }

                if (structureMismatch) {
                    console.log(
                        `⚠️ Struttura knockout incompleta o non valida per competizione ${competitionId}, rigenero da zero`
                    );
                }

                // 👇 Tolleranza piccole variazioni (es. un solo nuovo player)
                if (!structureMismatch && added.length <= 1 && removed.length <= 1) {
                    console.log(`⚠️ Differenza minore (${added.length} aggiunti, ${removed.length} rimossi), NON rigenero`);
                    const rounds = groupByRound(existing);
                    return res.status(200).json({ competitionId, rounds });
                }

                // 🔥 cambiamento reale → rigenera
                console.log(`⚠️ Giocatori cambiati, rigenero knockout (rimosso: ${removed.length}, aggiunto: ${added.length})`);
                const { error: delErr } = await supabase
                    .from('knockout_matches')
                    .delete()
                    .eq('competition_id', competitionId);
                if (delErr) throw delErr;
            }

            // 4️⃣ Genera nuovo tabellone
            const roundsStructure = buildKnockoutStructure(sanitizedQualified);

            const storedMatches = [];

            for (const round of roundsStructure) {
                const payload = round.matches.map((match) => ({
                    competition_id: competitionId,
                    round_name: round.round_name,
                    round_order: round.order,
                    player1_id: match.player1?.id ?? null,
                    player2_id: match.player2?.id ?? null,
                }));

                if (!payload.length) continue;

                const { data: inserted, error: insertError } = await supabase
                    .from('knockout_matches')
                    .insert(payload)
                    .select('id');

                if (insertError) throw insertError;

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
                            next_match_id: next.id,
                            competition_id: competitionId, // 👈 AGGIUNGILO QUI
                        }
                        : null;
                })
                .filter(Boolean);

            const { error: linkError } = await supabase
                .from('knockout_matches')
                .upsert(linkUpdates, { onConflict: 'id' });


            const { data: generated, error: generatedError } = await supabase
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
                    next_match_id,
                    match_id,
                    matches!fk_knockout_match_id ( id, created )
                `)
                .eq('competition_id', competitionId)
                .order('round_order', { ascending: true })
                .order('id', { ascending: true });

            if (generatedError) throw generatedError;

            console.log(`✅ Knockouts rigenerati per competizione ${competitionId}`);
            const grouped = groupByRound(generated);
            return res.status(200).json({ competitionId, rounds: grouped });
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
    // 🔹 Rimuovi duplicati e null
    const uniquePlayers = [];
    const seen = new Set();

    for (const player of players) {
        if (!player || !player.id || seen.has(player.id)) continue;
        seen.add(player.id);
        uniquePlayers.push(player);
    }

    const numPlayers = uniquePlayers.length;
    const bracketSize = Math.pow(2, Math.ceil(Math.log2(Math.max(numPlayers, 2))));
    const byes = bracketSize - numPlayers;

    // 🔹 Aggiungi bye (null) alla fine
    const fullPlayers = [...uniquePlayers, ...Array(byes).fill(null)];

    const totalRounds = Math.log2(bracketSize);
    const roundNames = [
        'one_sixteenth_finals',
        'one_eighth_finals',
        'quarterfinals',
        'semifinals',
        'final',
    ];

    const startIndex = roundNames.length - totalRounds;
    const rounds = [];
    let matchesInRound = bracketSize / 2;

    // 🔹 Generazione round per round
    for (let roundIndex = 0; roundIndex < totalRounds; roundIndex++) {
        const matches = [];

        for (let matchIndex = 0; matchIndex < matchesInRound; matchIndex++) {
            const key = `R${roundIndex + 1}M${matchIndex + 1}`;

            // solo per il primo round assegni player
            const player1 = roundIndex === 0 ? fullPlayers[matchIndex * 2] ?? null : null;
            const player2 = roundIndex === 0 ? fullPlayers[matchIndex * 2 + 1] ?? null : null;

            // 👇 non saltare nessun match, anche se entrambi null
            matches.push({
                key,
                roundIndex,
                matchIndex,
                player1,
                player2,
                isBye: (!player1 && !player2) ? true : (!player1 || !player2),
                nextMatchKey:
                    matchesInRound > 1
                        ? `R${roundIndex + 2}M${Math.floor(matchIndex / 2) + 1}`
                        : null,
            });
        }

        rounds.push({
            round_name: getKnockoutStageName(players.length, roundIndex),
            order: roundIndex + 1,
            matches,
        });

        if (roundIndex < totalRounds - 1) {
            matchesInRound = Math.floor(matchesInRound / 2);
        }
    }

    console.log(
        `🏗️ Generato tabellone con ${rounds[0].matches.length} match nel primo round (${bracketSize} giocatori totali)`
    );

    return rounds;
}


function groupByRound(data) {
    return data.reduce((acc, row, index) => {
        let round = acc.find((r) => r.name === row.round_name);
        if (!round) {
            round = { name: row.round_name, order: row.round_order, matches: [] };
            acc.push(round);
        }
        console.log("acc", acc);
        console.log("acc.matches", acc[index]?.matches);

        console.log("row", row);
        console.log("index", index);
        const createdAt = (() => {
            if (!row.matches) return null;
            if (Array.isArray(row.matches)) {
                return row.matches.length ? row.matches[0].created ?? null : null;
            }
            return row.matches.created ?? null;
        })();

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
            created: createdAt,
        });

        return acc;
    }, []);
}

function getKnockoutStageName(totalPlayers, roundIndex) {
    // Calcola quanti round ci sono in totale
    const rounds = Math.ceil(Math.log2(totalPlayers));
    const roundFromEnd = rounds - roundIndex; // 1 = finale, 2 = semi, ecc.

    const KnockoutStage = {
        ONE_SIXTEENTH_FINALS: "one_sixteenth_finals",
        ONE_EIGHTH_FINALS: "one_eighth_finals",
        QUARTERFINALS: "quarterfinals",
        SEMIFINALS: "semifinals",
        FINAL: "final",
    };

    switch (roundFromEnd) {
        case 1: return KnockoutStage.FINAL;
        case 2: return KnockoutStage.SEMIFINALS;
        case 3: return KnockoutStage.QUARTERFINALS;
        case 4: return KnockoutStage.ONE_EIGHTH_FINALS;
        case 5: return KnockoutStage.ONE_SIXTEENTH_FINALS;
        default: return `round_${roundIndex + 1}`;
    }
}

function getExpectedRoundMetadata(playerCount) {
    if (!playerCount || playerCount < 2) return [];

    const bracketSize = Math.pow(2, Math.ceil(Math.log2(Math.max(playerCount, 2))));
    const totalRounds = Math.log2(bracketSize);
    const rounds = [];
    let matchesInRound = bracketSize / 2;

    for (let roundIndex = 0; roundIndex < totalRounds; roundIndex++) {
        rounds.push({
            order: roundIndex + 1,
            round_name: getKnockoutStageName(playerCount, roundIndex),
            matchCount: matchesInRound,
        });

        if (roundIndex < totalRounds - 1) {
            matchesInRound = Math.max(1, Math.floor(matchesInRound / 2));
        }
    }

    return rounds;
}

function hasStructureMismatch(existingMatches, expectedRounds) {
    if (!expectedRounds.length) {
        return existingMatches && existingMatches.length > 0;
    }

    const byOrder = existingMatches.reduce((acc, match) => {
        const key = match.round_order;
        if (!acc.has(key)) {
            acc.set(key, { count: 0, names: new Set() });
        }
        const entry = acc.get(key);
        entry.count += 1;
        if (match.round_name) {
            entry.names.add(match.round_name);
        }
        return acc;
    }, new Map());

    for (const round of expectedRounds) {
        const entry = byOrder.get(round.order);
        if (!entry) {
            return true;
        }
        if (entry.count < round.matchCount) {
            return true;
        }
        if (entry.names.size && !entry.names.has(round.round_name)) {
            return true;
        }
    }

    for (const order of byOrder.keys()) {
        if (!expectedRounds.some((round) => round.order === order)) {
            const entry = byOrder.get(order);
            if (entry && entry.count > 0) {
                return true;
            }
        }
    }

    const expectedTotal = expectedRounds.reduce((sum, round) => sum + round.matchCount, 0);
    const existingTotal = existingMatches.length;
    return existingTotal < expectedTotal;
}

