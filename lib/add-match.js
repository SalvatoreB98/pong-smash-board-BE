const { formatDateForDB } = require('../utils/utils');
const applyCors = require('./cors');
const { fetchCompetitionData } = require('../services/matches');
const supabase = require('../services/db');

module.exports = (req, res) => {
    applyCors(req, res, async () => {
        if (req.method !== 'POST') {
            return res.status(405).json({ error: 'Method Not Allowed' });
        }

        const {
            date,
            player1,
            player2,
            p1Score,
            p2Score,
            setsPoints,
            competitionId,
            groupId,
            stage // round_name (es: "quarterfinals")
        } = req.body;

        if (!date || !player1 || !player2 || p1Score === undefined || p2Score === undefined) {
            return res.status(400).json({ error: 'Invalid data. Ensure all fields are provided.' });
        }

        try {
            // 1️⃣ Inserisci match reale
            const matchData = {
                created: formatDateForDB(date),
                player1_id: player1,
                player2_id: player2,
                player1_score: p1Score,
                player2_score: p2Score,
                competition_id: competitionId,
                group_id: groupId ?? null,
                ...(stage && { stage }),
            };

            const { data: inserted, error: matchError } = await supabase
                .from('matches')
                .insert([matchData])
                .select();

            if (matchError) throw matchError;
            const match = inserted?.[0];
            if (!match) throw new Error('Insert su matches fallito: match null');

            // Calcolo vincitore
            const winnerId =
                p1Score > p2Score ? player1 :
                    p2Score > p1Score ? player2 :
                        null;

            // 2️⃣ Aggiorna knockout_matches e propaga il vincitore
            if (stage) {
                try {
                    const { match: knockoutMatch, matchIndex } = await findKnockoutMatch(
                        competitionId,
                        stage,
                        player1,
                        player2
                    );

                    if (knockoutMatch) {
                        const previousWinnerId = knockoutMatch.winner_id ?? null;
                        knockoutMatch.matchIndex = matchIndex;

                        const assignments = buildPlayerAssignments(knockoutMatch, player1, player2);
                        const scoreMap = new Map([
                            [player1, p1Score],
                            [player2, p2Score],
                        ]);

                        const simulatedPlayer1 = assignments.player1_id ?? knockoutMatch.player1_id;
                        const simulatedPlayer2 = assignments.player2_id ?? knockoutMatch.player2_id;

                        const updatePayload = {
                            ...assignments,
                            player1_score: simulatedPlayer1 ? (scoreMap.get(simulatedPlayer1) ?? null) : null,
                            player2_score: simulatedPlayer2 ? (scoreMap.get(simulatedPlayer2) ?? null) : null,
                            winner_id: winnerId,
                            match_id: match.id, // ✅ collega al match reale
                        };

                        const { error: knockoutUpdateError } = await supabase
                            .from('knockout_matches')
                            .update(updatePayload)
                            .eq('id', knockoutMatch.id);

                        if (knockoutUpdateError) {
                            console.error('❌ Aggiornamento knockout fallito:', knockoutUpdateError.message);
                        } else {
                            await propagateWinnerToNextMatch({
                                competitionId,
                                currentMatch: knockoutMatch,
                                matchIndex,
                                previousWinnerId,
                                winnerId,
                            });
                        }
                    } else {
                        console.warn(
                            `⚠️ Nessun knockout match trovato per stage ${stage} con giocatori ${player1} e ${player2}`
                        );
                    }
                } catch (knockoutErr) {
                    console.error('❌ Errore gestendo knockout:', knockoutErr.message);
                }
            }

            // 4️⃣ Applica ELO
            await supabase.rpc('fn_apply_match_elo', {
                p_competition_id: match.competition_id,
                p_player1_id: match.player1_id,
                p_player2_id: match.player2_id,
                p_score1: match.player1_score,
                p_score2: match.player2_score,
                p_k: 32,
            });

            // 5️⃣ Inserisci set (se presenti)
            if (Array.isArray(setsPoints) && setsPoints.length) {
                const setsData = setsPoints.map(set => ({
                    match_id: match.id,
                    player1_score: set.player1Points,
                    player2_score: set.player2Points,
                }));
                const { error: setsError } = await supabase.from('match_sets').insert(setsData);
                if (setsError) throw setsError;
            }

            // 6️⃣ Recupera dati aggiornati della competizione
            const competitionData = await fetchCompetitionData(competitionId);

            // 7️⃣ Se è torneo a eliminazione, includi anche knockout aggiornati
            let knockoutData = null;

            if (stage) {
                const { data: knockoutMatches, error: knockoutErr } = await supabase
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
                    .order('round_order', { ascending: true })
                    .order('id', { ascending: true });

                if (knockoutErr) {
                    console.warn('⚠️ Errore recuperando knockout aggiornati:', knockoutErr.message);
                } else {
                    knockoutData = knockoutMatches;
                }
            }

            // 8️⃣ Ritorna tutto in un’unica response
            return res.status(200).json({
                ...competitionData,
                knockout_matches: knockoutData ?? [],
            });

        } catch (error) {
            console.error('❌ Error inserting match data:', error.message);
            return res.status(500).json({ error: 'Failed to add match' });
        }
    });
};

