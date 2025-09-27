const { createClient } = require('@supabase/supabase-js');
const applyCors = require('./cors');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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
