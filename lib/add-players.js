const applyCors = require('./cors');
const supabase = require('../services/db');

// 🔹 Funzioni locali

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

async function upsertGroups(competitionId, maxPlayers = 4) {
  const { data: compPlayers, error: cpErr } = await supabase
    .from('competitions_players')
    .select('player_id')
    .eq('competition_id', competitionId);

  if (cpErr) throw cpErr;
  const players = compPlayers.map(cp => cp.player_id);
  if (players.length === 0) return [];

  const { data: existingGroups, error: gErr } = await supabase
    .from('groups')
    .select('id')
    .eq('competition_id', competitionId);

  if (gErr) throw gErr;

  if (!existingGroups || existingGroups.length === 0) {
    return await createGroups(competitionId, players, maxPlayers);
  } else {
    return await rebuildGroups(competitionId, players, maxPlayers);
  }
}

function getKnockoutStageName(totalPlayers, roundIndex = 0) {
  const stageNames = [
    'one_sixty_fourth_finals',
    'one_thirty_second_finals',
    'one_sixteenth_finals',
    'one_eighth_finals',
    'quarterfinals',
    'semifinals',
    'final',
  ];

  const sanitizedPlayers = Number.isFinite(totalPlayers) ? totalPlayers : 0;
  const effectivePlayers = Math.max(sanitizedPlayers, 2);
  const totalRounds = Math.ceil(Math.log2(effectivePlayers));
  const startIndex = Math.max(0, stageNames.length - totalRounds);
  const index = startIndex + roundIndex;

  return stageNames[index] || `round_${roundIndex + 1}`;
}

async function cleanEmptyKnockoutMatches(competitionId) {
  try {
    const { data: deleted, error } = await supabase
      .from('knockout_matches')
      .delete()
      .eq('competition_id', competitionId)
      .is('player1_id', null)
      .is('player2_id', null)
      .is('winner_id', null)
      .is('match_id', null)
      .select('id');

    if (error) {
      throw error;
    }

    if (deleted?.length) {
      console.log(`🧹 Rimossi ${deleted.length} match knockout vuoti per competizione ${competitionId}`);
    }
  } catch (err) {
    console.error('❌ Errore durante cleanEmptyKnockoutMatches:', err.message);
  }
}

async function fillEmptyKnockoutSlots(competitionId, newPlayerIds = []) {
  if (!Array.isArray(newPlayerIds) || newPlayerIds.length === 0) {
    return;
  }

  const { data: matches, error } = await supabase
    .from('knockout_matches')
    .select('id, player1_id, player2_id, round_order, round_name')
    .eq('competition_id', competitionId)
    .is('winner_id', null)
    .order('round_order', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    console.error('❌ Errore recuperando match knockout aperti:', error.message);
    return;
  }

  const openMatches = matches ? [...matches] : [];
  const leftovers = [];

  for (const playerId of newPlayerIds) {
    if (!playerId) continue;

    const targetMatch = openMatches.find(match => !match.player1_id || !match.player2_id);

    if (!targetMatch) {
      leftovers.push(playerId);
      continue;
    }

    const slot = targetMatch.player1_id ? 'player2_id' : 'player1_id';

    const { error: updateError } = await supabase
      .from('knockout_matches')
      .update({ [slot]: playerId })
      .eq('id', targetMatch.id)
      .eq('competition_id', competitionId);

    if (updateError) {
      console.error(`❌ Errore assegnando il giocatore ${playerId} al match ${targetMatch.id}:`, updateError.message);
      leftovers.push(playerId);
    } else {
      console.log(`✅ Assegnato giocatore ${playerId} allo slot ${slot} del match ${targetMatch.id}`);
      targetMatch[slot] = playerId;
    }
  }

  if (leftovers.length) {
    const { data: firstRoundMatches, error: firstRoundErr } = await supabase
      .from('knockout_matches')
      .select('id, round_name')
      .eq('competition_id', competitionId)
      .eq('round_order', 1);

    if (firstRoundErr) {
      console.error('❌ Errore recuperando i match del primo round:', firstRoundErr.message);
    }

    const existingFirstRoundPlayers = (firstRoundMatches?.length ?? 0) * 2;
    const totalPlayers = existingFirstRoundPlayers + leftovers.length;
    const roundName = firstRoundMatches?.find(match => match.round_name)?.round_name
      ?? getKnockoutStageName(totalPlayers, 0);

    const payload = [];
    for (let i = 0; i < leftovers.length; i += 2) {
      payload.push({
        competition_id: competitionId,
        round_order: 1,
        round_name: roundName,
        player1_id: leftovers[i] ?? null,
        player2_id: leftovers[i + 1] ?? null,
      });
    }

    if (payload.length) {
      const { data: inserted, error: insertErr } = await supabase
        .from('knockout_matches')
        .insert(payload)
        .select('id, player1_id, player2_id');

      if (insertErr) {
        console.error('❌ Errore creando nuovi match knockout:', insertErr.message);
      } else {
        inserted?.forEach(row => {
          console.log(`🆕 Creato match knockout ${row.id} con giocatori ${row.player1_id ?? 'null'} e ${row.player2_id ?? 'null'}`);
        });
      }
    }
  }

  await cleanEmptyKnockoutMatches(competitionId);
}

// 🔹 Endpoint
module.exports = (req, res) => {
  applyCors(req, res, async () => {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { players, competitionId, user_id, maxPlayers = 4 } = req.body;
    if (!players || !competitionId || !user_id) {
      return res.status(400).json({ error: 'Missing players, competitionId or user_id' });
    }

    try {
      // 1) Inserisci i giocatori
      const { data: newPlayers, error: playersErr } = await supabase
        .from('players')
        .insert(
          players.map(p => ({
            name: p.name ?? '',
            lastname: p.surname ?? '',
            nickname: p.nickname,
            image_url: p.imageUrl,
            auth_user_id: null
          }))
        )
        .select();

      if (playersErr) {
        console.error('Error inserting players:', playersErr);
        return res.status(400).json({ error: playersErr.message });
      }

      // 2) Inserisci join in competitions_players
      const joins = newPlayers.map(pl => ({
        competition_id: competitionId,
        player_id: pl.id,
      }));

      const { data: joined, error: joinErr } = await supabase
        .from('competitions_players')
        .insert(joins)
        .select();

      if (joinErr) {
        console.error('Error inserting competition players:', joinErr);
        return res.status(400).json({ error: joinErr.message });
      }

      try {
        await fillEmptyKnockoutSlots(
          competitionId,
          newPlayers.map(pl => pl.id).filter(Boolean)
        );
      } catch (slotErr) {
        console.error('❌ Errore durante fillEmptyKnockoutSlots:', slotErr.message);
      }

      // 3) Aggiorna user_state
      const { error: stateErr } = await supabase
        .from('user_state')
        .upsert(
          {
            user_id,
            active_competition_id: competitionId,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'user_id' }
        );

      if (stateErr) {
        console.error('Error updating user_state:', stateErr);
        return res.status(400).json({ error: stateErr.message });
      }

      // 4) Upsert groups
      const groups = await upsertGroups(competitionId, maxPlayers);

      return res.status(200).json({
        message: 'Players added successfully',
        players: newPlayers,
        relations: joined,
        groups
      });
    } catch (err) {
      console.error('Unexpected error inserting players:', err);
      return res.status(500).json({ error: 'Failed to add players' });
    }
  });
};