async function findKnockoutMatch(competitionId, stage, player1, player2) {
    const { data, error } = await supabase
        .from('knockout_matches')
        .select('id, player1_id, player2_id, next_match_id, winner_id, round_order, round_name')
        .eq('competition_id', competitionId)
        .eq('round_name', stage)
        .order('id', { ascending: true });

    if (error) throw error;

    const matches = data || [];

    const directMatch = matches.find(
        (m) =>
            (m.player1_id === player1 && m.player2_id === player2) ||
            (m.player1_id === player2 && m.player2_id === player1)
    );

    if (directMatch) {
        const index = matches.findIndex((m) => m.id === directMatch.id);
        return { match: directMatch, matchIndex: index };
    }

    const fallbackMatch = matches.find((m) => {
        const participants = [m.player1_id, m.player2_id].filter(Boolean);
        if (!participants.length) return false;
        return participants.every((id) => id === player1 || id === player2);
    });

    if (fallbackMatch) {
        const index = matches.findIndex((m) => m.id === fallbackMatch.id);
        return { match: fallbackMatch, matchIndex: index };
    }

    return { match: null, matchIndex: -1 };
}

function buildPlayerAssignments(knockoutMatch, player1, player2) {
    const assignments = {};
    const currentPlayers = [knockoutMatch.player1_id, knockoutMatch.player2_id].filter(Boolean);
    const available = [player1, player2].filter(
        (playerId, idx, arr) =>
            playerId && !currentPlayers.includes(playerId) && arr.indexOf(playerId) === idx
    );

    if (!knockoutMatch.player1_id && available.length) {
        assignments.player1_id = available.shift();
    }

    if (!knockoutMatch.player2_id && available.length) {
        assignments.player2_id = available.shift();
    }

    return assignments;
}

async function propagateWinnerToNextMatch({
    competitionId,
    currentMatch,
    matchIndex,
    previousWinnerId,
    winnerId,
}) {
    console.log('➡️ propagateWinnerToNextMatch CALLED', {
        competitionId,
        round_order: currentMatch.round_order,
        winnerId,
    });

    // 1️⃣ Se c'è un next_match_id esplicito, usalo (comportamento attuale)
    if (currentMatch?.next_match_id) {
        const { data: nextMatch, error: nextMatchError } = await supabase
            .from('knockout_matches')
            .select('id, player1_id, player2_id')
            .eq('id', currentMatch.next_match_id)
            .maybeSingle();

        if (nextMatchError) {
            console.error('❌ Errore recuperando match successivo:', nextMatchError.message);
            return;
        }
        if (!nextMatch) return;

        await updateNextMatchSlot({
            nextMatch,
            competitionId,
            winnerId,
            previousWinnerId,
            matchIndex,
        });
        return;
    }

    // 2️⃣ Se non c’è next_match_id, prova a trovare il match del round successivo
    console.log('🔎 Cercando round successivo per order', currentMatch.round_order + 1);
    const { data: nextRoundMatches, error: nextRoundErr } = await supabase
        .from('knockout_matches')
        .select('id, player1_id, player2_id, round_order')
        .eq('competition_id', competitionId)
        .eq('round_order', currentMatch.round_order + 1)
        .order('id', { ascending: true });

    if (nextRoundErr) {
        console.error('❌ Errore recuperando round successivo:', nextRoundErr.message);
        return;
    }
    if (!nextRoundMatches?.length) {
        console.warn('⚠️ Nessun round successivo trovato, fine torneo.');
        return;
    }

    // 3️⃣ Cerca il primo match con slot libero
    let targetMatch = nextRoundMatches.find(m => !m.player1_id || !m.player2_id);
    if (!targetMatch) {
        console.warn('⚠️ Nessuno slot libero nel round successivo.');
        return;
    }

    // 4️⃣ Aggiorna il match trovato con il vincitore
    await updateNextMatchSlot({
        nextMatch: targetMatch,
        competitionId,
        winnerId,
        previousWinnerId,
        matchIndex,
    });
}

async function updateNextMatchSlot({
    nextMatch,
    competitionId,
    winnerId,
    previousWinnerId,
    matchIndex,
}) {
    if (!winnerId) return;

    const safeIndex = matchIndex >= 0 ? matchIndex : 0;
    const preferredSlot = safeIndex % 2 === 0 ? 'player1_id' : 'player2_id';
    let slotToReplace = null;

    if (previousWinnerId && previousWinnerId !== winnerId) {
        if (nextMatch.player1_id === previousWinnerId) slotToReplace = 'player1_id';
        else if (nextMatch.player2_id === previousWinnerId) slotToReplace = 'player2_id';
    }

    const updates = {};
    if (slotToReplace) {
        updates[slotToReplace] = winnerId;
    } else if (!nextMatch.player1_id && !nextMatch.player2_id) {
        updates[preferredSlot] = winnerId;
    } else if (!nextMatch.player1_id) {
        updates.player1_id = winnerId;
    } else if (!nextMatch.player2_id) {
        updates.player2_id = winnerId;
    } else {
        console.warn(`⚠️ Nessuno slot libero per assegnare il vincitore ${winnerId} nel match ${nextMatch.id}`);
    }

    if (Object.keys(updates).length) {
        const { error: nextUpdateError } = await supabase
            .from('knockout_matches')
            .update(updates)
            .eq('id', nextMatch.id)
            .eq('competition_id', competitionId);

        if (nextUpdateError) {
            console.error('❌ Errore aggiornando match successivo:', nextUpdateError.message);
        } else {
            console.log(`✅ Vincitore ${winnerId} propagato nel match ${nextMatch.id}`);
        }
    }
}
